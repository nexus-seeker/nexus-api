import {
  EXECUTE_REQUEST_OPTIONAL_FIELDS,
  PROACTIVE_RECOMMENDATION_STATUSES,
  PROACTIVE_RECOMMENDATION_REQUIRED_FIELDS,
  REJECTION_RECOVERY_ACTION_TYPES,
  RECOMMENDATION_FEEDBACK_OUTCOMES,
} from './mvp';
import type {
  ExecuteRequest,
  ExecuteResponse,
  ProactiveRecommendationDto,
} from './mvp';

describe('mvp contracts', () => {
  it('supports optional threadId on execute requests', () => {
    const req: ExecuteRequest = {
      intent: 'Swap 1 SOL to USDC',
      pubkey: 'wallet',
    };

    expect(EXECUTE_REQUEST_OPTIONAL_FIELDS).toContain('threadId');
    expect(req.intent).toBe('Swap 1 SOL to USDC');
  });

  it('includes confidence and actions in proactive recommendations', () => {
    const rec: ProactiveRecommendationDto = {
      id: 'rec-1',
      pubkey: 'wallet',
      threadId: 'thread-1',
      title: 'BONK moved -12%',
      summary: 'Position impact detected',
      confidence: 0.82,
      status: 'pending',
      actions: [{ id: 'review', label: 'Review Action', type: 'open' }],
      createdAt: Date.now(),
    };

    expect(PROACTIVE_RECOMMENDATION_REQUIRED_FIELDS).toEqual(
      expect.arrayContaining(['confidence', 'status', 'actions']),
    );
    expect(rec.actions[0].label).toBe('Review Action');
  });

  it('keeps recommendation statuses and feedback outcomes aligned', () => {
    expect(PROACTIVE_RECOMMENDATION_STATUSES).toEqual(
      expect.arrayContaining(['pending', 'approved', 'rejected', 'ignored']),
    );
    expect(RECOMMENDATION_FEEDBACK_OUTCOMES).toEqual(
      expect.arrayContaining(['approved', 'rejected', 'ignored']),
    );
  });

  it('supports structured recovery payload on execute rejection responses', () => {
    const response: ExecuteResponse = {
      runId: 'run-1',
      steps: [],
      rejection: {
        reason: 'Invalid amountLamports',
        policyField: 'amount_lamports',
      },
      recovery: {
        summary: 'Amount parsed as 0 lamports.',
        likelyIntent: 'Transfer 0.5 SOL to bene.skr',
        suggestedActions: [
          {
            id: 'retry_fixed_amount',
            label: 'Retry with 0.5 SOL',
            type: 'retry_intent',
            intent: 'tf to bene.skr 0.5 sol',
          },
        ],
        recommendedActionId: 'retry_fixed_amount',
      },
    };

    expect(response.recovery?.suggestedActions[0]?.type).toBe('retry_intent');
  });

  it('exports the supported rejection recovery action types', () => {
    expect(REJECTION_RECOVERY_ACTION_TYPES).toEqual(
      expect.arrayContaining(['retry_intent', 'open_policy', 'open_onboarding']),
    );
  });
});
