import { PrismaService } from '../database/prisma.service';
import { HistoryProjectionService } from './history-projection.service';

describe('HistoryProjectionService', () => {
  const createService = () => {
    const prisma = {
      agentRun: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
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

    expect(prisma.agentRun.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { runId: 'run-1' },
        update: expect.objectContaining({ status: 'started', lastEventSeq: 1 }),
        create: expect.objectContaining({ runId: 'run-1', pubkey: 'pk', status: 'started' }),
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

    expect(prisma.agentRun.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { runId: 'run-1' },
        create: expect.objectContaining({ runId: 'run-1', status: 'started', lastEventSeq: 2 }),
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

    expect(prisma.agentRun.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { runId: 'run-1' },
        update: expect.objectContaining({
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

    expect(prisma.agentRun.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { runId: 'run-1' },
        update: expect.objectContaining({
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

    expect(prisma.agentRun.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { runId: 'run-1' },
        update: expect.objectContaining({ status: 'rejected', lastEventSeq: 5 }),
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
    prisma.agentRun.findUnique = jest.fn().mockResolvedValue({ lastEventSeq: 6 });

    await service.project({
      runId: 'run-1',
      pubkey: 'pk',
      type: 'run_completed',
      seq: 4,
      eventAt: new Date('2026-02-28T12:03:00.000Z'),
      payload: { response: 'Done. Ready to sign.' },
    });

    expect(prisma.agentRun.upsert).not.toHaveBeenCalled();
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
});
