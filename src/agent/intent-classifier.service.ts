import { Injectable, Logger } from '@nestjs/common';
import type { LlmClient } from './llm/llm.interface';

// The 6 canonical intent classes from the NEXUS Agent System Design v3.0.
export type IntentClass =
  | 'casual'
  | 'read'
  | 'action'
  | 'safety'
  | 'learn'
  | 'complex';

const VALID_INTENT_CLASSES = new Set<IntentClass>([
  'casual',
  'read',
  'action',
  'safety',
  'learn',
  'complex',
]);

const CLASSIFIER_SYSTEM_PROMPT = `You are an intent classifier for a Solana DeFi AI assistant.
Classify the user's message into EXACTLY ONE of these 6 intent classes:

casual   — greetings, social chat, "how are you", "what can you do", "thanks"
read     — read-only queries: wallet balances, tx history, PnL, token prices, yield comparison, gas fees
action   — execute a transaction: swap, send, stake, add liquidity, DCA, buy NFT, set limit order
safety   — risk/security questions: suspicious airdrops, scam links, phishing, wallet drainers, failed txs
learn    — educational questions: concepts (impermanent loss, APR vs APY, staking), protocol comparisons
complex  — ambiguous or compound requests: "optimize my portfolio", "do something useful with my SOL"

Respond with ONLY the intent class string — no explanation, no JSON, no punctuation. One word.`;

@Injectable()
export class IntentClassifierService {
  private readonly logger = new Logger(IntentClassifierService.name);

  /**
   * Classifies a user message into one of the 6 NEXUS intent classes.
   * Falls back to 'action' if the LLM response is unexpected or times out.
   */
  async classify(message: string, llm: LlmClient): Promise<IntentClass> {
    try {
      const response = await llm.invoke([
        { role: 'system', content: CLASSIFIER_SYSTEM_PROMPT },
        { role: 'user', content: message },
      ]);

      const raw =
        typeof response.content === 'string'
          ? response.content.trim().toLowerCase()
          : '';

      if (VALID_INTENT_CLASSES.has(raw as IntentClass)) {
        this.logger.debug(
          `Intent classified as: ${raw} for: "${message.slice(0, 60)}"`,
        );
        return raw as IntentClass;
      }

      // Partial match fallback (e.g. LLM returned "action intent" or "read query")
      for (const cls of VALID_INTENT_CLASSES) {
        if (raw.includes(cls)) {
          this.logger.debug(`Intent partial-matched as: ${cls}`);
          return cls;
        }
      }

      this.logger.warn(
        `Unexpected intent class "${raw}" — defaulting to "action" for safety.`,
      );
      return 'action';
    } catch (err: any) {
      this.logger.error(
        `Intent classification failed: ${err?.message} — defaulting to "action"`,
      );
      return 'action';
    }
  }
}
