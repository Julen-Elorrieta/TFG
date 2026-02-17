import Cerebras from '@cerebras/cerebras_cloud_sdk';
import type { AIService, ChatMessage } from '../types';

const cerebras = new Cerebras();

// Modelos disponibles en tu cuenta (feb 2026):
// - gpt-oss-120b                      ← el más potente
// - qwen-3-235b-a22b-instruct-2507    ← el más grande
// - zai-glm-4.7                       ← muy bueno para código
// - llama3.1-8b                       ← el más rápido
// Configurable via CEREBRAS_MODEL en .env
const CEREBRAS_MODEL = process.env.CEREBRAS_MODEL ?? 'gpt-oss-120b';

export const cerebrasService: AIService = {
  name: 'Cerebras',
  async chat(messages: ChatMessage[]) {
    console.log(`[Cerebras] Using model: ${CEREBRAS_MODEL}`);
    const stream = await cerebras.chat.completions.create({
      messages: messages as any,
      model: CEREBRAS_MODEL,
      stream: true,
      max_completion_tokens: 8192,
      temperature: 0.6,
      top_p: 0.95
    });

    return (async function* () {
      for await (const chunk of stream) {
        yield (chunk as any).choices[0]?.delta?.content || '';
      }
    })();
  },
  model: ''
};

// Helper para listar modelos disponibles en tu cuenta
export async function listCerebrasModels(): Promise<string[]> {
  try {
    const models = await cerebras.models.list();
    return (models as any).data?.map((m: any) => m.id) ?? [];
  } catch (e) {
    return [];
  }
}