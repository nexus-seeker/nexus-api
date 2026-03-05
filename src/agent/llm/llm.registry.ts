import {
  LLM_PROVIDERS,
  type LlmClient,
  type LlmConfig,
  type LlmProvider,
} from './llm.interface';
import { createOpenAiLlm } from './openai.adapter';
import { createDeepSeekLlm } from './deepseek.adapter';

// ── Adapter map — add a new entry here to support a new provider ────
const ADAPTERS: Record<LlmProvider, (config: LlmConfig) => LlmClient> = {
  openai: createOpenAiLlm,
  deepseek: createDeepSeekLlm,
};

export function buildLlm(config: LlmConfig): LlmClient {
  const provider = config.provider;

  if (!LLM_PROVIDERS.includes(provider)) {
    throw new Error(
      `Unsupported LLM provider: "${provider}". Supported: ${LLM_PROVIDERS.join(', ')}.`,
    );
  }

  return ADAPTERS[provider](config);
}
