import { corsHeaders, pickRoundRobinService } from "../config/constants";
import { getServicesFromRequest } from "../services/registry";
import type { AIService, ChatMessage } from "../types/ai";
import { jsonErrorResponse } from "../utils/http";

type ChatRequestBody = {
  messages: ChatMessage[];
  service?: string;
};

function extractErrorMessageText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isChatMessagePayload(value: unknown): value is ChatMessage {
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
    return jsonErrorResponse("Invalid JSON body", 400);
  }

  const { messages, service: requestedServiceName } = body;
  if (!Array.isArray(messages) || !messages.every(isChatMessagePayload)) {
    return jsonErrorResponse("Invalid messages payload", 400);
  }

  if (
    requestedServiceName !== undefined &&
    typeof requestedServiceName !== "string"
  ) {
    return jsonErrorResponse("Invalid service value", 400);
  }

  const { registry, roundRobin } = await getServicesFromRequest(req);

  if (roundRobin.length === 0) {
    return jsonErrorResponse(
      "No API keys configured. Please add your API keys in the Settings panel.",
      400,
    );
  }

  let service: AIService;
  if (
    requestedServiceName &&
    requestedServiceName !== "auto" &&
    registry[requestedServiceName]
  ) {
    service = registry[requestedServiceName]!;
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
    const errorMessage = extractErrorMessageText(err);
    console.error(`[ERROR] service.chat(${service.name}):`, err);
    return jsonErrorResponse(errorMessage || "Service error", 500, {
      service: service.name.toLowerCase(),
      model: service.model,
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
      } catch (err: unknown) {
        controller.enqueue(
          enc.encode(
            `data: ${JSON.stringify({ error: extractErrorMessageText(err) })}\n\n`,
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
