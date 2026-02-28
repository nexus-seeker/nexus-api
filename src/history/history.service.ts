import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import type { HistoryResponse, MessageDto } from '../contracts/mvp';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

@Injectable()
export class HistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async getHistory(pubkey: string, limit = DEFAULT_LIMIT, beforeTs?: number): Promise<HistoryResponse> {
    const normalizedLimit = this.normalizeLimit(limit);
    const take = normalizedLimit + 1;

    const messagesDesc = await this.prisma.conversationMessage.findMany({
      where: {
        pubkey,
        ...(beforeTs !== undefined ? { eventAt: { lt: new Date(beforeTs) } } : {}),
      },
      orderBy: [{ eventAt: 'desc' }, { id: 'desc' }],
      take,
    });

    const hasMore = messagesDesc.length > normalizedLimit;
    const pageDesc = hasMore ? messagesDesc.slice(0, normalizedLimit) : messagesDesc;
    const nextCursor = hasMore ? pageDesc[pageDesc.length - 1]?.eventAt.getTime() : undefined;

    return {
      messages: pageDesc.reverse().map((message) => this.toMessageDto(message)),
      ...(nextCursor !== undefined ? { nextCursor } : {}),
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

  private toMessageDto(message: {
    id: string;
    role: string;
    content: string;
    runId: string;
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
