import { PrismaService } from '../database/prisma.service';
import { HistoryProjectionService } from './history-projection.service';

describe('HistoryProjectionService', () => {
  const createService = () => {
    const prisma = {
      agentRun: {
        upsert: jest.fn(),
      },
      conversationMessage: {
        create: jest.fn(),
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
      payload: { content: 'Swap 0.1 SOL to USDC' },
    });

    expect(prisma.conversationMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          runId: 'run-1',
          pubkey: 'pk',
          seq: 2,
          role: 'user',
          content: 'Swap 0.1 SOL to USDC',
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
      payload: { response: 'Done. Ready to sign.' },
    });

    expect(prisma.agentRun.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { runId: 'run-1' },
        update: expect.objectContaining({ status: 'completed', lastEventSeq: 4 }),
      }),
    );

    expect(prisma.conversationMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ runId: 'run-1', seq: 4, role: 'agent', content: 'Done. Ready to sign.' }),
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
      payload: { reason: 'Rejected by policy checks' },
    });

    expect(prisma.agentRun.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { runId: 'run-1' },
        update: expect.objectContaining({ status: 'rejected', lastEventSeq: 5 }),
      }),
    );

    expect(prisma.conversationMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          runId: 'run-1',
          seq: 5,
          role: 'agent',
          content: 'Rejected by policy checks',
        }),
      }),
    );
  });
});
