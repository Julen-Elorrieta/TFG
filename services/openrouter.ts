import type { AIService, ChatMessage } from '../types';

// OpenRouter usa la API compatible con OpenAI
// Modelos gratuitos recomendados (feb 2026):
// - google/gemini-2.0-flash-exp:free       ← 1M contexto, muy rápido
// - meta-llama/llama-3.3-70b-instruct:free ← nivel GPT-4
// - deepseek/deepseek-r1:free              ← razonamiento
// - openrouter/auto                        ← selección automática del mejor gratuito
// Configurable via OPENROUTER_MODEL en .env
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL ?? 'openrouter/auto';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? '';

export const openRouterService: AIService = {
  name: 'Openrouter',
  async chat(messages: ChatMessage[]) {
    console.log(`[OpenRouter] Using model: ${OPENROUTER_MODEL}`);

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'NeuralChat',
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages,
        stream: true,
        temperature: 0.6,
        max_tokens: 4096,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`OpenRouter error ${res.status}: ${(err as any)?.error?.message ?? res.statusText}`);
    }

    const reader = res.body!.getReader();
    const dec = new TextDecoder();

    return (async function* () {
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += dec.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (data === '[DONE]') return;
          try {
            const parsed = JSON.parse(data);
            const chunk = parsed.choices?.[0]?.delta?.content;
            if (chunk) yield chunk;
          } catch { /* skip malformed chunks */ }
        }
      }
    })();
  }
};