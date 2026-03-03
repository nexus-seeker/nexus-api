import { PrismaService } from '../database/prisma.service';
import { HistoryService } from './history.service';

describe('HistoryService', () => {
  it('returns timestamp nextCursor and tie-safe nextCursorId', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 'msg-3',
        role: 'assistant',
        content: 'third',
        runId: 'run-1',
        payload: null,
        eventAt: new Date(1700000003000),
      },
      {
        id: 'msg-2',
        role: 'assistant',
        content: 'second',
        runId: 'run-1',
        payload: null,
        eventAt: new Date(1700000002000),
      },
      {
        id: 'msg-1',
        role: 'user',
        content: 'first',
        runId: 'run-1',
        payload: null,
        eventAt: new Date(1700000001000),
      },
    ]);

    const prisma = {
      conversationMessage: { findMany },
    } as unknown as PrismaService;

    const service = new HistoryService(prisma);

    const result = await service.getHistory('wallet-1', 2);

    expect(result.messages).toHaveLength(2);
    expect(result.nextCursor).toBe(1700000002000);
    expect(result.nextCursorId).toBe('msg-2');
  });

  it('uses tie-safe cursor where condition when beforeTs and beforeId are provided', async () => {
    const findMany = jest.fn().mockResolvedValue([]);

    const prisma = {
      conversationMessage: { findMany },
    } as unknown as PrismaService;

    const service = new HistoryService(prisma);

    await service.getHistory('wallet-1', 50, 1700000000000, 'msg-20');

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          pubkey: 'wallet-1',
          OR: [
            { eventAt: { lt: new Date(1700000000000) } },
            { eventAt: new Date(1700000000000), id: { lt: 'msg-20' } },
          ],
        },
      }),
    );
  });

  it('uses inclusive timestamp boundary when only beforeTs is provided', async () => {
    const findMany = jest.fn().mockResolvedValue([]);

    const prisma = {
      conversationMessage: { findMany },
    } as unknown as PrismaService;

    const service = new HistoryService(prisma);

    await service.getHistory('wallet-1', 50, 1700000000000);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          pubkey: 'wallet-1',
          eventAt: { lte: new Date(1700000000000) },
        },
      }),
    );
  });

  it('throws when beforeTs cannot produce a valid date', async () => {
    const findMany = jest.fn();

    const prisma = {
      conversationMessage: { findMany },
    } as unknown as PrismaService;

    const service = new HistoryService(prisma);

    await expect(
      service.getHistory('wallet-1', 50, 8640000000000001, 'msg-20'),
    ).rejects.toThrow(
      'beforeTs must be a valid unix timestamp in milliseconds',
    );
    expect(findMany).not.toHaveBeenCalled();
  });
});
