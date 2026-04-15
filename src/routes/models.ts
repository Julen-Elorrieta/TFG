import { corsHeaders } from "../config/constants";

function extractModelIds(models: unknown): string[] {
  if (!models || typeof models !== "object") return [];
  const data = (models as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  return data
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const id = (item as { id?: unknown }).id;
      return typeof id === "string" ? id : null;
    })
    .filter((id): id is string => id !== null);
}

export async function handleModelsRoute(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const service = url.searchParams.get("service");
  const cerebrasKey =
    req.headers.get("X-Cerebras-Key") || process.env.CEREBRAS_API_KEY || "";

  if (service === "cerebras" && cerebrasKey) {
    try {
      const Cerebras = (await import("@cerebras/cerebras_cloud_sdk")).default;
      const cerebras = new Cerebras({ apiKey: cerebrasKey });
      const models = await cerebras.models.list();
      const ids = extractModelIds(models);
      return new Response(JSON.stringify({ models: ids }), {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    } catch {
      return new Response(JSON.stringify({ models: [] }), {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
  }

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
