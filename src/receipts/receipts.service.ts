import { Injectable, Logger } from '@nestjs/common';
import { SolanaService } from '../solana/solana.service';
import { PublicKey } from '@solana/web3.js';

@Injectable()
export class ReceiptsService {
    private readonly logger = new Logger(ReceiptsService.name);

    constructor(private readonly solanaService: SolanaService) { }

    async getReceipts(pubkey: string, limit = 20) {
        const owner = new PublicKey(pubkey);
        return this.solanaService.fetchReceiptsByOwner(owner, limit);
    }
}
