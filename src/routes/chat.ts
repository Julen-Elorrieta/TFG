import { corsHeaders, pickRoundRobinService } from "../config/constants";
import { getServicesFromRequest } from "../services/registry";
import type { AIService, ChatMessage } from "../types/ai";

type ChatRequestBody = {
  messages: ChatMessage[];
  service?: string;
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isValidChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== "object") return false;
  const msg = value as Record<string, unknown>;
  const validRole =
    msg.role === "user" || msg.role === "assistant" || msg.role === "system";
  return validRole && typeof msg.content === "string";
}

export async function handleChatRoute(req: Request): Promise<Response> {
  let body: ChatRequestBody;
  try {
    body = (await req.json()) as ChatRequestBody;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  const { messages, service: svcName } = body;
  if (!Array.isArray(messages) || !messages.every(isValidChatMessage)) {
    return new Response(JSON.stringify({ error: "Invalid messages payload" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  if (svcName !== undefined && typeof svcName !== "string") {
    return new Response(JSON.stringify({ error: "Invalid service value" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

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
  } catch (err: unknown) {
    const errorMessage = getErrorMessage(err);
    console.error(`[ERROR] service.chat(${service.name}):`, err);
    const errorPayload = {
      error: errorMessage || "Service error",
      service: service.name.toLowerCase(),
      model: service.model,
    };
    return new Response(
      JSON.stringify(errorPayload),
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
              enc.encode(`data: ${JSON.stringify({ content: chunk })}\n\n`),
            );
          }
        }
        controller.enqueue(enc.encode("data: [DONE]\n\n"));
      } catch (err: unknown) {
        controller.enqueue(
          enc.encode(
            `data: ${JSON.stringify({ error: getErrorMessage(err) })}\n\n`,
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
