import type { AIService } from "../types/ai";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, X-Groq-Key, X-Cerebras-Key, X-Openrouter-Key, X-Groq-Model, X-Cerebras-Model, X-Openrouter-Model",
};

export const staticFiles = {
  html: Bun.file(import.meta.dir + "/../../public/index.html"),
  css: Bun.file(import.meta.dir + "/../../public/style.css"),
  js: Bun.file(import.meta.dir + "/../../public/app.js"),
};

let rrIndex = 0;

export function pickRoundRobinService(services: AIService[]): AIService {
  const service = services[rrIndex % services.length]!;
  rrIndex = (rrIndex + 1) % services.length;
  return service;
}
