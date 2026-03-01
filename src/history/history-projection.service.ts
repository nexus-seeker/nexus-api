import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

export interface ProjectRunEventInput {
  runId: string;
  pubkey: string;
  type: string;
  seq: number;
  eventAt: Date;
  payload: Prisma.InputJsonValue;
}

@Injectable()
export class HistoryProjectionService {
  constructor(private readonly prisma: PrismaService) {}

  async project(input: ProjectRunEventInput): Promise<void> {
    switch (input.type) {
      case 'run_started':
        await this.upsertRun(input, {
          status: 'started',
          intent: this.getStringField(input.payload, 'intent'),
          threadId: this.getStringField(input.payload, 'threadId'),
        });
        return;
      case 'message_user':
        await this.upsertRun(input, {
          threadId: this.getStringField(input.payload, 'threadId'),
        });
        await this.createMessage(input, 'user', this.getStringField(input.payload, 'content'));
        return;
      case 'step_emitted':
        await this.upsertRun(input, {
          threadId: this.getStringField(input.payload, 'threadId'),
          latestStep: this.getStepPayload(input.payload),
        });
        return;
      case 'run_completed':
        await this.upsertRun(input, {
          status: 'completed',
          completedAt: input.eventAt,
          intent: this.getStringField(input.payload, 'intent'),
          threadId: this.getStringField(input.payload, 'threadId'),
          latestStep: this.getStepPayload(input.payload),
        });
        await this.createMessage(input, 'agent', this.getCompletionMessage(input.payload));
        return;
      case 'run_rejected':
        const reason = this.getStringField(input.payload, 'reason');
        await this.upsertRun(input, {
          status: 'rejected',
          threadId: this.getStringField(input.payload, 'threadId'),
          rejectedReason: reason,
        });
        await this.createMessage(input, 'agent', reason);
        return;
      default:
        return;
    }
  }

  private async upsertRun(
    input: ProjectRunEventInput,
    patch: {
      status?: string;
      intent?: string;
      latestStep?: Prisma.InputJsonValue;
      completedAt?: Date;
      rejectedReason?: string;
      threadId?: string;
    },
  ): Promise<void> {
    const resolvedThreadId = patch.threadId
      ? await this.resolveThreadId(patch.threadId, input.pubkey, input.eventAt)
      : undefined;

    const createData: Prisma.AgentRunUncheckedCreateInput = {
      runId: input.runId,
      pubkey: input.pubkey,
      status: patch.status ?? 'started',
      lastEventSeq: input.seq,
    };

    if (patch.intent !== undefined) {
      createData.intent = patch.intent;
    }

    if (patch.latestStep !== undefined) {
      createData.latestStep = patch.latestStep;
    }

    if (patch.completedAt !== undefined) {
      createData.completedAt = patch.completedAt;
    }

    if (patch.rejectedReason !== undefined) {
      createData.rejectedReason = patch.rejectedReason;
    }

    if (resolvedThreadId !== undefined) {
      createData.threadId = resolvedThreadId;
    }

    const updateData: Prisma.AgentRunUncheckedUpdateManyInput = {
      lastEventSeq: input.seq,
    };

    if (patch.status !== undefined) {
      updateData.status = patch.status;
    }

    if (patch.intent !== undefined) {
      updateData.intent = patch.intent;
    }

    if (patch.latestStep !== undefined) {
      updateData.latestStep = patch.latestStep;
    }

    if (patch.completedAt !== undefined) {
      updateData.completedAt = patch.completedAt;
    }

    if (patch.rejectedReason !== undefined) {
      updateData.rejectedReason = patch.rejectedReason;
    }

    if (resolvedThreadId !== undefined) {
      updateData.threadId = resolvedThreadId;
    }

    const where = {
      runId: input.runId,
      lastEventSeq: { lt: input.seq },
    };

    const updated = await this.prisma.agentRun.updateMany({
      where,
      data: updateData,
    });

    if (updated.count > 0) {
      return;
    }

    try {
      await this.prisma.agentRun.create({ data: createData });
      return;
    } catch (error) {
      if (!this.isUniqueConstraintError(error)) {
        throw error;
      }
    }

    await this.prisma.agentRun.updateMany({
      where,
      data: updateData,
    });
  }

  private isUniqueConstraintError(error: unknown): error is { code: string } {
    if (typeof error !== 'object' || error === null || !('code' in error)) {
      return false;
    }

    return (error as { code?: unknown }).code === 'P2002';
  }

  private async createMessage(
    input: ProjectRunEventInput,
    role: 'user' | 'agent',
    content: string | undefined,
  ): Promise<void> {
    if (!content) {
      return;
    }

    const requestedThreadId = this.getStringField(input.payload, 'threadId');
    const threadId = requestedThreadId
      ? await this.resolveThreadId(requestedThreadId, input.pubkey, input.eventAt)
      : undefined;

    await this.prisma.conversationMessage.upsert({
      where: {
        runId_seq: {
          runId: input.runId,
          seq: input.seq,
        },
      },
      create: {
        runId: input.runId,
        pubkey: input.pubkey,
        ...(threadId ? { threadId } : {}),
        seq: input.seq,
        role,
        content,
        payload: input.payload,
        eventAt: input.eventAt,
      },
      update: {},
    });
  }

  private async resolveThreadId(
    threadId: string,
    pubkey: string,
    eventAt: Date,
  ): Promise<string | undefined> {
    const existing = await this.prisma.conversationThread.findUnique({
      where: { id: threadId },
      select: { walletPubkey: true },
    });

    if (!existing) {
      try {
        await this.prisma.conversationThread.create({
          data: {
            id: threadId,
            walletPubkey: pubkey,
            createdAt: eventAt,
            updatedAt: eventAt,
          },
        });
        return threadId;
      } catch (error) {
        if (!this.isUniqueConstraintError(error)) {
          throw error;
        }
      }

      const raced = await this.prisma.conversationThread.findUnique({
        where: { id: threadId },
        select: { walletPubkey: true },
      });

      if (!raced || raced.walletPubkey !== pubkey) {
        return undefined;
      }

      await this.prisma.conversationThread.update({
        where: { id: threadId },
        data: { updatedAt: eventAt },
      });
      return threadId;
    }

    if (existing.walletPubkey !== pubkey) {
      return undefined;
    }

    await this.prisma.conversationThread.update({
      where: { id: threadId },
      data: { updatedAt: eventAt },
    });

    return threadId;
  }

  private getRecord(value: Prisma.InputJsonValue): Record<string, Prisma.InputJsonValue> | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return null;
    }

    return value as Record<string, Prisma.InputJsonValue>;
  }

  private getStringField(value: Prisma.InputJsonValue, key: string): string | undefined {
    const record = this.getRecord(value);
    const fieldValue = record?.[key];

    if (typeof fieldValue !== 'string') {
      return undefined;
    }

    return fieldValue;
  }

  private getStepPayload(value: Prisma.InputJsonValue): Prisma.InputJsonValue | undefined {
    const record = this.getRecord(value);
    if (!record) {
      return undefined;
    }

    const step = record.step;
    if (step !== undefined) {
      return step;
    }

    const steps = record.steps;
    if (!Array.isArray(steps) || steps.length === 0) {
      return undefined;
    }

    return steps[steps.length - 1];
  }

  private getCompletionMessage(payload: Prisma.InputJsonValue): string | undefined {
    return this.getStringField(payload, 'response') ?? this.getStringField(payload, 'message');
  }
}
