import type { AIService } from "../types/ai";
import { join } from "node:path";

export function resolvePublicFile(filename: string): string {
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

export const openRouterHeaders = {
  "HTTP-Referer": "http://localhost:3000",
  "X-Title": "NeuralChat",
};

export const staticModuleNames = [
  "chat",
  "export",
  "files",
  "settings",
  "ui",
] as const;

type StaticModuleName = (typeof staticModuleNames)[number];

function getStaticModuleFile(name: StaticModuleName): Blob {
  return Bun.file(resolvePublicFile(`modules/${name}.js`));
}

function createStaticModuleFiles(): Record<StaticModuleName, Blob> {
  return {
    chat: getStaticModuleFile("chat"),
    export: getStaticModuleFile("export"),
    files: getStaticModuleFile("files"),
    settings: getStaticModuleFile("settings"),
    ui: getStaticModuleFile("ui"),
  };
}

export const staticFiles = {
  html: Bun.file(resolvePublicFile("index.html")),
  css: Bun.file(resolvePublicFile("style.css")),
  js: Bun.file(resolvePublicFile("app.js")),
  modules: createStaticModuleFiles(),
};

let rrIndex = 0;

export function pickRoundRobinService(services: AIService[]): AIService {
  const service = services[rrIndex % services.length]!;
  rrIndex = (rrIndex + 1) % services.length;
  return service;
}
