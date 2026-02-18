// ── Fix SSL certificate issues on Windows ───────────────────────────────────
if (process.env.NODE_ENV !== "production") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

import type { AIService, ChatMessage } from "./types";

// ── PDF text extraction ─────────────────────────────────────────────────────
async function extractPdfText(buffer: ArrayBuffer): Promise<string> {
  try {
    const bytes = new Uint8Array(buffer);
    const str = new TextDecoder("latin1" as any).decode(bytes);
    const texts: string[] = [];
    const btEtRegex = /BT([\s\S]*?)ET/g;
    let match;
    while ((match = btEtRegex.exec(str)) !== null) {
      const block = match[1] ?? "";
      if (!block) continue;
      const tjRegex = /\(([^)\\]*(?:\\.[^)\\]*)*)\)|<([0-9a-fA-F]+)>/g;
      let tj;
      while ((tj = tjRegex.exec(block)) !== null) {
        if (tj[1] !== undefined) {
          const decoded = tj[1]
            .replace(/\\n/g, "\n")
            .replace(/\\r/g, "\r")
            .replace(/\\t/g, "\t")
            .replace(/\\\(/g, "(")
            .replace(/\\\)/g, ")")
            .replace(/\\\\/g, "\\");
          texts.push(decoded);
        } else if (tj[2] !== undefined) {
          const hex = tj[2];
          let hexStr = "";
          for (let i = 0; i < hex.length; i += 2)
            hexStr += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
          texts.push(hexStr);
        }
      }
    }
    const result = texts.join(" ").replace(/\s+/g, " ").trim();
    return result.length > 50
      ? result
      : "[PDF text extraction yielded minimal content — the PDF may use embedded fonts or images for text]";
  } catch {
    return "[Could not extract PDF text]";
  }
}

// ── MIME helpers ─────────────────────────────────────────────────────────────
function getMimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    pdf: "application/pdf",
    txt: "text/plain",
    md: "text/markdown",
    json: "application/json",
    csv: "text/csv",
    js: "text/javascript",
    ts: "text/typescript",
    html: "text/html",
    css: "text/css",
    py: "text/x-python",
    rs: "text/x-rust",
    go: "text/x-go",
    java: "text/x-java",
    cpp: "text/x-c++",
    c: "text/x-c",
    rb: "text/x-ruby",
    php: "text/x-php",
    sh: "text/x-sh",
    yaml: "text/x-yaml",
    yml: "text/x-yaml",
    toml: "text/x-toml",
    xml: "text/xml",
    sql: "text/x-sql",
    dockerfile: "text/plain",
  };
  return map[ext] ?? "application/octet-stream";
}

// ── Dynamic service factory ──────────────────────────────────────────────────
// Services are created per-request using API keys from request headers
// Headers: X-Groq-Key, X-Cerebras-Key, X-Openrouter-Key
// This replaces .env for API key management

async function createGroqService(
  apiKey: string,
  model: string,
): Promise<AIService> {
  return {
    name: "Groq",
    model,
    async chat(messages: ChatMessage[]) {
      const { Groq } = await import("groq-sdk");
      const groq = new Groq({ apiKey });
      const completion = await groq.chat.completions.create({
        messages,
        model,
        temperature: 0.6,
        max_completion_tokens: 8192,
        top_p: 1,
        stream: true,
        stop: null,
      });
      return (async function* () {
        for await (const chunk of completion) {
          yield chunk.choices[0]?.delta?.content || "";
        }
      })();
    },
  };
}

async function createCerebrasService(
  apiKey: string,
  model: string,
): Promise<AIService> {
  return {
    name: "Cerebras",
    model,
    async chat(messages: ChatMessage[]) {
      const Cerebras = (await import("@cerebras/cerebras_cloud_sdk")).default;
      const cerebras = new Cerebras({ apiKey });
      const stream = await cerebras.chat.completions.create({
        messages: messages as any,
        model,
        stream: true,
        max_completion_tokens: 8192,
        temperature: 0.6,
        top_p: 0.95,
      });
      return (async function* () {
        for await (const chunk of stream) {
          yield (chunk as any).choices[0]?.delta?.content || "";
        }
      })();
    },
  };
}

async function createOpenRouterService(
  apiKey: string,
  model: string,
): Promise<AIService> {
  return {
    name: "OpenRouter",
    model,
    async chat(messages: ChatMessage[]) {
      const OpenAI = (await import("openai")).default;
      const client = new OpenAI({
        apiKey,
        baseURL: "https://openrouter.ai/api/v1",
        defaultHeaders: {
          "HTTP-Referer": "http://localhost:3000",
          "X-Title": "NeuralChat",
        },
      });

      const stream = await client.chat.completions.create({
        model,
        messages: messages as any,
        stream: true,
        temperature: 0.6,
        max_tokens: 8192,
      });

      return (async function* () {
        for await (const chunk of stream) {
          yield chunk.choices[0]?.delta?.content || "";
        }
      })();
    },
  };
}

// ── Get services from request headers ────────────────────────────────────────
async function getServicesFromRequest(req: Request): Promise<{
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

// ── Static files ─────────────────────────────────────────────────────────────
const htmlFile = Bun.file(import.meta.dir + "/public/index.html");
const cssFile = Bun.file(import.meta.dir + "/public/style.css");
const jsFile = Bun.file(import.meta.dir + "/public/app.js");

// ── CORS headers ─────────────────────────────────────────────────────────────
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, X-Groq-Key, X-Cerebras-Key, X-Openrouter-Key, X-Groq-Model, X-Cerebras-Model, X-Openrouter-Model",
};

// ── Round-robin state (per-server, not per-request) ──────────────────────────
let rrIndex = 0;

// ── Server ───────────────────────────────────────────────────────────────────
const server = Bun.serve({
  port: process.env.PORT ?? 3000,

  async fetch(req) {
    try {
      const url = new URL(req.url);
      const { pathname } = url;

      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      // ── Static files ─────────────────────────────────────────────────────
      if (
        req.method === "GET" &&
        (pathname === "/" || pathname === "/index.html")
      ) {
        return new Response(htmlFile, {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            ...corsHeaders,
          },
        });
      }
      if (req.method === "GET" && pathname === "/style.css") {
        return new Response(cssFile, {
          headers: {
            "Content-Type": "text/css; charset=utf-8",
            ...corsHeaders,
          },
        });
      }
      if (req.method === "GET" && pathname === "/app.js") {
        return new Response(jsFile, {
          headers: {
            "Content-Type": "application/javascript; charset=utf-8",
            ...corsHeaders,
          },
        });
      }

      // ── GET /services → list available services based on provided keys ────
      if (req.method === "GET" && pathname === "/services") {
        const { registry } = await getServicesFromRequest(req);
        const services = Object.keys(registry);
        if (services.length > 0) services.unshift("auto");
        return new Response(JSON.stringify({ services }), {
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }

      // ── GET /models → list available models for a service ─────────────────
      if (req.method === "GET" && pathname === "/models") {
        const service = url.searchParams.get("service");
        const cerebrasKey =
          req.headers.get("X-Cerebras-Key") ||
          process.env.CEREBRAS_API_KEY ||
          "";

        if (service === "cerebras" && cerebrasKey) {
          try {
            const Cerebras = (await import("@cerebras/cerebras_cloud_sdk"))
              .default;
            const cerebras = new Cerebras({ apiKey: cerebrasKey });
            const models = await cerebras.models.list();
            const ids = (models as any).data?.map((m: any) => m.id) ?? [];
            return new Response(JSON.stringify({ models: ids }), {
              headers: { "Content-Type": "application/json", ...corsHeaders },
            });
          } catch {
            return new Response(JSON.stringify({ models: [] }), {
              headers: { "Content-Type": "application/json", ...corsHeaders },
            });
          }
        }

        // Groq models
        if (service === "groq") {
          return new Response(
            JSON.stringify({
              models: [
                "moonshotai/kimi-k2-instruct-0905",
                "deepseek-r1-distill-llama-70b",
                "llama-3.3-70b-versatile",
                "llama3-70b-8192",
                "llama3-8b-8192",
                "mixtral-8x7b-32768",
                "gemma2-9b-it",
              ],
            }),
            { headers: { "Content-Type": "application/json", ...corsHeaders } },
          );
        }

        // OpenRouter models
        if (service === "openrouter") {
          return new Response(
            JSON.stringify({
              models: [
                "openrouter/auto",
                "google/gemini-2.0-flash-exp:free",
                "meta-llama/llama-3.3-70b-instruct:free",
                "deepseek/deepseek-r1:free",
                "microsoft/phi-4:free",
                "qwen/qwq-32b:free",
                "google/gemma-3-27b-it:free",
                "nousresearch/deephermes-3-llama-3-8b-preview:free",
              ],
            }),
            { headers: { "Content-Type": "application/json", ...corsHeaders } },
          );
        }

        return new Response(JSON.stringify({ models: [] }), {
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }

      // ── POST /upload ──────────────────────────────────────────────────────
      if (req.method === "POST" && pathname === "/upload") {
        const formData = await req.formData();
        const file = formData.get("file") as File | null;
        if (!file) {
          return new Response(JSON.stringify({ error: "No file provided" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        }

        const filename = file.name;
        const mimeType = getMimeType(filename);
        const buffer = await file.arrayBuffer();

        if (mimeType === "application/pdf") {
          const text = await extractPdfText(buffer);
          return new Response(
            JSON.stringify({
              type: "text",
              filename,
              content: text,
              mimeType,
              size: buffer.byteLength,
            }),
            { headers: { "Content-Type": "application/json", ...corsHeaders } },
          );
        }

        if (mimeType.startsWith("text/") || mimeType === "application/json") {
          const text = new TextDecoder().decode(buffer);
          return new Response(
            JSON.stringify({
              type: "text",
              filename,
              content: text,
              mimeType,
              size: buffer.byteLength,
            }),
            { headers: { "Content-Type": "application/json", ...corsHeaders } },
          );
        }

        if (mimeType.startsWith("image/")) {
          const base64 = Buffer.from(buffer).toString("base64");
          return new Response(
            JSON.stringify({
              type: "image",
              filename,
              content: base64,
              mimeType,
              size: buffer.byteLength,
            }),
            { headers: { "Content-Type": "application/json", ...corsHeaders } },
          );
        }

        const base64 = Buffer.from(buffer).toString("base64");
        return new Response(
          JSON.stringify({
            type: "binary",
            filename,
            content: base64,
            mimeType,
            size: buffer.byteLength,
          }),
          { headers: { "Content-Type": "application/json", ...corsHeaders } },
        );
      }

      // ── POST /chat ────────────────────────────────────────────────────────
      if (req.method === "POST" && pathname === "/chat") {
        const body = (await req.json()) as {
          messages: ChatMessage[];
          service?: string;
        };
        const { messages, service: svcName } = body;

        const { registry, roundRobin } = await getServicesFromRequest(req);

        if (roundRobin.length === 0) {
          return new Response(
            JSON.stringify({
              error:
                "No API keys configured. Please add your API keys in the Settings panel.",
            }),
            {
              status: 400,
              headers: { "Content-Type": "application/json", ...corsHeaders },
            },
          );
        }

        let service: AIService;
        if (svcName && svcName !== "auto" && registry[svcName]) {
          service = registry[svcName]!;
        } else {
          service = roundRobin[rrIndex % roundRobin.length]!;
          rrIndex = (rrIndex + 1) % roundRobin.length;
        }

        console.log(
          `[${new Date().toISOString()}] /chat → ${service.name} (${service.model}) | msgs: ${messages.length}`,
        );

        let stream: AsyncIterable<string>;
        try {
          stream = await service.chat(messages);
        } catch (err: any) {
          console.error(`[ERROR] service.chat(${service.name}):`, err);
          return new Response(
            JSON.stringify({ error: err?.message ?? "Service error" }),
            {
              status: 500,
              headers: { "Content-Type": "application/json", ...corsHeaders },
            },
          );
        }

        const readable = new ReadableStream({
          async start(controller) {
            const enc = new TextEncoder();
            try {
              controller.enqueue(
                enc.encode(
                  `data: ${JSON.stringify({ service: service.name, model: service.model })}\n\n`,
                ),
              );
              for await (const chunk of stream) {
                if (chunk) {
                  controller.enqueue(
                    enc.encode(
                      `data: ${JSON.stringify({ content: chunk })}\n\n`,
                    ),
                  );
                }
              }
              controller.enqueue(enc.encode("data: [DONE]\n\n"));
            } catch (err: any) {
              controller.enqueue(
                enc.encode(
                  `data: ${JSON.stringify({ error: err?.message })}\n\n`,
                ),
              );
            } finally {
              controller.close();
            }
          },
        });

        return new Response(readable, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            "X-Service": service.name,
            ...corsHeaders,
          },
        });
      }

      return new Response("Not found", { status: 404, headers: corsHeaders });
    } catch (err: any) {
      console.error(`[ERROR] ${req.method} ${req.url}\n`, err);
      return new Response(
        JSON.stringify({ error: err?.message ?? String(err) }),
        {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        },
      );
    }
  },
});

console.log(`🚀 NeuralChat server running at ${server.url}`);
