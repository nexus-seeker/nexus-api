import { Injectable, Logger } from '@nestjs/common';
import { SolanaService } from '../solana/solana.service';
import { PublicKey, TransactionInstruction, SystemProgram } from '@solana/web3.js';
import * as borsh from '@coral-xyz/anchor/dist/cjs/utils/bytes';

@Injectable()
export class PolicyService {
    private readonly logger = new Logger(PolicyService.name);

    constructor(private readonly solanaService: SolanaService) { }

    async getPolicy(pubkey: string) {
        const owner = new PublicKey(pubkey);
        const vault = await this.solanaService.fetchPolicyVault(owner);

        if (!vault) {
            return {
                exists: false,
                owner: pubkey,
                dailyMaxLamports: 0,
                currentSpend: 0,
                lastResetTs: 0,
                allowedProtocols: [],
                nextReceiptId: 0,
                isActive: false,
            };
        }

        return { exists: true, ...vault };
    }

    async buildUpdatePolicyTx(
        pubkey: string,
        dailyMaxLamports: number,
        allowedProtocols: string[],
        isActive: boolean,
    ): Promise<string> {
        const owner = new PublicKey(pubkey);
        const [policyPDA] = this.solanaService.findPolicyPDA(owner);
        const programId = this.solanaService.getProgramId();

        // Build the update_policy instruction manually
        // Anchor discriminator for "update_policy" = first 8 bytes of SHA256("global:update_policy")
        const crypto = await import('crypto');
        const discriminator = crypto
            .createHash('sha256')
            .update('global:update_policy')
            .digest()
            .slice(0, 8);

        // Serialize arguments: daily_max_lamports (u64) + allowed_protocols (vec<string>) + is_active (bool)
        const dailyMaxBuf = Buffer.alloc(8);
        dailyMaxBuf.writeBigUInt64LE(BigInt(dailyMaxLamports));

        // Vec<String>: length (u32) + each string (u32 len + utf8 bytes)
        const vecLenBuf = Buffer.alloc(4);
        vecLenBuf.writeUInt32LE(allowedProtocols.length);

        const stringBufs: Buffer[] = [];
        for (const proto of allowedProtocols) {
            const strLenBuf = Buffer.alloc(4);
            strLenBuf.writeUInt32LE(proto.length);
            stringBufs.push(strLenBuf, Buffer.from(proto, 'utf-8'));
        }

        const isActiveBuf = Buffer.from([isActive ? 1 : 0]);

        const instructionData = Buffer.concat([
            discriminator,
            dailyMaxBuf,
            vecLenBuf,
            ...stringBufs,
            isActiveBuf,
        ]);

        const ix = new TransactionInstruction({
            programId,
            keys: [
                { pubkey: policyPDA, isSigner: false, isWritable: true },
                { pubkey: owner, isSigner: true, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            data: instructionData,
        });

        return this.solanaService.buildVersionedTransaction(owner, [ix]);
    }
}
