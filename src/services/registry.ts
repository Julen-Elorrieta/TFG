import type { AIService } from "../types/ai";
import {
  createCerebrasService,
  createGroqService,
  createOpenRouterService,
} from "./providers";

export async function getServicesFromRequest(req: Request): Promise<{
  registry: Record<string, AIService>;
  roundRobin: AIService[];
}> {
  const registry: Record<string, AIService> = {};
  const roundRobin: AIService[] = [];

  const groqKey =
    req.headers.get("X-Groq-Key") || process.env.GROQ_API_KEY || "";
  const groqModel =
    req.headers.get("X-Groq-Model") ||
    process.env.GROQ_MODEL ||
    "moonshotai/kimi-k2-instruct-0905";
  if (groqKey) {
    const svc = await createGroqService(groqKey, groqModel);
    registry["groq"] = svc;
    roundRobin.push(svc);
  }

  const cerebrasKey =
    req.headers.get("X-Cerebras-Key") || process.env.CEREBRAS_API_KEY || "";
  const cerebrasModel =
    req.headers.get("X-Cerebras-Model") ||
    process.env.CEREBRAS_MODEL ||
    "gpt-oss-120b";
  if (cerebrasKey) {
    const svc = await createCerebrasService(cerebrasKey, cerebrasModel);
    registry["cerebras"] = svc;
    roundRobin.push(svc);
  }

  const openrouterKey =
    req.headers.get("X-Openrouter-Key") || process.env.OPENROUTER_API_KEY || "";
  const openrouterModel =
    req.headers.get("X-Openrouter-Model") ||
    process.env.OPENROUTER_MODEL ||
    "openrouter/auto";
  if (openrouterKey) {
    const svc = await createOpenRouterService(openrouterKey, openrouterModel);
    registry["openrouter"] = svc;
    roundRobin.push(svc);
  }

  return { registry, roundRobin };
}
