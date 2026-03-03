import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

// ── Provider IDs ────────────────────────────────────────────────────
export const LLM_PROVIDERS = ['openai', 'deepseek'] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

// ── Configuration passed into adapters ──────────────────────────────
export interface LlmConfig {
  provider: LlmProvider;
  apiKey: string | undefined;
  model?: string;
}

// ── Common interface satisfied by every LangChain chat model ────────
export type LlmClient = Pick<BaseChatModel, 'invoke'>;
