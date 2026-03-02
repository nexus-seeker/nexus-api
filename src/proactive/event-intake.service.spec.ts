import { PrismaService } from '../database/prisma.service';
import { ContextGraphService } from './context-graph.service';
import { EventIntakeService } from './event-intake.service';

describe('EventIntakeService', () => {
  it('deduplicates repeated source events by source and sourceEventId', async () => {
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'evt-db-1' });
    const create = jest.fn().mockResolvedValue({ id: 'evt-db-1' });

    const prisma = {
      proactiveEvent: {
        findUnique,
        create,
      },
    } as unknown as PrismaService;

    const upsertWalletSnapshot = jest.fn().mockResolvedValue(undefined);
    const contextGraph = {
      upsertWalletSnapshot,
    } as unknown as ContextGraphService;

    const service = new EventIntakeService(prisma, contextGraph);

    await service.ingest({
      wallet: 'wallet',
      source: 'helius',
      sourceEventId: 'evt-1',
      kind: 'wallet_event',
      payload: {},
    });
    await service.ingest({
      wallet: 'wallet',
      source: 'helius',
      sourceEventId: 'evt-1',
      kind: 'wallet_event',
      payload: {},
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(upsertWalletSnapshot).toHaveBeenCalledTimes(1);
  });

  it('returns existing id when create races on unique constraint', async () => {
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'evt-race-1' });
    const create = jest.fn().mockRejectedValue({ code: 'P2002' });

    const prisma = {
      proactiveEvent: {
        findUnique,
        create,
      },
    } as unknown as PrismaService;

    const upsertWalletSnapshot = jest.fn().mockResolvedValue(undefined);
    const contextGraph = {
      upsertWalletSnapshot,
    } as unknown as ContextGraphService;

    const service = new EventIntakeService(prisma, contextGraph);

    const result = await service.ingest({
      wallet: 'wallet',
      source: 'helius',
      sourceEventId: 'evt-race',
      kind: 'wallet_event',
      payload: {},
    });

    expect(result).toEqual({ id: 'evt-race-1', created: false });
    expect(upsertWalletSnapshot).not.toHaveBeenCalled();
  });

  it('rejects invalid eventAt values', async () => {
    const prisma = {
      proactiveEvent: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
    } as unknown as PrismaService;

    const contextGraph = {
      upsertWalletSnapshot: jest.fn(),
    } as unknown as ContextGraphService;

    const service = new EventIntakeService(prisma, contextGraph);

    await expect(
      service.ingest({
        wallet: 'wallet',
        source: 'helius',
        sourceEventId: 'evt-invalid-date',
        kind: 'wallet_event',
        eventAt: 'not-a-date',
        payload: {},
      }),
    ).rejects.toThrow('eventAt must be a valid date');
  });
});
