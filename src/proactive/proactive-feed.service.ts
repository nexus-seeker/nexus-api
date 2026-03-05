import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, ProactiveRecommendationStatus } from '@prisma/client';
import type {
  ProactiveFeedResponse,
  ProactiveRecommendationActionDto,
  ProactiveRecommendationDto,
  RecommendationFeedbackRequest,
} from '../contracts/mvp';
import { PrismaService } from '../database/prisma.service';
import {
  DispatchNotificationInput,
  DispatchNotificationResult,
  NotificationDispatcherService,
} from './notification-dispatcher.service';

const DEFAULT_FEED_LIMIT = 20;
const MAX_FEED_LIMIT = 50;
const TERMINAL_OUTCOMES = new Set(['approved', 'rejected', 'ignored']);

@Injectable()
export class ProactiveFeedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationDispatcher?: NotificationDispatcherService,
  ) {}

  async getFeed(
    pubkey: string,
    threadId?: string,
    limit = DEFAULT_FEED_LIMIT,
  ): Promise<ProactiveFeedResponse> {
    const normalizedPubkey = pubkey.trim();
    if (!normalizedPubkey) {
      throw new BadRequestException('pubkey query parameter is required');
    }

    const normalizedThreadId = threadId?.trim();
    const normalizedLimit = Math.max(1, Math.min(MAX_FEED_LIMIT, limit));

    const recommendations = await this.prisma.proactiveRecommendation.findMany({
      where: {
        walletPubkey: normalizedPubkey,
        ...(normalizedThreadId ? { threadId: normalizedThreadId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: normalizedLimit,
    });

    return {
      recommendations: recommendations.map((row) => this.toDto(row)),
    };
  }

  async recordFeedback(
    recommendationId: string,
    request: RecommendationFeedbackRequest,
  ): Promise<{ recommendationId: string; statusUpdated: boolean }> {
    const normalizedId = recommendationId.trim();
    if (!normalizedId) {
      throw new BadRequestException('recommendation id is required');
    }

    const outcome = request.outcome;
    if (!outcome) {
      throw new BadRequestException('outcome is required');
    }

    if (!TERMINAL_OUTCOMES.has(outcome)) {
      throw new BadRequestException(
        'outcome must be approved, rejected, or ignored',
      );
    }

    const reason = request.reason?.trim();

    await this.prisma.$transaction(async (tx) => {
      const recommendation = await tx.proactiveRecommendation.findUnique({
        where: { id: normalizedId },
        select: { id: true, walletPubkey: true },
      });

      if (!recommendation) {
        throw new NotFoundException('recommendation not found');
      }

      await tx.recommendationFeedback.create({
        data: {
          recommendationId: normalizedId,
          walletPubkey: recommendation.walletPubkey,
          outcome,
          ...(reason ? { reason } : {}),
        },
      });

      await tx.proactiveRecommendation.update({
        where: { id: normalizedId },
        data: { status: outcome },
      });
    });

    return {
      recommendationId: normalizedId,
      statusUpdated: true,
    };
  }

  async dispatchNotification(
    input: DispatchNotificationInput,
  ): Promise<DispatchNotificationResult> {
    if (!this.notificationDispatcher) {
      return {
        dispatched: false,
        reason: 'suppressed',
      };
    }

    return this.notificationDispatcher.dispatch(input);
  }

  private toDto(row: {
    id: string;
    walletPubkey: string;
    threadId: string | null;
    title: string;
    summary: string;
    confidence: number;
    status: ProactiveRecommendationStatus;
    actions: Prisma.JsonValue;
    createdAt: Date;
  }): ProactiveRecommendationDto {
    return {
      id: row.id,
      pubkey: row.walletPubkey,
      ...(row.threadId ? { threadId: row.threadId } : {}),
      title: row.title,
      summary: row.summary,
      confidence: row.confidence,
      status: row.status,
      actions: this.parseActions(row.actions),
      createdAt: row.createdAt.getTime(),
    };
  }

  private parseActions(
    actions: Prisma.JsonValue,
  ): ProactiveRecommendationActionDto[] {
    if (!Array.isArray(actions)) {
      return [];
    }

    const supportedTypes = new Set(['open', 'approve', 'reject', 'ignore']);

    return actions
      .map((action) => {
        if (
          typeof action !== 'object' ||
          action === null ||
          Array.isArray(action)
        ) {
          return null;
        }

        const raw = action as {
          id?: unknown;
          label?: unknown;
          type?: unknown;
          payload?: unknown;
        };

        if (
          typeof raw.id !== 'string' ||
          typeof raw.label !== 'string' ||
          typeof raw.type !== 'string' ||
          !supportedTypes.has(raw.type)
        ) {
          return null;
        }

        const payload =
          typeof raw.payload === 'object' &&
          raw.payload !== null &&
          !Array.isArray(raw.payload)
            ? (raw.payload as Record<string, unknown>)
            : undefined;

        const parsed: ProactiveRecommendationActionDto = {
          id: raw.id,
          label: raw.label,
          type: raw.type as ProactiveRecommendationActionDto['type'],
          ...(payload ? { payload } : {}),
        };

        return parsed;
      })
      .filter(
        (action): action is ProactiveRecommendationActionDto => action !== null,
      );
  }
}
