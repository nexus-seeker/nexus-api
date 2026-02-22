import { ChatOpenAI } from '@langchain/openai';
import type { LlmClient, LlmConfig } from './llm.interface';

const DEFAULT_MODEL = 'gpt-4o-mini';

export function createOpenAiLlm(config: LlmConfig): LlmClient {
    return new ChatOpenAI({
        modelName: config.model || DEFAULT_MODEL,
        apiKey: config.apiKey,
        temperature: 0,
    });
}
