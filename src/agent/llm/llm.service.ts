import { Injectable } from '@nestjs/common';
import { LLM_PROVIDERS, type LlmClient, type LlmProvider } from './llm.interface';
import { buildLlm } from './llm.registry';

@Injectable()
export class LlmService {
    getLlm(): LlmClient {
        const rawProvider = (process.env.LLM_PROVIDER || 'openai').toLowerCase();

        if (!LLM_PROVIDERS.includes(rawProvider as LlmProvider)) {
            throw new Error(
                `Unsupported LLM provider: "${rawProvider}". Supported: ${LLM_PROVIDERS.join(', ')}.`,
            );
        }

        return buildLlm({
            provider: rawProvider as LlmProvider,
            apiKey: process.env.LLM_API_KEY || process.env.OPENAI_API_KEY,
            model: process.env.LLM_MODEL,
        });
    }
}
