import { createHash } from "node:crypto";
import { jsonResponse } from "../utils/http";
import { openRouterHeaders } from "../config/constants";

type ServiceId = "groq" | "cerebras" | "openrouter";

type ProviderKeys = {
  groqKey: string;
  cerebrasKey: string;
  openrouterKey: string;
};

type ModelsCacheEntry = {
  models: string[];
  expiresAt: number;
};

const OPENROUTER_AUTO_MODEL = "openrouter/auto";
const MODEL_VALIDATION_TIMEOUT_MS = 6000;
const OPENROUTER_VALIDATION_LIMIT = 80;
const MODELS_CACHE_TTL_MS = getModelsCacheTtlMs();

const modelsCache = new Map<string, ModelsCacheEntry>();

function getModelsCacheTtlMs(): number {
  const raw = process.env.MODELS_CACHE_TTL_MS;
  if (!raw) return 120_000;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 120_000;
  return parsed;
}

function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function createCacheKey(
  service: ServiceId,
  validate: boolean,
  apiKey: string,
): string {
  return `${service}:${validate ? "validate" : "list"}:${hashValue(apiKey)}`;
}

function getCachedModels(cacheKey: string): string[] | null {
  const cached = modelsCache.get(cacheKey);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    modelsCache.delete(cacheKey);
    return null;
  }
  return [...cached.models];
}

function setCachedModels(cacheKey: string, models: string[]): void {
  if (MODELS_CACHE_TTL_MS <= 0) return;
  modelsCache.set(cacheKey, {
    models: [...models],
    expiresAt: Date.now() + MODELS_CACHE_TTL_MS,
  });
}

function extractModelIds(models: unknown): string[] {
  if (!models || typeof models !== "object") return [];
  const data = (models as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  return data
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const id = (item as { id?: unknown }).id;
      return typeof id === "string" ? id : null;
    })
    .filter((id): id is string => id !== null);
}

async function fetchModelIds(
  endpoint: string,
  headers?: Record<string, string>,
): Promise<string[]> {
  const res = await fetch(endpoint, { headers });
  if (!res.ok) return [];
  const payload = (await res.json()) as unknown;
  return extractModelIds(payload);
}

async function runWithTimeout<T>(
  task: () => Promise<T>,
  timeoutMs: number,
): Promise<T | null> {
  let timeoutRef: ReturnType<typeof setTimeout> | null = null;
  const guardedTask = task().catch(() => null);
  try {
    return await Promise.race<T | null>([
      guardedTask,
      new Promise<null>((resolve) => {
        timeoutRef = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutRef) {
      clearTimeout(timeoutRef);
    }
  }
}

async function canUseStreamingEndpoint(
  endpoint: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
): Promise<boolean> {
  const result = await runWithTimeout(async () => {
    const abort = new AbortController();
    const timeout = setTimeout(
      () => abort.abort(),
      MODEL_VALIDATION_TIMEOUT_MS - 250,
    );
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: abort.signal,
      });
      if (!res.ok || !res.body) return false;
      const reader = res.body.getReader();
      const { done } = await reader.read();
      await reader.cancel();
      return !done;
    } finally {
      clearTimeout(timeout);
    }
  }, MODEL_VALIDATION_TIMEOUT_MS);
  return result === true;
}

async function canUseGroqModel(apiKey: string, model: string): Promise<boolean> {
  return canUseStreamingEndpoint(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    {
      model,
      messages: [{ role: "user", content: "ping" }],
      max_completion_tokens: 8,
      temperature: 0,
      stream: true,
    },
  );
}

async function canUseOpenRouterModel(
  apiKey: string,
  model: string,
): Promise<boolean> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...openRouterHeaders,
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return canUseStreamingEndpoint(
    "https://openrouter.ai/api/v1/chat/completions",
    headers,
    {
      model,
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 8,
      stream: true,
    },
  );
}

async function canUseCerebrasModel(
  apiKey: string,
  model: string,
): Promise<boolean> {
  const result = await runWithTimeout(async () => {
    const Cerebras = (await import("@cerebras/cerebras_cloud_sdk")).default;
    const cerebras = new Cerebras({ apiKey });
    const stream = await cerebras.chat.completions.create({
      model,
      messages: [{ role: "user", content: "ping" }],
      stream: true,
      max_completion_tokens: 8,
      temperature: 0,
    });
    for await (const chunk of stream) {
      if (chunk) return true;
    }
    return false;
  }, MODEL_VALIDATION_TIMEOUT_MS);
  return result === true;
}

async function canUseModel(
  service: ServiceId,
  model: string,
  keys: ProviderKeys,
): Promise<boolean> {
  if (service === "groq") {
    return canUseGroqModel(keys.groqKey, model);
  }
  if (service === "cerebras") {
    return canUseCerebrasModel(keys.cerebrasKey, model);
  }
  return canUseOpenRouterModel(keys.openrouterKey, model);
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const out: R[] = new Array(items.length);
  let index = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (true) {
        const current = index;
        index += 1;
        if (current >= items.length) break;
        const item = items[current];
        if (item === undefined) break;
        out[current] = await mapper(item);
      }
    },
  );
  await Promise.all(workers);
  return out;
}

async function filterPassingModels(
  service: ServiceId,
  models: string[],
  keys: ProviderKeys,
  concurrency: number,
): Promise<string[]> {
  const checks = await mapLimit(models, concurrency, async (model) => ({
    model,
    ok: await canUseModel(service, model, keys),
  }));
  return checks.filter((entry) => entry.ok).map((entry) => entry.model);
}

async function filterUsableModels(
  service: ServiceId,
  models: string[],
  keys: ProviderKeys,
): Promise<string[]> {
  const firstPass = await filterPassingModels(service, models, keys, 5);
  if (firstPass.length === 0) return [];

  // Second pass reduces false positives from transient provider responses.
  return filterPassingModels(service, firstPass, keys, 3);
}

async function listGroqModels(apiKey: string): Promise<string[]> {
  return fetchModelIds("https://api.groq.com/openai/v1/models", {
    Authorization: `Bearer ${apiKey}`,
  });
}

async function listCerebrasModels(apiKey: string): Promise<string[]> {
  const Cerebras = (await import("@cerebras/cerebras_cloud_sdk")).default;
  const cerebras = new Cerebras({ apiKey });
  const models = await cerebras.models.list();
  return extractModelIds(models);
}

async function listOpenRouterModels(apiKey: string): Promise<string[]> {
  const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined;
  const ids = await fetchModelIds("https://openrouter.ai/api/v1/models", headers);
  return ids.includes(OPENROUTER_AUTO_MODEL)
    ? ids
    : [OPENROUTER_AUTO_MODEL, ...ids];
}

async function loadModelsForService(
  service: ServiceId,
  keys: ProviderKeys,
): Promise<string[]> {
  if (service === "groq") return listGroqModels(keys.groqKey);
  if (service === "cerebras") return listCerebrasModels(keys.cerebrasKey);
  return listOpenRouterModels(keys.openrouterKey);
}

async function validateModelsForService(
  service: ServiceId,
  listed: string[],
  keys: ProviderKeys,
): Promise<string[]> {
  if (service !== "openrouter") {
    return filterUsableModels(service, listed, keys);
  }

  const validationCandidates = listed
    .filter((model) => model !== OPENROUTER_AUTO_MODEL)
    .slice(0, OPENROUTER_VALIDATION_LIMIT);
  const validatedCandidates = await filterUsableModels(
    "openrouter",
    validationCandidates,
    keys,
  );
  const canUseAuto = await canUseOpenRouterModel(
    keys.openrouterKey,
    OPENROUTER_AUTO_MODEL,
  );
  const models = canUseAuto
    ? [OPENROUTER_AUTO_MODEL, ...validatedCandidates]
    : validatedCandidates;
  return Array.from(new Set(models));
}

function getServiceApiKey(service: ServiceId, keys: ProviderKeys): string {
  if (service === "groq") return keys.groqKey;
  if (service === "cerebras") return keys.cerebrasKey;
  return keys.openrouterKey;
}

function isServiceId(value: string | null): value is ServiceId {
  return value === "groq" || value === "cerebras" || value === "openrouter";
}

function modelsResponse(models: string[]): Response {
  return jsonResponse({ models });
}

function emptyModelsResponse(): Response {
  return modelsResponse([]);
}

export async function handleModelsRoute(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const serviceParam = url.searchParams.get("service");
  const validate = url.searchParams.get("validate") === "1";
  if (!isServiceId(serviceParam)) return emptyModelsResponse();

  const keys: ProviderKeys = {
    groqKey: req.headers.get("X-Groq-Key") || process.env.GROQ_API_KEY || "",
    cerebrasKey:
      req.headers.get("X-Cerebras-Key") || process.env.CEREBRAS_API_KEY || "",
    openrouterKey:
      req.headers.get("X-Openrouter-Key") || process.env.OPENROUTER_API_KEY || "",
  };

  if (
    (serviceParam === "groq" && !keys.groqKey) ||
    (serviceParam === "cerebras" && !keys.cerebrasKey)
  ) {
    return emptyModelsResponse();
  }

  const serviceApiKey = getServiceApiKey(serviceParam, keys);
  const cacheKey = createCacheKey(serviceParam, validate, serviceApiKey);
  const cached = getCachedModels(cacheKey);
  if (cached) return modelsResponse(cached);

  try {
    const listed = await loadModelsForService(serviceParam, keys);
    const models = validate
      ? await validateModelsForService(serviceParam, listed, keys)
      : listed;
    setCachedModels(cacheKey, models);
    return modelsResponse(models);
  } catch (error: unknown) {
    console.error("[ERROR] /models:", error);
    return emptyModelsResponse();
  }
}
