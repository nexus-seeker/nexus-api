import { Injectable } from '@nestjs/common';
import { Prisma, RunEvent } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

const APPEND_RETRYABLE_ERROR_CODES = new Set(['P2002', 'P2034']);
const APPEND_MAX_ATTEMPTS = 3;

export interface AppendRunEventInput {
  runId: string;
  pubkey: string;
  type: string;
  payload: Prisma.InputJsonValue;
}

@Injectable()
export class HistoryEventsService {
  constructor(private readonly prisma: PrismaService) {}

  async append(input: AppendRunEventInput): Promise<RunEvent> {
    for (let attempt = 1; attempt <= APPEND_MAX_ATTEMPTS; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const latestEvent = await tx.runEvent.findFirst({
              where: { runId: input.runId },
              orderBy: { seq: 'desc' },
              select: { seq: true },
            });

            return tx.runEvent.create({
              data: {
                runId: input.runId,
                pubkey: input.pubkey,
                seq: (latestEvent?.seq ?? 0) + 1,
                eventType: input.type,
                payload: input.payload,
              },
            });
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          },
        );
      } catch (error) {
        if (!this.isRetryableAppendError(error) || attempt === APPEND_MAX_ATTEMPTS) {
          throw error;
        }
      }
    }

    throw new Error('unreachable');
  }

  private isRetryableAppendError(error: unknown): boolean {
    if (typeof error !== 'object' || error === null || !('code' in error)) {
      return false;
    }

    return APPEND_RETRYABLE_ERROR_CODES.has(String(error.code));
  }
}
