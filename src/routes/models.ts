import { jsonResponse } from "../utils/http";
import { openRouterHeaders } from "../config/constants";

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
  try {
    return await Promise.race<T | null>([
      task(),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } catch {
    return null;
  }
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

async function canUseGroqModel(
  apiKey: string,
  model: string,
): Promise<boolean> {
  const result = await runWithTimeout(async () => {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "ping" }],
        max_completion_tokens: 8,
        temperature: 0,
        stream: true,
      }),
    });
    if (!res.ok || !res.body) return false;
    const reader = res.body.getReader();
    const { done } = await reader.read();
    await reader.cancel();
    return !done;
  }, 6000);
  return result === true;
}

async function canUseOpenRouterModel(
  apiKey: string,
  model: string,
): Promise<boolean> {
  const result = await runWithTimeout(async () => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...openRouterHeaders,
    };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 8,
        stream: true,
      }),
    });
    if (!res.ok || !res.body) return false;
    const reader = res.body.getReader();
    const { done } = await reader.read();
    await reader.cancel();
    return !done;
  }, 6000);
  return result === true;
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
  }, 6000);
  return result === true;
}

async function canUseModel(
  service: "groq" | "cerebras" | "openrouter",
  model: string,
  keys: { groqKey: string; cerebrasKey: string; openrouterKey: string },
): Promise<boolean> {
  if (service === "groq") {
    return canUseGroqModel(keys.groqKey, model);
  }
  if (service === "cerebras") {
    return canUseCerebrasModel(keys.cerebrasKey, model);
  }
  return canUseOpenRouterModel(keys.openrouterKey, model);
}

async function filterPassingModels(
  service: "groq" | "cerebras" | "openrouter",
  models: string[],
  keys: { groqKey: string; cerebrasKey: string; openrouterKey: string },
  concurrency: number,
): Promise<string[]> {
  const checks = await mapLimit(models, concurrency, async (model) => ({
    model,
    ok: await canUseModel(service, model, keys),
  }));
  return checks.filter((c) => c.ok).map((c) => c.model);
}

async function filterUsableModels(
  service: "groq" | "cerebras" | "openrouter",
  models: string[],
  keys: { groqKey: string; cerebrasKey: string; openrouterKey: string },
): Promise<string[]> {
  const firstPass = await filterPassingModels(service, models, keys, 5);
  if (firstPass.length === 0) return [];

  // Strict mode: second pass to reduce false positives from transient provider responses.
  return filterPassingModels(service, firstPass, keys, 3);
}

async function modelsResponseFrom(
  task: () => Promise<string[]>,
): Promise<Response> {
  try {
    const models = await task();
    return jsonResponse({ models });
  } catch {
    return emptyModelsResponse();
  }
}

function emptyModelsResponse(): Response {
  return jsonResponse({ models: [] });
}

export async function handleModelsRoute(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const service = url.searchParams.get("service");
  const validate = url.searchParams.get("validate") === "1";
  const groqKey =
    req.headers.get("X-Groq-Key") || process.env.GROQ_API_KEY || "";
  const cerebrasKey =
    req.headers.get("X-Cerebras-Key") || process.env.CEREBRAS_API_KEY || "";
  const openrouterKey =
    req.headers.get("X-Openrouter-Key") || process.env.OPENROUTER_API_KEY || "";
  const providerKeys = { groqKey, cerebrasKey, openrouterKey };

  if (service === "groq" && groqKey) {
    return modelsResponseFrom(async () => {
      const listed = await fetchModelIds("https://api.groq.com/openai/v1/models", {
        Authorization: `Bearer ${groqKey}`,
      });
      return validate
        ? filterUsableModels("groq", listed, providerKeys)
        : listed;
    });
  }

  if (service === "cerebras" && cerebrasKey) {
    return modelsResponseFrom(async () => {
      const Cerebras = (await import("@cerebras/cerebras_cloud_sdk")).default;
      const cerebras = new Cerebras({ apiKey: cerebrasKey });
      const models = await cerebras.models.list();
      const listed = extractModelIds(models);
      return validate
        ? await filterUsableModels("cerebras", listed, providerKeys)
        : listed;
    });
  }

  if (service === "openrouter") {
    return modelsResponseFrom(async () => {
      const headers = openrouterKey
        ? { Authorization: `Bearer ${openrouterKey}` }
        : undefined;
      const ids = await fetchModelIds(
        "https://openrouter.ai/api/v1/models",
        headers,
      );
      const listed = ids.includes("openrouter/auto")
        ? ids
        : ["openrouter/auto", ...ids];
      const validationCandidates = listed
        .filter((model) => model !== "openrouter/auto")
        .slice(0, 80);
      const validatedCandidates = validate
        ? await filterUsableModels("openrouter", validationCandidates, providerKeys)
        : validationCandidates;
      const canUseAuto = validate
        ? await canUseOpenRouterModel(openrouterKey, "openrouter/auto")
        : true;
      const models = canUseAuto
        ? ["openrouter/auto", ...validatedCandidates]
        : validatedCandidates;
      return Array.from(new Set(models));
    });
  }

  return emptyModelsResponse();
}
