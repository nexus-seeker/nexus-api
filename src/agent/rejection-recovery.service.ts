import { Injectable } from '@nestjs/common';
import {
  RejectionRecoveryActionDto,
  RejectionRecoveryDto,
  StepEvent,
} from '../contracts/mvp';

const LAMPORTS_PER_SOL = 1_000_000_000;

export interface RejectionRecoveryComposeInput {
  intent?: string;
  rejectionField?: string;
  rejectionReason?: string;
  steps?: StepEvent[];
}

@Injectable()
export class RejectionRecoveryService {
  compose(input: RejectionRecoveryComposeInput): RejectionRecoveryDto {
    const rejectionField = input.rejectionField ?? 'unknown';

    switch (rejectionField) {
      case 'amount_lamports':
        return this.composeAmountLamports(input);
      case 'not_onboarded':
        return this.withTechnicalReason(
          {
            summary:
              'You need to finish policy onboarding before I can run this action.',
            likelyIntent: input.intent,
            suggestedActions: [
              {
                id: 'open_onboarding',
                label: 'Open onboarding',
                type: 'open_onboarding',
              },
            ],
            recommendedActionId: 'open_onboarding',
          },
          input.rejectionReason,
        );
      case 'daily_max':
        return this.withTechnicalReason(
          {
            summary:
              'This request exceeds your policy daily limit. You can adjust your policy or retry with a smaller amount.',
            likelyIntent: input.intent,
            suggestedActions: [
              {
                id: 'open_policy_limits',
                label: 'Review policy limits',
                type: 'open_policy',
              },
            ],
            recommendedActionId: 'open_policy_limits',
          },
          input.rejectionReason,
        );
      case 'protocol_not_allowed':
        return this.withTechnicalReason(
          {
            summary:
              'That protocol is not allowed by your current policy settings.',
            likelyIntent: input.intent,
            suggestedActions: [
              {
                id: 'open_policy_protocols',
                label: 'Allow protocol in policy',
                type: 'open_policy',
              },
            ],
            recommendedActionId: 'open_policy_protocols',
          },
          input.rejectionReason,
        );
      case 'jupiter':
        return this.withTechnicalReason(
          {
            summary:
              'I could not find a safe route for that swap. Try again with a smaller amount or a different pair.',
            likelyIntent: input.intent,
            suggestedActions: this.retryIntentAction(
              'retry_swap',
              'Retry swap intent',
              input.intent,
            ),
            recommendedActionId: 'retry_swap',
          },
          input.rejectionReason,
        );
      case 'tx_assembly':
        return this.withTechnicalReason(
          {
            summary:
              'I could not build the transaction for signing. Retrying usually works.',
            likelyIntent: input.intent,
            suggestedActions: this.retryIntentAction(
              'retry_tx_build',
              'Retry transaction build',
              input.intent,
            ),
            recommendedActionId: 'retry_tx_build',
          },
          input.rejectionReason,
        );
      default:
        return this.withTechnicalReason(
          {
            summary: 'I could not complete that request. Try again or adjust the intent.',
            likelyIntent: input.intent,
            suggestedActions: this.retryIntentAction(
              'retry_request',
              'Retry request',
              input.intent,
            ),
            recommendedActionId: 'retry_request',
          },
          input.rejectionReason,
        );
    }
  }

  private composeAmountLamports(
    input: RejectionRecoveryComposeInput,
  ): RejectionRecoveryDto {
    const intent = input.intent;
    const parsedLamports = this.extractParsedLamports(input.steps);
    const transferLike = this.isTransferLike(intent);
    const recipient = this.extractRecipient(intent);
    const solFromIntent = this.extractSolAmount(intent);

    let retrySolIntent: string | undefined;
    let retryLamportsIntent: string | undefined;

    if (transferLike && recipient) {
      if (solFromIntent !== null) {
        const solText = this.formatSol(solFromIntent);
        const lamports = Math.round(solFromIntent * LAMPORTS_PER_SOL);
        retrySolIntent = `tf to ${recipient} ${solText} sol`;
        retryLamportsIntent = `tf to ${recipient} ${lamports} lamports`;
      } else if (parsedLamports !== null && parsedLamports > 0) {
        const sol = parsedLamports / LAMPORTS_PER_SOL;
        retrySolIntent = `tf to ${recipient} ${this.formatSol(sol)} sol`;
        retryLamportsIntent = `tf to ${recipient} ${parsedLamports} lamports`;
      }
    }

    const suggestedActions: RejectionRecoveryActionDto[] = [];
    if (retrySolIntent) {
      suggestedActions.push({
        id: 'retry_transfer_sol',
        label: 'Retry transfer with SOL format',
        type: 'retry_intent',
        intent: retrySolIntent,
      });
    }
    if (retryLamportsIntent) {
      suggestedActions.push({
        id: 'retry_transfer_lamports',
        label: 'Retry transfer with lamports format',
        type: 'retry_intent',
        intent: retryLamportsIntent,
      });
    }
    if (suggestedActions.length === 0) {
      suggestedActions.push({
        id: 'retry_amount_intent',
        label: 'Retry with explicit amount',
        type: 'retry_intent',
        intent,
      });
    }

    const amountSummary =
      parsedLamports !== null
        ? `Amount was parsed as ${parsedLamports} lamports.`
        : 'Amount could not be parsed into valid lamports.';

    return this.withTechnicalReason(
      {
        summary: `${amountSummary} Try an explicit transfer amount format.`,
        likelyIntent: retrySolIntent ?? intent,
        suggestedActions,
        recommendedActionId: suggestedActions[0]?.id,
      },
      input.rejectionReason,
    );
  }

  private withTechnicalReason(
    recovery: RejectionRecoveryDto,
    technicalReason?: string,
  ): RejectionRecoveryDto {
    if (!technicalReason) {
      return recovery;
    }
    return {
      ...recovery,
      technicalReason,
    };
  }

  private retryIntentAction(
    id: string,
    label: string,
    intent?: string,
  ): RejectionRecoveryActionDto[] {
    return [
      {
        id,
        label,
        type: 'retry_intent',
        intent,
      },
    ];
  }

  private extractParsedLamports(steps?: StepEvent[]): number | null {
    if (!Array.isArray(steps)) {
      return null;
    }

    for (const step of steps) {
      const payloadLamports = step?.payload?.['amountLamports'];
      if (
        typeof payloadLamports === 'number' &&
        Number.isFinite(payloadLamports) &&
        Number.isInteger(payloadLamports) &&
        payloadLamports >= 0
      ) {
        return payloadLamports;
      }
    }

    return null;
  }

  private isTransferLike(intent?: string): boolean {
    if (!intent) {
      return false;
    }
    return /\b(tf|transfer|send)\b/i.test(intent);
  }

  private extractRecipient(intent?: string): string | null {
    if (!intent) {
      return null;
    }
    const toMatch = intent.match(/\bto\s+([a-zA-Z0-9_.-]+)/i);
    if (toMatch?.[1]) {
      return toMatch[1];
    }
    return null;
  }

  private extractSolAmount(intent?: string): number | null {
    if (!intent) {
      return null;
    }
    const match = intent.match(/((?:\d+(?:\.\d+)?)|(?:\.\d+))\s*sol\b/i);
    if (!match?.[1]) {
      return null;
    }
    const parsed = Number(match[1]);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null;
    }
    return parsed;
  }

  private formatSol(amount: number): string {
    return Number(amount.toFixed(9)).toString();
  }
}
