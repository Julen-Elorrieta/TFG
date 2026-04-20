import { corsHeaders, staticFiles, staticModuleNames } from "./config/constants";
import { handleChatRoute } from "./routes/chat";
import { handleModelsRoute } from "./routes/models";
import { handleServicesRoute } from "./routes/services";
import { handleUploadRoute } from "./routes/upload";
import { jsonErrorResponse } from "./utils/http";

type StaticAsset = {
  file: Blob;
  contentType: string;
};

type RouteHandler = (req: Request) => Promise<Response>;
const JS_CONTENT_TYPE = "application/javascript; charset=utf-8";

function mapStaticAsset(
  paths: string[],
  file: Blob,
  contentType: string,
): Array<[string, StaticAsset]> {
  return paths.map((path) => [path, { file, contentType }]);
}

function mapModuleAssets(): Array<[string, StaticAsset]> {
  return staticModuleNames.map((name) => [
    `/modules/${name}.js`,
    {
      file: staticFiles.modules[name],
      contentType: JS_CONTENT_TYPE,
    },
  ]);
}

const staticAssets: Record<string, StaticAsset> = Object.fromEntries([
  ...mapStaticAsset(
    ["/", "/index.html"],
    staticFiles.html,
    "text/html; charset=utf-8",
  ),
  ...mapStaticAsset(
    ["/css/style.css"],
    staticFiles.css,
    "text/css; charset=utf-8",
  ),
  ...mapStaticAsset(
    ["/js/app.js"],
    staticFiles.js,
    JS_CONTENT_TYPE,
  ),
  ...mapModuleAssets(),
]);

const apiRoutes: Record<string, RouteHandler> = {
  "GET /services": handleServicesRoute,
  "GET /models": handleModelsRoute,
  "POST /upload": handleUploadRoute,
  "POST /chat": handleChatRoute,
};

function createStaticResponse(asset: StaticAsset): Response {
  return new Response(asset.file, {
    headers: {
      "Content-Type": asset.contentType,
      "Cache-Control": "no-cache",
      ...corsHeaders,
    },
  });
}

const server = Bun.serve({
  port: process.env.PORT ?? 3000,

  async fetch(req) {
    try {
      const url = new URL(req.url);
      const { pathname } = url;

      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      if (req.method === "GET") {
        const staticAsset = staticAssets[pathname];
        if (staticAsset) {
          return createStaticResponse(staticAsset);
        }
      }

      const routeHandler = apiRoutes[`${req.method} ${pathname}`];
      if (routeHandler) {
        return routeHandler(req);
      }

      return new Response("Not found", { status: 404, headers: corsHeaders });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`[ERROR] ${req.method} ${req.url}\n`, err);
      return jsonErrorResponse(errorMessage, 500);
    }
  },
});

console.log(`🚀 NeuralChat server running at ${server.url}`);
