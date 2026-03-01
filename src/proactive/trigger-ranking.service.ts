import { Injectable } from '@nestjs/common';

export interface TriggerRankingFeatures {
  impact: number;
  urgency: number;
  confidence: number;
  novelty: number;
  fatigueBudget: number;
}

export interface TriggerRankingChecks {
  inCooldown?: boolean;
  dailySentCount?: number;
  dailyCap?: number;
}

export interface TriggerDecision {
  score: number;
  threshold: number;
  shouldNotify: boolean;
  suppressedReason?: 'below_threshold' | 'cooldown' | 'daily_cap';
  checks: {
    underCooldown: boolean;
    dailyCapReached: boolean;
  };
}

const WEIGHTS = {
  impact: 0.35,
  urgency: 0.25,
  confidence: 0.2,
  novelty: 0.1,
  fatigueBudget: 0.1,
} as const;

const DEFAULT_THRESHOLD = 0.6;

@Injectable()
export class TriggerRankingService {
  evaluate(
    features: TriggerRankingFeatures,
    checks: TriggerRankingChecks = {},
    threshold = DEFAULT_THRESHOLD,
  ): TriggerDecision {
    const score = this.calculateScore(features);
    const underCooldown = checks.inCooldown === true;
    const dailyCapReached =
      typeof checks.dailyCap === 'number' &&
      typeof checks.dailySentCount === 'number' &&
      checks.dailySentCount >= checks.dailyCap;

    if (underCooldown) {
      return {
        score,
        threshold,
        shouldNotify: false,
        suppressedReason: 'cooldown',
        checks: {
          underCooldown,
          dailyCapReached,
        },
      };
    }

    if (dailyCapReached) {
      return {
        score,
        threshold,
        shouldNotify: false,
        suppressedReason: 'daily_cap',
        checks: {
          underCooldown,
          dailyCapReached,
        },
      };
    }

    if (score < threshold) {
      return {
        score,
        threshold,
        shouldNotify: false,
        suppressedReason: 'below_threshold',
        checks: {
          underCooldown,
          dailyCapReached,
        },
      };
    }

    return {
      score,
      threshold,
      shouldNotify: true,
      checks: {
        underCooldown,
        dailyCapReached,
      },
    };
  }

  private calculateScore(features: TriggerRankingFeatures): number {
    const impact = this.clamp01(features.impact);
    const urgency = this.clamp01(features.urgency);
    const confidence = this.clamp01(features.confidence);
    const novelty = this.clamp01(features.novelty);
    const fatigueBudget = this.clamp01(features.fatigueBudget);

    return Number(
      (
        impact * WEIGHTS.impact +
        urgency * WEIGHTS.urgency +
        confidence * WEIGHTS.confidence +
        novelty * WEIGHTS.novelty +
        fatigueBudget * WEIGHTS.fatigueBudget
      ).toFixed(4),
    );
  }

  private clamp01(value: number): number {
    if (!Number.isFinite(value)) {
      return 0;
    }

    return Math.min(1, Math.max(0, value));
  }
}
