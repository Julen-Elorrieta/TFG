import { corsHeaders, pickRoundRobinService } from "../config/constants";
import { getServicesFromRequest } from "../services/registry";
import type { AIService, ChatMessage } from "../types/ai";

export async function handleChatRoute(req: Request): Promise<Response> {
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
    service = pickRoundRobinService(roundRobin);
  }

  console.log(
    `[${new Date().toISOString()}] /chat → ${service.name} (${service.model}) | msgs: ${messages.length}`,
  );

  let stream: AsyncIterable<string>;
  try {
    stream = await service.chat(messages);
  } catch (err: any) {
    console.error(`[ERROR] service.chat(${service.name}):`, err);
    return new Response(JSON.stringify({ error: err?.message ?? "Service error" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
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
              enc.encode(`data: ${JSON.stringify({ content: chunk })}\n\n`),
            );
          }
        }
        controller.enqueue(enc.encode("data: [DONE]\n\n"));
      } catch (err: any) {
        controller.enqueue(
          enc.encode(`data: ${JSON.stringify({ error: err?.message })}\n\n`),
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
