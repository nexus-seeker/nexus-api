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
});
