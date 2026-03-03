import { PrismaService } from '../database/prisma.service';
import { ReceiptReconcilerService } from './receipt-reconciler.service';
import { ReceiptsService } from './receipts.service';

describe('ReceiptsService', () => {
  it('maps safe bigint amountLamports values to numbers', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        address: 'receipt-1',
        ownerPubkey: '11111111111111111111111111111111',
        agentProfile: 'agent-1',
        seekerId: 'seeker-1',
        intentHash: [1, 2, 3],
        protocol: 'jupiter',
        amountLamports: BigInt(9000),
        txSignature: 'sig-1',
        status: 'Completed',
        timestamp: 1,
        bump: 255,
        updatedAt: new Date(),
      },
    ]);

    const prisma = {
      receiptCache: { findMany },
    } as unknown as PrismaService;

    const reconciler = {
      syncOwner: jest.fn(),
    } as unknown as ReceiptReconcilerService;

    const service = new ReceiptsService(prisma, reconciler);

    const receipts = await service.getReceipts(
      '11111111111111111111111111111111',
      20,
    );

    expect(receipts[0]?.amountLamports).toBe(9000);
  });

  it('throws when amountLamports exceeds Number.MAX_SAFE_INTEGER', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        address: 'receipt-2',
        ownerPubkey: '11111111111111111111111111111111',
        agentProfile: 'agent-1',
        seekerId: 'seeker-1',
        intentHash: [1, 2, 3],
        protocol: 'jupiter',
        amountLamports: BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1),
        txSignature: 'sig-2',
        status: 'Completed',
        timestamp: 1,
        bump: 255,
        updatedAt: new Date(),
      },
    ]);

    const prisma = {
      receiptCache: { findMany },
    } as unknown as PrismaService;

    const reconciler = {
      syncOwner: jest.fn(),
    } as unknown as ReceiptReconcilerService;

    const service = new ReceiptsService(prisma, reconciler);

    await expect(
      service.getReceipts('11111111111111111111111111111111', 20),
    ).rejects.toThrow('amountLamports exceeds MAX_SAFE_INTEGER');
  });
});
