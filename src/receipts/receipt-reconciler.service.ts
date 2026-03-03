import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PublicKey } from '@solana/web3.js';
import { PrismaService } from '../database/prisma.service';
import { SolanaService } from '../solana/solana.service';

const DEFAULT_RECEIPTS_LIMIT = 20;
const DEFAULT_RECONCILIATION_INTERVAL_MS = 60_000;

@Injectable()
export class ReceiptReconcilerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReceiptReconcilerService.name);
  private reconciliationTimer?: NodeJS.Timeout;
  private isScheduledSyncInFlight = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly solanaService: SolanaService,
  ) {}

  onModuleInit(): void {
    this.reconciliationTimer = setInterval(() => {
      if (this.isScheduledSyncInFlight) {
        return;
      }

      this.isScheduledSyncInFlight = true;
      void this.syncRecentOwners()
        .catch((error) => {
          this.logger.warn(
            `Scheduled receipt reconciliation failed: ${String(error)}`,
          );
        })
        .finally(() => {
          this.isScheduledSyncInFlight = false;
        });
    }, DEFAULT_RECONCILIATION_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.reconciliationTimer) {
      clearInterval(this.reconciliationTimer);
      this.reconciliationTimer = undefined;
    }
  }

  async syncOwner(
    pubkey: string,
    limit = DEFAULT_RECEIPTS_LIMIT,
  ): Promise<number> {
    const owner = new PublicKey(pubkey);
    const receipts = await this.solanaService.fetchReceiptsByOwner(
      owner,
      limit,
    );

    for (const receipt of receipts) {
      await this.prisma.receiptCache.upsert({
        where: { address: receipt.address },
        create: {
          address: receipt.address,
          ownerPubkey: pubkey,
          agentProfile: receipt.agentProfile,
          seekerId: receipt.seekerId,
          intentHash: receipt.intentHash,
          protocol: receipt.protocol,
          amountLamports: BigInt(receipt.amountLamports),
          txSignature: receipt.txSignature,
          status: receipt.status,
          timestamp: receipt.timestamp,
          bump: receipt.bump,
        },
        update: {
          ownerPubkey: pubkey,
          agentProfile: receipt.agentProfile,
          seekerId: receipt.seekerId,
          intentHash: receipt.intentHash,
          protocol: receipt.protocol,
          amountLamports: BigInt(receipt.amountLamports),
          txSignature: receipt.txSignature,
          status: receipt.status,
          timestamp: receipt.timestamp,
          bump: receipt.bump,
        },
      });
    }

    this.logger.debug(`Synced ${receipts.length} receipts for ${pubkey}`);
    return receipts.length;
  }

  async syncRecentOwners(
    ownerLimit = 25,
    receiptLimit = DEFAULT_RECEIPTS_LIMIT,
  ): Promise<void> {
    const owners = await this.prisma.receiptCache.findMany({
      select: { ownerPubkey: true },
      distinct: ['ownerPubkey'],
      orderBy: { updatedAt: 'desc' },
      take: ownerLimit,
    });

    for (const owner of owners) {
      try {
        await this.syncOwner(owner.ownerPubkey, receiptLimit);
      } catch (error) {
        this.logger.warn(
          `Failed to sync receipts for ${owner.ownerPubkey}: ${String(error)}`,
        );
      }
    }
  }
}
