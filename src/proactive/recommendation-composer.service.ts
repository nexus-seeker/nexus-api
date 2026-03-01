import { Injectable } from '@nestjs/common';
import type { ProactiveRecommendationActionDto } from '../contracts/mvp';

export interface ComposeRecommendationInput {
  title: string;
  summary: string;
  confidence: number;
  riskNote?: string;
}

export interface ComposedRecommendation {
  title: string;
  summary: string;
  confidence: number;
  actions: ProactiveRecommendationActionDto[];
}

@Injectable()
export class RecommendationComposerService {
  compose(input: ComposeRecommendationInput): ComposedRecommendation {
    const trimmedTitle = input.title.trim();
    const trimmedSummary = input.summary.trim();
    const trimmedRiskNote = input.riskNote?.trim();

    const summary = trimmedRiskNote
      ? `${trimmedSummary} Risk note: ${trimmedRiskNote}`
      : trimmedSummary;

    return {
      title: trimmedTitle,
      summary,
      confidence: this.normalizeConfidence(input.confidence),
      actions: [
        { id: 'open', label: 'Review action', type: 'open' },
        { id: 'approve', label: 'Approve', type: 'approve' },
        { id: 'reject', label: 'Reject', type: 'reject' },
        { id: 'ignore', label: 'Ignore', type: 'ignore' },
      ],
    };
  }

  private normalizeConfidence(confidence: number): number {
    if (Number.isNaN(confidence)) {
      return 0;
    }

    return Number(Math.min(1, Math.max(0, confidence)).toFixed(4));
  }
}
