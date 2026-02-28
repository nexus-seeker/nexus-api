import { Injectable } from '@nestjs/common';
import { RunEvent } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

export interface AppendRunEventInput {
  runId: string;
  pubkey: string;
  type: string;
  payload: unknown;
}

@Injectable()
export class HistoryEventsService {
  constructor(private readonly prisma: PrismaService) {}

  async append(input: AppendRunEventInput): Promise<RunEvent> {
    return this.prisma.$transaction(async (tx) => {
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
    });
  }
}
