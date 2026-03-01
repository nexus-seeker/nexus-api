import { TriggerRankingService } from './trigger-ranking.service';

describe('TriggerRankingService', () => {
  it('suppresses low score recommendations under threshold', () => {
    const service = new TriggerRankingService();

    const decision = service.evaluate({
      impact: 0.2,
      urgency: 0.1,
      confidence: 0.4,
      novelty: 0.1,
      fatigueBudget: 0.9,
    });

    expect(decision.shouldNotify).toBe(false);
  });

  it('suppresses notifications when under cooldown even with high score', () => {
    const service = new TriggerRankingService();

    const decision = service.evaluate(
      {
        impact: 0.9,
        urgency: 0.9,
        confidence: 0.9,
        novelty: 0.8,
        fatigueBudget: 0.8,
      },
      { inCooldown: true },
    );

    expect(decision.shouldNotify).toBe(false);
    expect(decision.suppressedReason).toBe('cooldown');
  });

  it('treats non-finite feature values as zero', () => {
    const service = new TriggerRankingService();

    const decision = service.evaluate({
      impact: Number.NaN,
      urgency: Number.POSITIVE_INFINITY,
      confidence: Number.NEGATIVE_INFINITY,
      novelty: 0.2,
      fatigueBudget: 0.1,
    });

    expect(decision.score).toBeGreaterThanOrEqual(0);
    expect(decision.score).toBeLessThanOrEqual(1);
    expect(decision.shouldNotify).toBe(false);
  });
});
