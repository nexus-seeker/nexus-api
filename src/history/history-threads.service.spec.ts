import { PrismaService } from '../database/prisma.service';
import { HistoryThreadsService } from './history-threads.service';

describe('HistoryThreadsService', () => {
  it('returns wallet threads ordered by latest activity', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 't2',
        walletPubkey: 'wallet',
        title: 'Dips',
        createdAt: new Date(1),
        updatedAt: new Date(2),
      },
      {
        id: 't1',
        walletPubkey: 'wallet',
        title: 'Main',
        createdAt: new Date(1),
        updatedAt: new Date(1),
      },
    ]);

    const prisma = {
      conversationThread: { findMany },
    } as unknown as PrismaService;

    const service = new HistoryThreadsService(prisma);
    const result = await service.listThreads('wallet');

    expect(findMany).toHaveBeenCalledWith({
      where: { walletPubkey: 'wallet' },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });
    expect(result[0].id).toBe('t2');
  });
});
