import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import type { HistoryResponse, MessageDto } from '../contracts/mvp';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

@Injectable()
export class HistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async getHistory(
    pubkey: string,
    limit = DEFAULT_LIMIT,
    beforeTs?: number,
    beforeId?: string,
  ): Promise<HistoryResponse> {
    const normalizedLimit = this.normalizeLimit(limit);
    const take = normalizedLimit + 1;
    const beforeCursor = this.parseBeforeCursor(beforeTs, beforeId);

    const where =
      beforeCursor === undefined
        ? { pubkey }
        : beforeCursor.beforeId === undefined
          ? { pubkey, eventAt: { lte: beforeCursor.beforeDate } }
          : {
              pubkey,
              OR: [
                { eventAt: { lt: beforeCursor.beforeDate } },
                { eventAt: beforeCursor.beforeDate, id: { lt: beforeCursor.beforeId } },
              ],
            };

    const messagesDesc = await this.prisma.conversationMessage.findMany({
      where,
      orderBy: [{ eventAt: 'desc' }, { id: 'desc' }],
      take,
    });

    const hasMore = messagesDesc.length > normalizedLimit;
    const pageDesc = hasMore ? messagesDesc.slice(0, normalizedLimit) : messagesDesc;
    const nextCursorTs = hasMore ? pageDesc[pageDesc.length - 1]?.eventAt.getTime() : undefined;
    const nextCursorId = hasMore ? pageDesc[pageDesc.length - 1]?.id : undefined;

    return {
      messages: pageDesc.reverse().map((message) => this.toMessageDto(message)),
      ...(nextCursorTs !== undefined ? { nextCursor: nextCursorTs } : {}),
      ...(nextCursorId !== undefined ? { nextCursorId } : {}),
    };
  }

  private normalizeLimit(limit: number): number {
    if (!Number.isFinite(limit)) {
      return DEFAULT_LIMIT;
    }

    const integerLimit = Math.trunc(limit);
    if (integerLimit < 1) {
      return 1;
    }

    if (integerLimit > MAX_LIMIT) {
      return MAX_LIMIT;
    }

    return integerLimit;
  }

  private parseBeforeCursor(
    beforeTs?: number,
    beforeId?: string,
  ): { beforeDate: Date; beforeId?: string } | undefined {
    if (beforeTs === undefined) {
      return undefined;
    }

    if (!Number.isSafeInteger(beforeTs) || beforeTs <= 0) {
      throw new BadRequestException('beforeTs must be a valid unix timestamp in milliseconds');
    }

    const beforeDate = new Date(beforeTs);
    if (Number.isNaN(beforeDate.getTime())) {
      throw new BadRequestException('beforeTs must be a valid unix timestamp in milliseconds');
    }

    return { beforeDate, beforeId };
  }

  private toMessageDto(message: {
    id: string;
    role: string;
    content: string;
    runId: string;
    threadId?: string | null;
    payload: unknown;
    eventAt: Date;
  }): MessageDto {
    const payload = this.getPayloadRecord(message.payload);
    const steps = Array.isArray(payload?.steps) ? payload?.steps : undefined;

    const rejectionReason = typeof payload?.reason === 'string' ? payload.reason : undefined;
    const rejectionPolicyField =
      typeof payload?.policyField === 'string' ? payload.policyField : undefined;

    const rejection =
      rejectionReason !== undefined
        ? {
            reason: rejectionReason,
            policyField: rejectionPolicyField ?? 'unknown',
          }
        : undefined;

    return {
      id: message.id,
      role: message.role,
      content: message.content,
      runId: message.runId,
      ...(message.threadId ? { threadId: message.threadId } : {}),
      ...(steps !== undefined ? { steps } : {}),
      ...(rejection !== undefined ? { rejection } : {}),
      timestamp: message.eventAt.getTime(),
    };
  }

  private getPayloadRecord(payload: unknown): Record<string, unknown> | undefined {
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      return undefined;
    }

    return payload as Record<string, unknown>;
  }
}
