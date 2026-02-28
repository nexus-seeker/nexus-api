import { PrismaService } from '../database/prisma.service';
import { HistoryProjectionService } from './history-projection.service';

describe('HistoryProjectionService', () => {
  const createService = () => {
    const prisma = {
      agentRun: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn(),
      },
      conversationMessage: {
        upsert: jest.fn(),
      },
    } as unknown as PrismaService;

    return {
      prisma,
      service: new HistoryProjectionService(prisma),
    };
  };

  it('projects run_started into an agent run snapshot', async () => {
    const { prisma, service } = createService();

    await service.project({
      runId: 'run-1',
      pubkey: 'pk',
      type: 'run_started',
      seq: 1,
      eventAt: new Date('2026-02-28T12:00:00.000Z'),
      payload: { intent: 'Swap 0.1 SOL to USDC' },
    });

    expect(prisma.agentRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ runId: 'run-1', lastEventSeq: { lt: 1 } }),
        data: expect.objectContaining({ status: 'started', intent: 'Swap 0.1 SOL to USDC', lastEventSeq: 1 }),
      }),
    );
  });

  it('projects message_user into a user conversation message row', async () => {
    const { prisma, service } = createService();

    await service.project({
      runId: 'run-1',
      pubkey: 'pk',
      type: 'message_user',
      seq: 2,
      eventAt: new Date('2026-02-28T12:01:00.000Z'),
      payload: { content: 'Swap 0.1 SOL to USDC' },
    });

    expect(prisma.agentRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ runId: 'run-1', lastEventSeq: { lt: 2 } }),
        data: expect.objectContaining({ lastEventSeq: 2 }),
      }),
    );

    expect(prisma.conversationMessage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          runId_seq: {
            runId: 'run-1',
            seq: 2,
          },
        },
        create: expect.objectContaining({
          runId: 'run-1',
          pubkey: 'pk',
          seq: 2,
          role: 'user',
          content: 'Swap 0.1 SOL to USDC',
          eventAt: new Date('2026-02-28T12:01:00.000Z'),
        }),
      }),
    );
  });

  it('projects step_emitted into the latest step snapshot', async () => {
    const { prisma, service } = createService();

    await service.project({
      runId: 'run-1',
      pubkey: 'pk',
      type: 'step_emitted',
      seq: 3,
      eventAt: new Date('2026-02-28T12:02:00.000Z'),
      payload: { step: { node: 'assemble_tx', status: 'success' } },
    });

    expect(prisma.agentRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ runId: 'run-1', lastEventSeq: { lt: 3 } }),
        data: expect.objectContaining({
          lastEventSeq: 3,
          latestStep: expect.objectContaining({ node: 'assemble_tx', status: 'success' }),
        }),
      }),
    );
  });

  it('projects run_completed into snapshot and agent conversation message', async () => {
    const { prisma, service } = createService();

    await service.project({
      runId: 'run-1',
      pubkey: 'pk',
      type: 'run_completed',
      seq: 4,
      eventAt: new Date('2026-02-28T12:03:00.000Z'),
      payload: { response: 'Done. Ready to sign.' },
    });

    expect(prisma.agentRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ runId: 'run-1', lastEventSeq: { lt: 4 } }),
        data: expect.objectContaining({
          status: 'completed',
          lastEventSeq: 4,
          completedAt: new Date('2026-02-28T12:03:00.000Z'),
        }),
      }),
    );

    expect(prisma.conversationMessage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          runId: 'run-1',
          seq: 4,
          role: 'agent',
          content: 'Done. Ready to sign.',
          eventAt: new Date('2026-02-28T12:03:00.000Z'),
        }),
      }),
    );
  });

  it('projects run_rejected into snapshot and agent conversation message', async () => {
    const { prisma, service } = createService();

    await service.project({
      runId: 'run-1',
      pubkey: 'pk',
      type: 'run_rejected',
      seq: 5,
      eventAt: new Date('2026-02-28T12:04:00.000Z'),
      payload: { reason: 'Rejected by policy checks' },
    });

    expect(prisma.agentRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ runId: 'run-1', lastEventSeq: { lt: 5 } }),
        data: expect.objectContaining({ status: 'rejected', rejectedReason: 'Rejected by policy checks', lastEventSeq: 5 }),
      }),
    );

    expect(prisma.conversationMessage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          runId: 'run-1',
          seq: 5,
          role: 'agent',
          content: 'Rejected by policy checks',
          eventAt: new Date('2026-02-28T12:04:00.000Z'),
        }),
      }),
    );
  });

  it('does not regress run snapshot for out-of-order events', async () => {
    const { prisma, service } = createService();
    prisma.agentRun.updateMany = jest
      .fn()
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 });
    prisma.agentRun.create = jest.fn().mockRejectedValueOnce({ code: 'P2002' });

    await service.project({
      runId: 'run-1',
      pubkey: 'pk',
      type: 'run_completed',
      seq: 4,
      eventAt: new Date('2026-02-28T12:03:00.000Z'),
      payload: { response: 'Done. Ready to sign.' },
    });

    expect(prisma.agentRun.create).toHaveBeenCalledTimes(1);
    expect(prisma.agentRun.updateMany).toHaveBeenCalledTimes(2);
    expect(prisma.conversationMessage.upsert).toHaveBeenCalledTimes(1);
  });

  it('upserts messages by composite key for idempotency', async () => {
    const { prisma, service } = createService();

    await service.project({
      runId: 'run-1',
      pubkey: 'pk',
      type: 'message_user',
      seq: 7,
      eventAt: new Date('2026-02-28T12:05:00.000Z'),
      payload: { content: 'Repeat-safe message' },
    });

    expect(prisma.conversationMessage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          runId_seq: {
            runId: 'run-1',
            seq: 7,
          },
        },
        update: {},
      }),
    );
  });

  it('uses atomic conditional updates to prevent stale snapshot regressions', async () => {
    const { prisma, service } = createService();

    await service.project({
      runId: 'run-atomic',
      pubkey: 'pk',
      type: 'run_completed',
      seq: 9,
      eventAt: new Date('2026-02-28T12:10:00.000Z'),
      payload: { response: 'All done' },
    });

    expect(prisma.agentRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ runId: 'run-atomic', lastEventSeq: { lt: 9 } }),
        data: expect.objectContaining({
          status: 'completed',
          completedAt: new Date('2026-02-28T12:10:00.000Z'),
          lastEventSeq: 9,
        }),
      }),
    );
  });

  it('handles create races by retrying conditional update after unique conflicts', async () => {
    const { prisma, service } = createService();
    prisma.agentRun.updateMany = jest
      .fn()
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    prisma.agentRun.create = jest
      .fn()
      .mockRejectedValueOnce({ code: 'P2002' })
      .mockResolvedValue(undefined);

    await service.project({
      runId: 'run-race',
      pubkey: 'pk',
      type: 'run_started',
      seq: 3,
      eventAt: new Date('2026-02-28T12:11:00.000Z'),
      payload: { intent: 'race' },
    });

    expect(prisma.agentRun.create).toHaveBeenCalledTimes(1);
    expect(prisma.agentRun.updateMany).toHaveBeenCalledTimes(2);
    expect(prisma.agentRun.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({ runId: 'run-race', lastEventSeq: { lt: 3 } }),
      }),
    );
  });
});
