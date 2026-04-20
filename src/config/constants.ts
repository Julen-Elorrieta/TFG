import type { AIService } from "../types/ai";
import { join } from "node:path";

export function resolvePublicAssetPath(filename: string): string {
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

function getStaticModuleAssetFile(name: StaticModuleName): Blob {
  return Bun.file(resolvePublicAssetPath(`modules/${name}.js`));
}

function buildStaticModuleFileMap(): Record<StaticModuleName, Blob> {
  return {
    chat: getStaticModuleAssetFile("chat"),
    export: getStaticModuleAssetFile("export"),
    files: getStaticModuleAssetFile("files"),
    settings: getStaticModuleAssetFile("settings"),
    ui: getStaticModuleAssetFile("ui"),
  };
}

export const staticFiles = {
  html: Bun.file(resolvePublicAssetPath("index.html")),
  css: Bun.file(resolvePublicAssetPath("style.css")),
  js: Bun.file(resolvePublicAssetPath("js/app.js")),
  modules: buildStaticModuleFileMap(),
};

let rrIndex = 0;

export function pickRoundRobinService(services: AIService[]): AIService {
  const service = services[rrIndex % services.length]!;
  rrIndex = (rrIndex + 1) % services.length;
  return service;
}
