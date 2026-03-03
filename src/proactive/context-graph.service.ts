import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

export interface ProactiveEventCanonical {
  wallet: string;
  source: string;
  sourceEventId: string;
  kind: string;
  eventAt: Date;
  payload: Prisma.InputJsonValue;
  threadId?: string;
}

const SNAPSHOT_SOURCE = 'context_graph';

@Injectable()
export class ContextGraphService {
  private readonly logger = new Logger(ContextGraphService.name);

  constructor(private readonly prisma: PrismaService) {}

  async upsertWalletSnapshot(event: ProactiveEventCanonical): Promise<void> {
    const sourceEventId = `wallet:${event.wallet}`;
    const payloadRecord = this.getPayloadRecord(event.payload);
    const balances = this.extractPayloadField(payloadRecord, [
      'balances',
      'tokenBalances',
      'nativeBalance',
    ]);
    const exposure = this.extractPayloadField(payloadRecord, [
      'exposure',
      'protocolExposure',
      'positions',
    ]);

    const recentAction: Prisma.InputJsonObject = {
      source: event.source,
      sourceEventId: event.sourceEventId,
      kind: event.kind,
      eventAt: event.eventAt.toISOString(),
      action: this.extractPayloadField(payloadRecord, [
        'action',
        'type',
        'description',
      ]),
    };

    const snapshotPayload: Prisma.InputJsonObject = {
      summary: `Latest ${event.kind} from ${event.source}`,
      source: event.source,
      sourceEventId: event.sourceEventId,
      kind: event.kind,
      eventAt: event.eventAt.toISOString(),
      payload: event.payload,
      balances,
      exposure,
      recentAction,
    };

    try {
      await this.prisma.proactiveEvent.upsert({
        where: {
          source_sourceEventId: {
            source: SNAPSHOT_SOURCE,
            sourceEventId,
          },
        },
        update: {
          walletPubkey: event.wallet,
          threadId: event.threadId,
          kind: 'wallet_snapshot',
          eventAt: event.eventAt,
          payload: snapshotPayload,
        },
        create: {
          walletPubkey: event.wallet,
          threadId: event.threadId,
          source: SNAPSHOT_SOURCE,
          sourceEventId,
          kind: 'wallet_snapshot',
          eventAt: event.eventAt,
          payload: snapshotPayload,
        },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to update context snapshot for ${event.wallet}: ${message}`,
      );
    }
  }

  private getPayloadRecord(
    payload: Prisma.InputJsonValue,
  ): Record<string, Prisma.InputJsonValue> | undefined {
    if (
      typeof payload !== 'object' ||
      payload === null ||
      Array.isArray(payload)
    ) {
      return undefined;
    }

    return payload as Record<string, Prisma.InputJsonValue>;
  }

  private extractPayloadField(
    payload: Record<string, Prisma.InputJsonValue> | undefined,
    keys: string[],
  ): Prisma.InputJsonValue | null {
    if (!payload) {
      return null;
    }

    for (const key of keys) {
      const value = payload[key];
      if (value !== undefined) {
        return value;
      }
    }

    return null;
  }
}
