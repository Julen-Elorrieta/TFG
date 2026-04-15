import { corsHeaders, staticFiles } from "./config/constants";
import { handleChatRoute } from "./routes/chat";
import { handleModelsRoute } from "./routes/models";
import { handleServicesRoute } from "./routes/services";
import { handleUploadRoute } from "./routes/upload";

const server = Bun.serve({
  port: process.env.PORT ?? 3000,

  async fetch(req) {
    try {
      const url = new URL(req.url);
      const { pathname } = url;

      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      if (
        req.method === "GET" &&
        (pathname === "/" || pathname === "/index.html")
      ) {
        return new Response(staticFiles.html, {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-cache",
            ...corsHeaders,
          },
        });
      }
      if (
        req.method === "GET" &&
        (pathname === "/style.css" || pathname === "/css/style.css")
      ) {
        return new Response(staticFiles.css, {
          headers: {
            "Content-Type": "text/css; charset=utf-8",
            "Cache-Control": "no-cache",
            ...corsHeaders,
          },
        });
      }
      if (
        req.method === "GET" &&
        (pathname === "/app.js" || pathname === "/js/app.js")
      ) {
        return new Response(staticFiles.js, {
          headers: {
            "Content-Type": "application/javascript; charset=utf-8",
            "Cache-Control": "no-cache",
            ...corsHeaders,
          },
        });
      }

      if (req.method === "GET" && pathname === "/services") {
        return handleServicesRoute(req);
      }

      if (req.method === "GET" && pathname === "/models") {
        return handleModelsRoute(req);
      }

      if (req.method === "POST" && pathname === "/upload") {
        return handleUploadRoute(req);
      }

      if (req.method === "POST" && pathname === "/chat") {
        return handleChatRoute(req);
      }

      return new Response("Not found", { status: 404, headers: corsHeaders });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`[ERROR] ${req.method} ${req.url}\n`, err);
      return new Response(JSON.stringify({ error: errorMessage }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
  },
});

console.log(`🚀 NeuralChat server running at ${server.url}`);
