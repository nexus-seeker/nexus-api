import { PrismaService } from '../database/prisma.service';
import { HistoryService } from './history.service';

describe('HistoryService', () => {
  it('returns tie-safe nextCursor with beforeTs and beforeId', async () => {
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
    expect(result.nextCursor).toEqual({
      beforeTs: 1700000002000,
      beforeId: 'msg-2',
    });
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
});
