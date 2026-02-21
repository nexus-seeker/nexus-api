import { Injectable, Logger } from '@nestjs/common';
import { SolanaService } from '../solana/solana.service';
import {
    PublicKey,
    SystemProgram,
    TransactionInstruction,
    TransactionMessage,
    VersionedTransaction,
} from '@solana/web3.js';
import * as crypto from 'crypto';

@Injectable()
export class TxAssemblerService {
    private readonly logger = new Logger(TxAssemblerService.name);

    constructor(private readonly solanaService: SolanaService) { }

    /**
     * Builds the check_and_record instruction to prepend to every agent tx.
     * This is the atomic policy enforcement — if it fails, the entire tx reverts.
     */
    buildCheckAndRecordIx(
        owner: PublicKey,
        amount: number,
        protocol: string,
        intentHash: Buffer,
    ): TransactionInstruction {
        const programId = this.solanaService.getProgramId();

        // PDA derivations
        const [profilePDA] = this.solanaService.findProfilePDA(owner);
        const [policyPDA] = this.solanaService.findPolicyPDA(owner);

        // We need the next_receipt_id from PolicyVault — but we can't read it
        // synchronously here. We'll pass it in from the caller.
        // For now, use 0 as placeholder. The real receipt ID gets resolved in assembleTransaction.
        // This method is called with the correct receipt ID from there.
        return this._buildCheckAndRecordIxWithReceiptId(
            owner,
            amount,
            protocol,
            intentHash,
            0,
        );
    }

    private _buildCheckAndRecordIxWithReceiptId(
        owner: PublicKey,
        amount: number,
        protocol: string,
        intentHash: Buffer,
        receiptId: number,
    ): TransactionInstruction {
        const programId = this.solanaService.getProgramId();

        const [profilePDA] = this.solanaService.findProfilePDA(owner);
        const [policyPDA] = this.solanaService.findPolicyPDA(owner);
        const [receiptPDA] = this.solanaService.findReceiptPDA(owner, receiptId);

        // Anchor discriminator = first 8 bytes of SHA256("global:check_and_record")
        const discriminator = crypto
            .createHash('sha256')
            .update('global:check_and_record')
            .digest()
            .slice(0, 8);

        // Serialize args: amount (u64) + protocol (string: u32 len + utf8) + intent_hash ([u8; 32])
        const amountBuf = Buffer.alloc(8);
        amountBuf.writeBigUInt64LE(BigInt(amount));

        const protocolLenBuf = Buffer.alloc(4);
        protocolLenBuf.writeUInt32LE(protocol.length);
        const protocolBuf = Buffer.from(protocol, 'utf-8');

        // intent_hash is already a 32-byte Buffer
        const intentHashBuf =
            intentHash.length === 32
                ? intentHash
                : crypto.createHash('sha256').update(intentHash).digest();

        const data = Buffer.concat([
            discriminator,
            amountBuf,
            protocolLenBuf,
            protocolBuf,
            intentHashBuf,
        ]);

        return new TransactionInstruction({
            programId,
            keys: [
                { pubkey: profilePDA, isSigner: false, isWritable: false },
                { pubkey: policyPDA, isSigner: false, isWritable: true },
                { pubkey: receiptPDA, isSigner: false, isWritable: true },
                { pubkey: owner, isSigner: true, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            data,
        });
    }

    /**
     * Assembles a full VersionedTransaction by prepending check_and_record_ix
     * to the Jupiter swap instructions.
     *
     * Returns the serialized base64 transaction ready for mobile signing.
     */
    async assembleTransaction(
        owner: PublicKey,
        amount: number,
        protocol: string,
        intent: string,
        jupiterInstructions: any,
    ): Promise<string> {
        // 1. Get the current receipt ID from PolicyVault
        const vault = await this.solanaService.fetchPolicyVault(owner);
        const receiptId = vault?.nextReceiptId ?? 0;

        // 2. Hash the intent string
        const intentHash = crypto.createHash('sha256').update(intent).digest();

        // 3. Build check_and_record instruction
        const checkAndRecordIx = this._buildCheckAndRecordIxWithReceiptId(
            owner,
            amount,
            protocol,
            intentHash,
            receiptId,
        );

        // 4. Decode Jupiter instructions from the API response
        const jupiterIxs = this.decodeJupiterInstructions(jupiterInstructions);

        // 5. Combine: [check_and_record, ...jupiterIxs]
        const allInstructions = [checkAndRecordIx, ...jupiterIxs];
        this.logger.log(
            `Assembled ${allInstructions.length} instructions ` +
            `(1 check_and_record + ${jupiterIxs.length} Jupiter)`,
        );

        // 6. Build VersionedTransaction → base64
        return this.solanaService.buildVersionedTransaction(owner, allInstructions);
    }

    /**
     * Decodes Jupiter swap-instructions API response into TransactionInstructions.
     * Jupiter returns: { setupInstructions, swapInstruction, cleanupInstruction, addressLookupTableAddresses }
     */
    private decodeJupiterInstructions(
        jupiterResult: any,
    ): TransactionInstruction[] {
        const instructions: TransactionInstruction[] = [];

        // If Jupiter returned a swapTransaction (legacy format), we can't decompose it
        if (jupiterResult.swapTransaction && !jupiterResult.swapInstruction) {
            this.logger.warn(
                'Jupiter returned a swapTransaction blob — cannot prepend check_and_record. ' +
                'Use swap-instructions endpoint instead.',
            );
            return [];
        }

        // Setup instructions (compute budget, ATA creation, etc.)
        if (jupiterResult.setupInstructions) {
            for (const ix of jupiterResult.setupInstructions) {
                instructions.push(this.decodeInstruction(ix));
            }
        }

        // The swap instruction itself
        if (jupiterResult.swapInstruction) {
            instructions.push(this.decodeInstruction(jupiterResult.swapInstruction));
        }

        // Cleanup instruction (close temp accounts)
        if (jupiterResult.cleanupInstruction) {
            instructions.push(
                this.decodeInstruction(jupiterResult.cleanupInstruction),
            );
        }

        return instructions;
    }

    /**
     * Decodes a single Jupiter instruction from their API format to web3.js format.
     * Jupiter format: { programId, accounts: [{ pubkey, isSigner, isWritable }], data }
     */
    private decodeInstruction(ix: any): TransactionInstruction {
        return new TransactionInstruction({
            programId: new PublicKey(ix.programId),
            keys: (ix.accounts || []).map((acc: any) => ({
                pubkey: new PublicKey(acc.pubkey),
                isSigner: acc.isSigner,
                isWritable: acc.isWritable,
            })),
            data: Buffer.from(ix.data, 'base64'),
        });
    }
}
