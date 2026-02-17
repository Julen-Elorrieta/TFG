import { Groq } from 'groq-sdk';
import type { AIService, ChatMessage } from '../types';

const groq = new Groq();

// Modelos recomendados en Groq (feb 2026):
// - moonshotai/kimi-k2-instruct-0905  ← el más inteligente, 262k contexto
// - deepseek-r1-distill-llama-70b     ← razonamiento, ideal para código
// - llama-3.3-70b-versatile           ← estable y fiable
// Configurable via GROQ_MODEL en .env
const GROQ_MODEL = process.env.GROQ_MODEL ?? 'moonshotai/kimi-k2-instruct-0905';

export const groqService: AIService = {
  name: 'Groq',
  async chat(messages: ChatMessage[]) {
    console.log(`[Groq] Using model: ${GROQ_MODEL}`);
    const chatCompletion = await groq.chat.completions.create({
      messages,
      model: GROQ_MODEL,
      temperature: 0.6,
      max_completion_tokens: 4096,
      top_p: 1,
      stream: true,
      stop: null
    });

    return (async function* () {
      for await (const chunk of chatCompletion) {
        yield chunk.choices[0]?.delta?.content || '';
      }
    })();
  }
};