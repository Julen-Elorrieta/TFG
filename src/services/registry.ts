import type { AIService } from "../types/ai";
import {
  createCerebrasService,
  createGroqService,
  createOpenRouterService,
} from "./providers";

type ServiceId = "groq" | "cerebras" | "openrouter";

type ServiceConfig = {
  id: ServiceId;
  keyHeader: string;
  keyEnv: string;
  modelHeader: string;
  modelEnv: string;
  defaultModel: string;
  create: (apiKey: string, model: string) => Promise<AIService>;
};

const serviceConfigs: ServiceConfig[] = [
  {
    id: "groq",
    keyHeader: "X-Groq-Key",
    keyEnv: "GROQ_API_KEY",
    modelHeader: "X-Groq-Model",
    modelEnv: "GROQ_MODEL",
    defaultModel: "moonshotai/kimi-k2-instruct-0905",
    create: createGroqService,
  },
  {
    id: "cerebras",
    keyHeader: "X-Cerebras-Key",
    keyEnv: "CEREBRAS_API_KEY",
    modelHeader: "X-Cerebras-Model",
    modelEnv: "CEREBRAS_MODEL",
    defaultModel: "gpt-oss-120b",
    create: createCerebrasService,
  },
  {
    id: "openrouter",
    keyHeader: "X-Openrouter-Key",
    keyEnv: "OPENROUTER_API_KEY",
    modelHeader: "X-Openrouter-Model",
    modelEnv: "OPENROUTER_MODEL",
    defaultModel: "openrouter/auto",
    create: createOpenRouterService,
  },
];

function readHeaderOrEnvValue(
  req: Request,
  header: string,
  envKey: string,
): string {
  return req.headers.get(header) || process.env[envKey] || "";
}

export async function getServicesFromRequest(req: Request): Promise<{
  registry: Record<string, AIService>;
  roundRobin: AIService[];
}> {
  const registry: Record<string, AIService> = {};
  const roundRobin: AIService[] = [];

  for (const service of serviceConfigs) {
    const apiKey = readHeaderOrEnvValue(req, service.keyHeader, service.keyEnv);
    if (!apiKey) continue;

    const model =
      readHeaderOrEnvValue(req, service.modelHeader, service.modelEnv) ||
      service.defaultModel;
    const serviceInstance = await service.create(apiKey, model);
    registry[service.id] = serviceInstance;
    roundRobin.push(serviceInstance);
  }

  return { registry, roundRobin };
}
