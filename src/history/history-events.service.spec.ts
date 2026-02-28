import { PrismaService } from '../database/prisma.service';
import { HistoryEventsService } from './history-events.service';

describe('HistoryEventsService', () => {
  it('assigns the next sequence number per run', async () => {
    const tx = {
      runEvent: {
        findFirst: jest.fn().mockResolvedValue({ seq: 2 }),
        create: jest.fn().mockResolvedValue({ runId: 'run-1', seq: 3, eventType: 'run_started' }),
      },
    };

    const prisma = {
      $transaction: jest.fn().mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => {
        return callback(tx);
      }),
    } as unknown as PrismaService;

    const service = new HistoryEventsService(prisma);

    await service.append({
      runId: 'run-1',
      pubkey: 'pk',
      type: 'run_started',
      payload: {},
    });

    expect(tx.runEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          runId: 'run-1',
          seq: 3,
          eventType: 'run_started',
        }),
      }),
    );
  });

  it('assigns sequence number 1 when there are no prior events', async () => {
    const tx = {
      runEvent: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ runId: 'run-1', seq: 1, eventType: 'run_started' }),
      },
    };

    const prisma = {
      $transaction: jest.fn().mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => {
        return callback(tx);
      }),
    } as unknown as PrismaService;

    const service = new HistoryEventsService(prisma);

    await service.append({
      runId: 'run-1',
      pubkey: 'pk',
      type: 'run_started',
      payload: {},
    });

    expect(tx.runEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          runId: 'run-1',
          seq: 1,
          eventType: 'run_started',
        }),
      }),
    );
  });

  it('retries append when transaction contention happens (P2034)', async () => {
    const tx = {
      runEvent: {
        findFirst: jest.fn().mockResolvedValue({ seq: 0 }),
        create: jest.fn().mockResolvedValue({ runId: 'run-1', seq: 1, eventType: 'run_started' }),
      },
    };

    const prisma = {
      $transaction: jest
        .fn()
        .mockRejectedValueOnce({ code: 'P2034' })
        .mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => {
          return callback(tx);
        }),
    } as unknown as PrismaService;

    const service = new HistoryEventsService(prisma);

    await expect(
      service.append({
        runId: 'run-1',
        pubkey: 'pk',
        type: 'run_started',
        payload: {},
      }),
    ).resolves.toEqual(expect.objectContaining({ runId: 'run-1', seq: 1 }));

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it('retries append when sequence unique conflict happens (P2002)', async () => {
    const tx = {
      runEvent: {
        findFirst: jest.fn().mockResolvedValue({ seq: 1 }),
        create: jest.fn().mockResolvedValue({ runId: 'run-1', seq: 2, eventType: 'run_started' }),
      },
    };

    const prisma = {
      $transaction: jest
        .fn()
        .mockRejectedValueOnce({ code: 'P2002' })
        .mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => {
          return callback(tx);
        }),
    } as unknown as PrismaService;

    const service = new HistoryEventsService(prisma);

    await expect(
      service.append({
        runId: 'run-1',
        pubkey: 'pk',
        type: 'run_started',
        payload: {},
      }),
    ).resolves.toEqual(expect.objectContaining({ runId: 'run-1', seq: 2 }));

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });
});
