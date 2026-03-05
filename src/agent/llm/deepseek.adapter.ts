import { ChatDeepSeek } from '@langchain/deepseek';
import type { LlmClient, LlmConfig } from './llm.interface';

const DEFAULT_MODEL = 'deepseek-chat';

export function createDeepSeekLlm(config: LlmConfig): LlmClient {
  return new ChatDeepSeek({
    modelName: config.model || DEFAULT_MODEL,
    apiKey: config.apiKey,
    temperature: 0,
  });
}
