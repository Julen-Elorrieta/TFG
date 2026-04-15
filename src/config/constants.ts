import type { AIService } from "../types/ai";
import { join } from "node:path";

function resolvePublicFile(filename: string): string {
  const dir = import.meta.dir.replace(/\\/g, "/").toLowerCase();
  if (dir.endsWith("/src/config")) {
    return join(import.meta.dir, "../../public", filename);
  }
  if (dir.endsWith("/dist")) {
    return join(import.meta.dir, "../public", filename);
  }
  return join(process.cwd(), "public", filename);
}

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, X-Groq-Key, X-Cerebras-Key, X-Openrouter-Key, X-Groq-Model, X-Cerebras-Model, X-Openrouter-Model",
};

export const staticFiles = {
  html: Bun.file(resolvePublicFile("index.html")),
  css: Bun.file(resolvePublicFile("style.css")),
  js: Bun.file(resolvePublicFile("app.js")),
};

let rrIndex = 0;

export function pickRoundRobinService(services: AIService[]): AIService {
  const service = services[rrIndex % services.length]!;
  rrIndex = (rrIndex + 1) % services.length;
  return service;
}
