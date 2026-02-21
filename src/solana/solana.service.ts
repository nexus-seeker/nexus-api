import { Injectable, Logger } from '@nestjs/common';
import {
    Connection,
    PublicKey,
    VersionedTransaction,
    TransactionMessage,
    AddressLookupTableAccount,
    TransactionInstruction,
} from '@solana/web3.js';

@Injectable()
export class SolanaService {
    private readonly logger = new Logger(SolanaService.name);
    private readonly connection: Connection;
    private readonly programId: PublicKey;

    constructor() {
        const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
        this.connection = new Connection(rpcUrl, 'confirmed');
        this.programId = new PublicKey(
            process.env.NEXUS_PROGRAM_ID || 'DxV7vXf919YddC74X726PpsrPpHLXNZtdBsk6Lweh3HJ',
        );
        this.logger.log(`Solana RPC: ${rpcUrl}`);
        this.logger.log(`Program ID: ${this.programId.toBase58()}`);
    }

    getConnection(): Connection {
        return this.connection;
    }

    getProgramId(): PublicKey {
        return this.programId;
    }

    // ─── PDA Derivation ──────────────────────────────────────────────

    findProfilePDA(owner: PublicKey): [PublicKey, number] {
        return PublicKey.findProgramAddressSync(
            [Buffer.from('profile'), owner.toBuffer()],
            this.programId,
        );
    }

    findPolicyPDA(owner: PublicKey): [PublicKey, number] {
        return PublicKey.findProgramAddressSync(
            [Buffer.from('policy'), owner.toBuffer()],
            this.programId,
        );
    }

    findReceiptPDA(owner: PublicKey, receiptId: number): [PublicKey, number] {
        const buf = Buffer.alloc(8);
        buf.writeBigUInt64LE(BigInt(receiptId));
        return PublicKey.findProgramAddressSync(
            [Buffer.from('receipt'), owner.toBuffer(), buf],
            this.programId,
        );
    }

    // ─── Account Fetching ────────────────────────────────────────────

    async fetchPolicyVault(owner: PublicKey): Promise<any | null> {
        const [pda] = this.findPolicyPDA(owner);
        try {
            const accountInfo = await this.connection.getAccountInfo(pda);
            if (!accountInfo) return null;

            // Deserialize manually (skip 8-byte discriminator)
            const data = accountInfo.data.slice(8);
            return this.decodePolicyVault(data);
        } catch (err) {
            this.logger.warn(`Failed to fetch PolicyVault for ${owner.toBase58()}: ${err}`);
            return null;
        }
    }

    async fetchAgentProfile(owner: PublicKey): Promise<any | null> {
        const [pda] = this.findProfilePDA(owner);
        try {
            const accountInfo = await this.connection.getAccountInfo(pda);
            if (!accountInfo) return null;

            const data = accountInfo.data.slice(8);
            return this.decodeAgentProfile(data);
        } catch (err) {
            this.logger.warn(`Failed to fetch AgentProfile for ${owner.toBase58()}: ${err}`);
            return null;
        }
    }

    async fetchReceiptsByOwner(owner: PublicKey, limit = 20): Promise<any[]> {
        try {
            // Fetch via getProgramAccounts filtered by owner in the receipt data
            const accounts = await this.connection.getProgramAccounts(this.programId, {
                filters: [
                    { dataSize: 8 + 32 + (4 + 64) + 32 + (4 + 32) + 8 + (4 + 88) + 1 + 8 + 1 }, // ExecutionReceipt size
                ],
            });

            const receipts: any[] = [];
            for (const { pubkey, account } of accounts) {
                const data = account.data.slice(8);
                try {
                    const receipt = this.decodeExecutionReceipt(data);
                    // Filter by matching owner through agentProfile reference
                    const [profilePDA] = this.findProfilePDA(owner);
                    if (receipt.agentProfile === profilePDA.toBase58()) {
                        receipts.push({ ...receipt, address: pubkey.toBase58() });
                    }
                } catch {
                    // Skip malformed accounts
                }
            }

            return receipts
                .sort((a, b) => b.timestamp - a.timestamp)
                .slice(0, limit);
        } catch (err) {
            this.logger.warn(`Failed to fetch receipts: ${err}`);
            return [];
        }
    }

    // ─── Transaction Building ────────────────────────────────────────

    async buildVersionedTransaction(
        payerKey: PublicKey,
        instructions: TransactionInstruction[],
        lookupTableAccounts: AddressLookupTableAccount[] = [],
    ): Promise<string> {
        const { blockhash } = await this.connection.getLatestBlockhash('confirmed');

        const messageV0 = new TransactionMessage({
            payerKey,
            recentBlockhash: blockhash,
            instructions,
        }).compileToV0Message(lookupTableAccounts);

        const tx = new VersionedTransaction(messageV0);
        return Buffer.from(tx.serialize()).toString('base64');
    }

    // ─── Borsh Decoders (manual, no IDL dependency) ──────────────────

    private decodePolicyVault(data: Buffer): any {
        let offset = 0;

        const owner = new PublicKey(data.slice(offset, offset + 32)).toBase58();
        offset += 32;

        const dailyMaxLamports = Number(data.readBigUInt64LE(offset));
        offset += 8;

        const currentSpend = Number(data.readBigUInt64LE(offset));
        offset += 8;

        const lastResetTs = Number(data.readBigInt64LE(offset));
        offset += 8;

        // Vec<String> — read length, then each string
        const vecLen = data.readUInt32LE(offset);
        offset += 4;
        const allowedProtocols: string[] = [];
        for (let i = 0; i < vecLen; i++) {
            const strLen = data.readUInt32LE(offset);
            offset += 4;
            allowedProtocols.push(data.slice(offset, offset + strLen).toString('utf-8'));
            offset += strLen;
        }

        const nextReceiptId = Number(data.readBigUInt64LE(offset));
        offset += 8;

        const isActive = data.readUInt8(offset) === 1;
        offset += 1;

        const bump = data.readUInt8(offset);

        return {
            owner,
            dailyMaxLamports,
            currentSpend,
            lastResetTs,
            allowedProtocols,
            nextReceiptId,
            isActive,
            bump,
        };
    }

    private decodeAgentProfile(data: Buffer): any {
        let offset = 0;

        const owner = new PublicKey(data.slice(offset, offset + 32)).toBase58();
        offset += 32;

        const seekerIdLen = data.readUInt32LE(offset);
        offset += 4;
        const seekerId = data.slice(offset, offset + seekerIdLen).toString('utf-8');
        offset += seekerIdLen;

        const genesisTokenHolder = data.readUInt8(offset) === 1;
        offset += 1;

        const createdAt = Number(data.readBigInt64LE(offset));
        offset += 8;

        const bump = data.readUInt8(offset);

        return { owner, seekerId, genesisTokenHolder, createdAt, bump };
    }

    private decodeExecutionReceipt(data: Buffer): any {
        let offset = 0;

        const agentProfile = new PublicKey(data.slice(offset, offset + 32)).toBase58();
        offset += 32;

        const seekerIdLen = data.readUInt32LE(offset);
        offset += 4;
        const seekerId = data.slice(offset, offset + seekerIdLen).toString('utf-8');
        offset += seekerIdLen;

        const intentHash = Array.from(data.slice(offset, offset + 32));
        offset += 32;

        const protocolLen = data.readUInt32LE(offset);
        offset += 4;
        const protocol = data.slice(offset, offset + protocolLen).toString('utf-8');
        offset += protocolLen;

        const amountLamports = Number(data.readBigUInt64LE(offset));
        offset += 8;

        const txSignatureLen = data.readUInt32LE(offset);
        offset += 4;
        const txSignature = data.slice(offset, offset + txSignatureLen).toString('utf-8');
        offset += txSignatureLen;

        const statusByte = data.readUInt8(offset);
        offset += 1;
        const statusMap = ['Pending', 'Completed', 'Rejected'];
        const status = statusMap[statusByte] || 'Unknown';

        const timestamp = Number(data.readBigInt64LE(offset));
        offset += 8;

        const bump = data.readUInt8(offset);

        return {
            agentProfile,
            seekerId,
            intentHash,
            protocol,
            amountLamports,
            txSignature,
            status,
            timestamp,
            bump,
        };
    }
}
