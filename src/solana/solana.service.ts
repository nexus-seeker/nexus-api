import { Injectable, Logger } from '@nestjs/common';
import {
  Connection,
  PublicKey,
  VersionedTransaction,
  TransactionMessage,
  AddressLookupTableAccount,
  TransactionInstruction,
  SendTransactionError,
} from '@solana/web3.js';

@Injectable()
export class SolanaService {
  private readonly logger = new Logger(SolanaService.name);
  private readonly connection: Connection;
  private readonly programId: PublicKey;

  constructor() {
    const rpcUrl =
      process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
    this.connection = new Connection(rpcUrl, 'confirmed');
    this.programId = new PublicKey(
      process.env.NEXUS_PROGRAM_ID ||
        process.env.Kawula_PROGRAM_ID ||
        '5twpBNVkDu9YkuQ2aDRWTB1wvA4wjBu42Q42kn7Fy2G5',
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
      this.logger.warn(
        `Failed to fetch PolicyVault for ${owner.toBase58()}: ${err}`,
      );
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
      this.logger.warn(
        `Failed to fetch AgentProfile for ${owner.toBase58()}: ${err}`,
      );
      return null;
    }
  }

  async fetchReceiptsByOwner(owner: PublicKey, limit = 20): Promise<any[]> {
    try {
      const executionReceiptDataSize =
        8 + // account discriminator
        32 + // agent_profile
        (4 + 64) + // seeker_id
        32 + // intent_hash
        (4 + 32) + // protocol
        8 + // amount_lamports
        8 + // protocol_fee_saved_lamports
        (4 + 88) + // tx_signature
        1 + // status enum
        8 + // timestamp
        1; // bump

      // Fetch via getProgramAccounts filtered by owner in the receipt data
      const accounts = await this.connection.getProgramAccounts(
        this.programId,
        {
          filters: [
            {
              dataSize: executionReceiptDataSize,
            },
          ],
        },
      );

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

      return receipts.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
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

  async resolveAddressLookupTables(
    addresses: string[] = [],
  ): Promise<AddressLookupTableAccount[]> {
    if (!addresses.length) {
      return [];
    }

    const tables = await Promise.all(
      addresses.map(async (address) => {
        try {
          const key = new PublicKey(address);
          const result = await this.connection.getAddressLookupTable(key);
          return result.value;
        } catch (err) {
          this.logger.warn(`Failed to fetch ALT ${address}: ${err}`);
          return null;
        }
      }),
    );

    return tables.filter(
      (table): table is AddressLookupTableAccount => table !== null,
    );
  }

  async simulateUnsignedTx(unsignedTxBase64: string): Promise<{ fee: number }> {
    const tx = VersionedTransaction.deserialize(
      Buffer.from(unsignedTxBase64, 'base64'),
    );

    const simulation = await this.connection.simulateTransaction(tx, {
      sigVerify: false,
      replaceRecentBlockhash: true,
    });

    if (simulation.value.err) {
      throw new Error(
        `Simulation failed: ${JSON.stringify(simulation.value.err)}`,
      );
    }

    const feeResponse = await this.connection.getFeeForMessage(
      tx.message,
      'confirmed',
    );

    return {
      fee: feeResponse.value ?? 0,
    };
  }

  /**
   * Broadcasts a signed VersionedTransaction (base64) to devnet and waits for confirmation.
   * Used by the mobile client to relay signed onboarding txs through the API, since the
   * device may not have direct access to the Solana devnet RPC.
   *
   * IMPORTANT: Do NOT modify the transaction message (e.g. replace blockhash) after the wallet
   * has signed it — any message change invalidates the signature.
   */
  async broadcastSignedTx(
    signedTxBase64: string,
  ): Promise<{ signature: string }> {
    const txBytes = Buffer.from(signedTxBase64, 'base64');
    const tx = VersionedTransaction.deserialize(txBytes);

    // Read the blockhash the wallet actually signed
    const blockhash = tx.message.recentBlockhash;

    let signature: string;
    try {
      // skipPreflight: false makes it simulate first. Useful to catch Insufficient SOL immediately!
      signature = await this.connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
        maxRetries: 5,
      });
    } catch (err: any) {
      this.logger.error(`SendRawTransaction error: ${err.message}`, err.stack);

      // Check if it's a known Solana error like insufficient funds
      if (
        err instanceof SendTransactionError ||
        err.name === 'SendTransactionError'
      ) {
        const logs = err.logs ? err.logs.join('\\n') : '';
        if (
          logs.includes('insufficient funds') ||
          logs.includes('rent-exempt minimum')
        ) {
          throw new Error(
            'Insufficient SOL balance to complete this transaction.',
          );
        }
        throw new Error(`Simulation failed: ${err.message}.\\nLogs: ${logs}`);
      }
      throw new Error(`Broadcast failed: ${err.message}`);
    }

    // Get a fresh lastValidBlockHeight as an expiry proxy (blockhash rotation is ~1 min)
    const { lastValidBlockHeight } =
      await this.connection.getLatestBlockhash('confirmed');

    try {
      await this.connection.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        'confirmed',
      );
    } catch (err: any) {
      // If the transaction confirmation times out or the block height is exceeded,
      // we give a highly clear message so the frontend knows that the blockhash expired.
      this.logger.error(`ConfirmTransaction error: ${err.message}`);
      if (
        err.name === 'TransactionExpiredBlockheightExceededError' ||
        err.message?.includes('block height exceeded')
      ) {
        throw new Error(
          'Transaction expired (Block height exceeded). Please try again quickly after signing.',
        );
      }
      throw new Error(`Transaction failed to confirm: ${err.message}`);
    }

    this.logger.log(`Broadcast confirmed: ${signature}`);
    return { signature };
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
      allowedProtocols.push(
        data.slice(offset, offset + strLen).toString('utf-8'),
      );
      offset += strLen;
    }

    // Vec<ProtocolCap> { protocol: String, max_lamports: u64, current_spend: u64 }
    const protocolCapsLen = data.readUInt32LE(offset);
    offset += 4;
    for (let i = 0; i < protocolCapsLen; i++) {
      const protocolLen = data.readUInt32LE(offset);
      offset += 4;
      offset += protocolLen;
      offset += 8;
      offset += 8;
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

    const agentProfile = new PublicKey(
      data.slice(offset, offset + 32),
    ).toBase58();
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

    const protocolFeeSavedLamports = Number(data.readBigUInt64LE(offset));
    offset += 8;

    const txSignatureLen = data.readUInt32LE(offset);
    offset += 4;
    const txSignature = data
      .slice(offset, offset + txSignatureLen)
      .toString('utf-8');
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
      protocolFeeSavedLamports,
      txSignature,
      status,
      timestamp,
      bump,
    };
  }
}
