import { PublicKey } from '@solana/web3.js';
import { PrismaService } from '../database/prisma.service';
import { SolanaService } from '../solana/solana.service';
import { ReceiptReconcilerService } from './receipt-reconciler.service';

describe('ReceiptReconcilerService', () => {
  it('upserts fetched on-chain receipts into receipts_cache', async () => {
    const owner = '2WMoiJ5nwdHfM8Y31wob8H6u3Gy5QdY8jQEGK8jZ6g9Y';
    const mockReceipt = {
      address: '9icY5WUnv6AThfT3CMaqRk6jJgQeGG5xUow1FA6uD93w',
      agentProfile: '4f4Pykx6Ni6Q44wzMKn26owK6VkgQ4etQ5eRBrk7w8R2',
      seekerId: 'ben.skr',
      intentHash: [1, 2, 3],
      protocol: 'jupiter',
      amountLamports: 1000,
      txSignature: '3fV4M6szaQ7sKfE5DbiY6Q8Q6d6m5N2m8W3jZ8y6Q2kH',
      status: 'Completed',
      timestamp: 1730000000,
      bump: 255,
    };

    const solana = {
      fetchReceiptsByOwner: jest.fn().mockResolvedValue([mockReceipt]),
    } as unknown as SolanaService;

    const prisma = {
      receiptCache: {
        upsert: jest.fn().mockResolvedValue(undefined),
      },
    } as unknown as PrismaService;

    const service = new ReceiptReconcilerService(prisma, solana);

    await service.syncOwner(owner);

    expect(solana.fetchReceiptsByOwner).toHaveBeenCalledWith(expect.any(PublicKey), 20);
    expect(prisma.receiptCache.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { address: mockReceipt.address },
      }),
    );
  });
});
