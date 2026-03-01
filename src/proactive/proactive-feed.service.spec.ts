import { PrismaService } from '../database/prisma.service';
import { ProactiveFeedService } from './proactive-feed.service';
import { NotificationDispatcherService } from './notification-dispatcher.service';

describe('ProactiveFeedService', () => {
  it('feedback recording updates recommendation status and inserts feedback row', async () => {
    const tx = {
      proactiveRecommendation: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'rec-1',
          walletPubkey: 'wallet-1',
        }),
        update: jest.fn().mockResolvedValue({ id: 'rec-1', status: 'rejected' }),
      },
      recommendationFeedback: {
        create: jest.fn().mockResolvedValue({ id: 'feedback-1' }),
      },
    };

    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    } as unknown as PrismaService;

    const service = new ProactiveFeedService(prisma);

    await service.recordFeedback('rec-1', {
      outcome: 'rejected',
      reason: 'too_risky',
    });

    expect(tx.recommendationFeedback.create).toHaveBeenCalledWith({
      data: {
        recommendationId: 'rec-1',
        walletPubkey: 'wallet-1',
        outcome: 'rejected',
        reason: 'too_risky',
      },
    });
    expect(tx.proactiveRecommendation.update).toHaveBeenCalledWith({
      where: { id: 'rec-1' },
      data: { status: 'rejected' },
    });
  });

  it('rejects invalid feedback outcomes', async () => {
    const prisma = {
      $transaction: jest.fn(),
    } as unknown as PrismaService;

    const service = new ProactiveFeedService(prisma);

    await expect(
      service.recordFeedback('rec-1', {
        outcome: 'opened' as unknown as 'approved' | 'rejected' | 'ignored',
      }),
    ).rejects.toThrow('outcome must be approved, rejected, or ignored');

    expect((prisma as any).$transaction).not.toHaveBeenCalled();
  });

  it('forwards dispatch requests to notification dispatcher', async () => {
    const prisma = {
      $transaction: jest.fn(),
      proactiveRecommendation: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    } as unknown as PrismaService;

    const dispatch = jest.fn().mockResolvedValue({
      dispatched: true,
      deliveryId: 'delivery-1',
      status: 'sent',
    });
    const dispatcher = {
      dispatch,
    } as unknown as NotificationDispatcherService;

    const service = new ProactiveFeedService(prisma, dispatcher);

    const result = await service.dispatchNotification({
      recommendationId: 'rec-1',
      walletPubkey: 'wallet-1',
      title: 'SOL moved',
      body: 'Review now',
      shouldNotify: true,
      confidence: 0.8,
    });

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ recommendationId: 'rec-1', walletPubkey: 'wallet-1' }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        dispatched: true,
        deliveryId: 'delivery-1',
      }),
    );
  });
});
