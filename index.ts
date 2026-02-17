// ── Fix SSL certificate issues on Windows ───────────────────────────────────
// Bun on Windows often can't find the system root CA bundle.
// Safe for local development; remove in production with proper certs.
if (process.env.NODE_ENV !== "production") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

import { groqService } from "./services/groq";
import { cerebrasService, listCerebrasModels } from "./services/cerebras";
import type { AIService, ChatMessage } from "./types";

// ── Service registry ────────────────────────────────────────────────────────
const serviceRegistry: Record<string, AIService> = {
  groq: groqService,
  cerebras: cerebrasService,
  // Add new services here: openrouter: openRouterService, etc.
};

const roundRobinServices: AIService[] = [groqService, cerebrasService];
let rrIndex = 0;

function getService(name?: string): AIService {
  if (name && serviceRegistry[name]) return serviceRegistry[name];
  // Round-robin fallback
  const svc = roundRobinServices[rrIndex]!;
  rrIndex = (rrIndex + 1) % roundRobinServices.length;
  return svc;
}

// ── PDF text extraction (pure JS, no external deps) ─────────────────────────
async function extractPdfText(buffer: ArrayBuffer): Promise<string> {
  try {
    const bytes = new Uint8Array(buffer);
    const str = new TextDecoder("latin1" as any).decode(bytes);

    // Extract all text between BT (begin text) and ET (end text) markers
    const texts: string[] = [];
    const btEtRegex = /BT([\s\S]*?)ET/g;
    let match;
    while ((match = btEtRegex.exec(str)) !== null) {
      const block = match[1] ?? "";
      if (!block) continue;
      // Extract string literals: (text) and <hex>
      const tjRegex = /\(([^)\\]*(?:\\.[^)\\]*)*)\)|<([0-9a-fA-F]+)>/g;
      let tj;
      while ((tj = tjRegex.exec(block)) !== null) {
        if (tj[1] !== undefined) {
          // Unescape PDF string
          const decoded = tj[1]
            .replace(/\\n/g, "\n")
            .replace(/\\r/g, "\r")
            .replace(/\\t/g, "\t")
            .replace(/\\\(/g, "(")
            .replace(/\\\)/g, ")")
            .replace(/\\\\/g, "\\");
          texts.push(decoded);
        } else if (tj[2] !== undefined) {
          // Hex string
          const hex = tj[2];
          let hexStr = "";
          for (let i = 0; i < hex.length; i += 2) {
            hexStr += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
          }
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
  };
  return map[ext] ?? "application/octet-stream";
}

// ── Serve static frontend files ─────────────────────────────────────────────
const htmlFile = Bun.file(import.meta.dir + "/public/index.html");
const cssFile = Bun.file(import.meta.dir + "/public/style.css");
const jsFile = Bun.file(import.meta.dir + "/public/app.js");

// ── CORS headers ─────────────────────────────────────────────────────────────
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// ── Server ───────────────────────────────────────────────────────────────────
const server = Bun.serve({
  port: process.env.PORT ?? 3000,

  async fetch(req) {
    try {
      const url = new URL(req.url);
      const { pathname } = url;

      // CORS preflight
      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      // ── GET static files ───────────────────────────────────────────────────────
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

      // ── GET /services → list available services ─────────────────────────────
      if (req.method === "GET" && pathname === "/services") {
        return new Response(
          JSON.stringify({
            services: ["auto", ...Object.keys(serviceRegistry)],
          }),
          { headers: { "Content-Type": "application/json", ...corsHeaders } },
        );
      }

      // ── GET /cerebras-models → list models available in your account ─────────
      if (req.method === "GET" && pathname === "/cerebras-models") {
        const models = await listCerebrasModels();
        return new Response(JSON.stringify({ models }), {
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }

      // ── POST /upload → process file, return text/base64 ────────────────────
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

        // PDF → extract text
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

        // Plain text / code → return as UTF-8
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

        // Images → base64 for vision models
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

        // Other binary → base64
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

      // ── POST /chat → streaming AI response ─────────────────────────────────
      if (req.method === "POST" && pathname === "/chat") {
        const body = (await req.json()) as {
          messages: ChatMessage[];
          service?: string;
        };

        const { messages, service: svcName } = body;
        const service = getService(svcName);

        console.log(
          `[${new Date().toISOString()}] /chat → ${service.name} | msgs: ${messages.length} | service param: ${svcName ?? "auto"}`,
        );

        let stream: AsyncIterable<string>;
        try {
          stream = await service.chat(messages);
        } catch (err: any) {
          const msg = err?.message ?? "Service error";
          console.error(`[ERROR] service.chat(${service.name}):`, err);
          return new Response(JSON.stringify({ error: msg }), {
            status: 500,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        }

        // Stream as SSE
        const readable = new ReadableStream({
          async start(controller) {
            const enc = new TextEncoder();
            try {
              // Send which service is being used
              controller.enqueue(
                enc.encode(
                  `data: ${JSON.stringify({ service: service.name })}\n\n`,
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
      const msg = err?.message ?? String(err);
      console.error(`[ERROR] ${req.method} ${req.url}\n`, err);
      return new Response(JSON.stringify({ error: msg }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
  },
});

console.log(`🚀 Server running at ${server.url}`);
console.log(
  `📡 Services: ${Object.keys(serviceRegistry).join(", ")} + auto (round-robin)`,
);
