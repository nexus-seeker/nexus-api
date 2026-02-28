import { Injectable, Logger } from '@nestjs/common';
import type { ReceiptDto } from '../contracts/mvp';
import { PrismaService } from '../database/prisma.service';
import { ReceiptReconcilerService } from './receipt-reconciler.service';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const CACHE_STALE_MS = 5 * 60 * 1000;

@Injectable()
export class ReceiptsService {
  private readonly logger = new Logger(ReceiptsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reconciler: ReceiptReconcilerService,
  ) {}

  async getReceipts(pubkey: string, limit = DEFAULT_LIMIT): Promise<ReceiptDto[]> {
    const normalizedLimit = this.normalizeLimit(limit);

    let cached = await this.prisma.receiptCache.findMany({
      where: { ownerPubkey: pubkey },
      orderBy: [{ timestamp: 'desc' }, { updatedAt: 'desc' }],
      take: normalizedLimit,
    });

    const newest = cached[0];
    const needsBootstrap = cached.length === 0;
    const isStale = newest !== undefined && Date.now() - newest.updatedAt.getTime() > CACHE_STALE_MS;

    if (needsBootstrap || isStale) {
      try {
        await this.reconciler.syncOwner(pubkey, normalizedLimit);
        cached = await this.prisma.receiptCache.findMany({
          where: { ownerPubkey: pubkey },
          orderBy: [{ timestamp: 'desc' }, { updatedAt: 'desc' }],
          take: normalizedLimit,
        });
      } catch (error) {
        this.logger.warn(`Receipt reconciliation failed for ${pubkey}: ${String(error)}`);
      }
    }

    return cached.map((receipt) => ({
      address: receipt.address,
      agentProfile: receipt.agentProfile,
      seekerId: receipt.seekerId,
      intentHash: this.toIntentHash(receipt.intentHash),
      protocol: receipt.protocol,
      amountLamports: Number(receipt.amountLamports),
      txSignature: receipt.txSignature,
      status: this.toReceiptStatus(receipt.status),
      timestamp: receipt.timestamp,
      bump: receipt.bump,
    }));
  }

  private normalizeLimit(limit: number): number {
    if (!Number.isFinite(limit)) {
      return DEFAULT_LIMIT;
    }

    const integerLimit = Math.trunc(limit);
    if (integerLimit < 1) {
      return 1;
    }

    if (integerLimit > MAX_LIMIT) {
      return MAX_LIMIT;
    }

    return integerLimit;
  }

  private toIntentHash(value: unknown): number[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((item): item is number => typeof item === 'number');
  }

  private toReceiptStatus(value: string): ReceiptDto['status'] {
    if (value === 'Pending' || value === 'Completed' || value === 'Rejected' || value === 'Unknown') {
      return value;
    }

    return 'Unknown';
  }
}
