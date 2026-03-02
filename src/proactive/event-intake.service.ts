import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { ContextGraphService, ProactiveEventCanonical } from './context-graph.service';

export interface IngestProactiveEventInput {
  wallet: string;
  source: string;
  sourceEventId: string;
  kind: string;
  eventAt?: string | number | Date;
  payload: Prisma.InputJsonValue;
  threadId?: string;
}

export interface IngestProactiveEventResult {
  id: string;
  created: boolean;
}

@Injectable()
export class EventIntakeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contextGraphService: ContextGraphService,
  ) {}

  async ingest(input: IngestProactiveEventInput): Promise<IngestProactiveEventResult> {
    const event = this.normalize(input);

    const existing = await this.prisma.proactiveEvent.findUnique({
      where: {
        source_sourceEventId: {
          source: event.source,
          sourceEventId: event.sourceEventId,
        },
      },
    });

    if (existing) {
      return { id: existing.id, created: false };
    }

    let created;
    try {
      created = await this.prisma.proactiveEvent.create({
        data: {
          walletPubkey: event.wallet,
          threadId: event.threadId,
          source: event.source,
          sourceEventId: event.sourceEventId,
          kind: event.kind,
          eventAt: event.eventAt,
          payload: event.payload,
        },
      });
    } catch (error) {
      if (!this.isUniqueConstraintError(error)) {
        throw error;
      }

      const raced = await this.prisma.proactiveEvent.findUnique({
        where: {
          source_sourceEventId: {
            source: event.source,
            sourceEventId: event.sourceEventId,
          },
        },
      });

      if (!raced) {
        throw error;
      }

      return { id: raced.id, created: false };
    }

    await this.contextGraphService.upsertWalletSnapshot(event);

    return { id: created.id, created: true };
  }

  private normalize(input: IngestProactiveEventInput): ProactiveEventCanonical {
    const wallet = this.requireTrimmed(input.wallet, 'wallet');
    const source = this.requireTrimmed(input.source, 'source');
    const sourceEventId = this.requireTrimmed(input.sourceEventId, 'sourceEventId');
    const kind = this.requireTrimmed(input.kind, 'kind');
    const threadId = input.threadId?.trim();
    const payload = this.normalizePayload(input.payload);
    const eventAt = this.normalizeEventAt(input.eventAt);

    return {
      wallet,
      source,
      sourceEventId,
      kind,
      eventAt,
      payload,
      ...(threadId ? { threadId } : {}),
    };
  }

  private requireTrimmed(value: string, field: string): string {
    const normalized = value?.trim();
    if (!normalized) {
      throw new BadRequestException(`${field} is required`);
    }

    return normalized;
  }

  private normalizeEventAt(value?: string | number | Date): Date {
    if (value === undefined) {
      return new Date();
    }

    const parsed = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException('eventAt must be a valid date');
    }

    return parsed;
  }

  private normalizePayload(payload: Prisma.InputJsonValue): Prisma.InputJsonValue {
    if (payload === null || payload === undefined) {
      return {};
    }

    return payload;
  }

  private isUniqueConstraintError(error: unknown): error is { code: string } {
    if (typeof error !== 'object' || error === null || !('code' in error)) {
      return false;
    }

    return (error as { code?: unknown }).code === 'P2002';
  }
}
