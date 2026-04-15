import type { AIService, ChatMessage } from "../types/ai";

type DeltaChunk = {
  choices?: Array<{
    delta?: {
      content?: string | null;
    };
  }>;
};

function toDeltaContent(chunk: unknown): string {
  if (!chunk || typeof chunk !== "object") return "";
  const choices = (chunk as DeltaChunk).choices;
  const content = choices?.[0]?.delta?.content;
  return typeof content === "string" ? content : "";
}

export async function createGroqService(
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

export async function createCerebrasService(
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
        messages,
        model,
        stream: true,
        max_completion_tokens: 8192,
        temperature: 0.6,
        top_p: 0.95,
      });
      return (async function* () {
        for await (const chunk of stream) {
          yield toDeltaContent(chunk);
        }
      })();
    },
  };
}

export async function createOpenRouterService(
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
        messages,
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
