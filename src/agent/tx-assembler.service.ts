import { Injectable, Logger } from '@nestjs/common';
import { SolanaService } from '../solana/solana.service';
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  VersionedTransaction,
  TransactionMessage,
} from '@solana/web3.js';
import * as crypto from 'crypto';

interface JupiterAccountPayload {
  pubkey: string;
  isSigner: boolean;
  isWritable: boolean;
}

interface JupiterInstructionPayload {
  programId: string;
  accounts: JupiterAccountPayload[];
  data: string;
}

interface JupiterInstructionsPayload {
  setupInstructions?: JupiterInstructionPayload[];
  swapInstruction?: JupiterInstructionPayload;
  cleanupInstruction?: JupiterInstructionPayload;
  swapTransaction?: string;
  addressLookupTableAddresses?: string[];
}

@Injectable()
export class TxAssemblerService {
  private readonly logger = new Logger(TxAssemblerService.name);
  private readonly maxRawTransactionBytes = 1232;

  constructor(private readonly solanaService: SolanaService) {}

  private buildCheckAndRecordIxWithReceiptId(
    owner: PublicKey,
    amount: number,
    protocol: string,
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

    // Serialize args: amount (u64) + protocol (string: u32 len + utf8)
    const amountBuf = Buffer.alloc(8);
    amountBuf.writeBigUInt64LE(BigInt(amount));

    const protocolBuf = Buffer.from(protocol, 'utf-8');
    const protocolLenBuf = Buffer.alloc(4);
    protocolLenBuf.writeUInt32LE(protocolBuf.length);

    const data = Buffer.concat([
      discriminator,
      amountBuf,
      protocolLenBuf,
      protocolBuf,
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
  async assembleSplTransferTransaction(
    owner: PublicKey,
    recipient: PublicKey,
    amount: number,
  ): Promise<string> {
    const vault = await this.solanaService.fetchPolicyVault(owner);
    const receiptId = vault?.nextReceiptId ?? 0;

    const checkAndRecordIx = this.buildCheckAndRecordIxWithReceiptId(
      owner,
      amount,
      'spl_transfer',
      receiptId,
    );

    const transferIx = SystemProgram.transfer({
      fromPubkey: owner,
      toPubkey: recipient,
      lamports: amount,
    });

    return this.solanaService.buildVersionedTransaction(
      owner,
      [checkAndRecordIx, transferIx],
      [],
    );
  }

  async assembleTransaction(
    owner: PublicKey,
    amount: number,
    protocol: string,
    jupiterInstructions: unknown,
  ): Promise<string> {
    // 1. Get the current receipt ID from PolicyVault
    const vault = await this.solanaService.fetchPolicyVault(owner);
    const receiptId = vault?.nextReceiptId ?? 0;

    // 2. Build check_and_record instruction
    const checkAndRecordIx = this.buildCheckAndRecordIxWithReceiptId(
      owner,
      amount,
      protocol,
      receiptId,
    );

    // 3. Decode Jupiter instructions from the API response
    const payload = this.parseJupiterPayload(jupiterInstructions);

    const lookupTableAddresses = payload.addressLookupTableAddresses || [];
    const lookupTableAccounts =
      await this.solanaService.resolveAddressLookupTables(lookupTableAddresses);

    const buildCandidate = async (includeCleanupInstruction: boolean) => {
      const jupiterIxs = this.decodeJupiterInstructions(
        payload,
        includeCleanupInstruction,
      );

      const allInstructions = [checkAndRecordIx, ...jupiterIxs];
      this.logger.log(
        `Assembled ${allInstructions.length} instructions ` +
          `(1 check_and_record + ${jupiterIxs.length} Jupiter)`,
      );

      const txBase64 = await this.solanaService.buildVersionedTransaction(
        owner,
        allInstructions,
        lookupTableAccounts,
      );

      return {
        txBase64,
        includeCleanupInstruction,
      };
    };

    const hasCleanupInstruction = payload.cleanupInstruction != null;
    let built: { txBase64: string; includeCleanupInstruction: boolean };

    try {
      built = await buildCandidate(hasCleanupInstruction);
    } catch (err) {
      if (hasCleanupInstruction && this.isTransactionTooLargeError(err)) {
        this.logger.warn(
          'Transaction exceeded size limit with cleanup ix; retrying without cleanup instruction',
        );
        built = await buildCandidate(false);
      } else {
        throw err;
      }
    }

    if (
      built.includeCleanupInstruction &&
      this.isSerializedTransactionTooLarge(built.txBase64)
    ) {
      this.logger.warn(
        'Transaction payload too large after serialization; retrying without cleanup instruction',
      );
      built = await buildCandidate(false);
    }

    if (this.isSerializedTransactionTooLarge(built.txBase64)) {
      throw new Error(
        `Assembled transaction exceeds Solana size limit (${this.maxRawTransactionBytes} raw bytes)`,
      );
    }

    // 5. Build VersionedTransaction → base64
    return built.txBase64;
  }

  async simulateUnsignedTx(unsignedTxBase64: string): Promise<{ fee: number }> {
    return this.solanaService.simulateUnsignedTx(unsignedTxBase64);
  }

  /**
   * Takes a Raydium-provided VersionedTransaction (base64),
   * extracts its instructions, prepends checkIx, and returns a new base64 tx.
   *
   * CRITICAL: checkIx is ALWAYS instruction [0] — same rule as Jupiter path.
   */
  async assembleFromRaydiumTx(params: {
    userPubkey: string;
    amountLamports: number;
    protocol: string;
    raydiumTxBase64: string;
    addressLookupTables: string[];
  }): Promise<string> {
    const {
      userPubkey,
      amountLamports,
      protocol,
      raydiumTxBase64,
      addressLookupTables,
    } = params;
    const owner = new PublicKey(userPubkey);

    // 1. Get the current receipt ID from PolicyVault
    const vault = await this.solanaService.fetchPolicyVault(owner);
    const receiptId = vault?.nextReceiptId ?? 0;

    // 2. Build check_and_record instruction
    const checkAndRecordIx = this.buildCheckAndRecordIxWithReceiptId(
      owner,
      amountLamports,
      protocol,
      receiptId,
    );

    // 3. Deserialize Raydium's VersionedTransaction and extract instructions
    const raydiumTxBytes = Buffer.from(raydiumTxBase64, 'base64');
    const raydiumTx = VersionedTransaction.deserialize(raydiumTxBytes);

    // 4. Fetch ALTs referenced by the Raydium tx so we can decompile it
    const raydiumMessage = raydiumTx.message;
    const raydiumAltAddresses = raydiumMessage.addressTableLookups.map(
      (l) => l.accountKey,
    );
    const raydiumAlts = await Promise.all(
      raydiumAltAddresses.map((addr) =>
        this.solanaService
          .getConnection()
          .getAddressLookupTable(addr)
          .then((r) => r.value!),
      ),
    );

    // 5. Decompile to get raw TransactionInstruction[]
    const decompiled = TransactionMessage.decompile(raydiumMessage, {
      addressLookupTableAccounts: raydiumAlts,
    });
    const raydiumIxs = decompiled.instructions;

    // 6. Fetch any additional ALTs passed from route-selector
    const extraAltAccounts = await Promise.all(
      addressLookupTables
        .filter(
          (addr) =>
            !raydiumAltAddresses.map((k) => k.toBase58()).includes(addr),
        )
        .map((addr) =>
          this.solanaService
            .getConnection()
            .getAddressLookupTable(new PublicKey(addr))
            .then((r) => r.value!),
        ),
    );

    const allAlts = [...raydiumAlts, ...extraAltAccounts].filter(Boolean);

    // 7. Build new VersionedTransaction with checkIx prepended
    const { blockhash } = await this.solanaService
      .getConnection()
      .getLatestBlockhash();
    const message = new TransactionMessage({
      payerKey: owner,
      recentBlockhash: blockhash,
      instructions: [checkAndRecordIx, ...raydiumIxs],
    }).compileToV0Message(allAlts);

    const tx = new VersionedTransaction(message);
    const serialized = Buffer.from(tx.serialize()).toString('base64');

    this.logger.log(
      `Assembled Raydium transaction with ${raydiumIxs.length} instructions ` +
        `(1 check_and_record + ${raydiumIxs.length} Raydium)`,
    );

    return serialized;
  }

  /**
   * Decodes Jupiter swap-instructions API response into TransactionInstructions.
   * Jupiter returns: { setupInstructions, swapInstruction, cleanupInstruction, addressLookupTableAddresses }
   */
  private decodeJupiterInstructions(
    jupiterResult: JupiterInstructionsPayload,
    includeCleanupInstruction = true,
  ): TransactionInstruction[] {
    const instructions: TransactionInstruction[] = [];

    // If Jupiter returned a swapTransaction (legacy format), we can't decompose it
    if (jupiterResult.swapTransaction && !jupiterResult.swapInstruction) {
      throw new Error(
        'Jupiter returned swapTransaction only; cannot prepend check_and_record. ' +
          'Use swap-instructions endpoint.',
      );
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
    if (includeCleanupInstruction && jupiterResult.cleanupInstruction) {
      instructions.push(
        this.decodeInstruction(jupiterResult.cleanupInstruction),
      );
    }

    if (instructions.length === 0) {
      throw new Error('No Jupiter instructions to assemble');
    }

    return instructions;
  }

  private parseJupiterPayload(payload: unknown): JupiterInstructionsPayload {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid Jupiter instruction payload: expected object');
    }

    const candidate = payload as Record<string, unknown>;

    const setupInstructions =
      candidate.setupInstructions == null
        ? undefined
        : this.assertInstructionList(
            candidate.setupInstructions,
            'setupInstructions',
          );
    const swapInstruction =
      candidate.swapInstruction == null
        ? undefined
        : this.assertInstruction(candidate.swapInstruction, 'swapInstruction');
    const cleanupInstruction =
      candidate.cleanupInstruction == null
        ? undefined
        : this.assertInstruction(
            candidate.cleanupInstruction,
            'cleanupInstruction',
          );

    if (
      candidate.swapTransaction != null &&
      typeof candidate.swapTransaction !== 'string'
    ) {
      throw new Error(
        'Invalid Jupiter instruction payload: swapTransaction must be a string',
      );
    }

    if (
      candidate.addressLookupTableAddresses != null &&
      !(
        Array.isArray(candidate.addressLookupTableAddresses) &&
        candidate.addressLookupTableAddresses.every(
          (address) => typeof address === 'string',
        )
      )
    ) {
      throw new Error(
        'Invalid Jupiter instruction payload: addressLookupTableAddresses must be string[]',
      );
    }

    return {
      setupInstructions,
      swapInstruction,
      cleanupInstruction,
      swapTransaction: candidate.swapTransaction as string | undefined,
      addressLookupTableAddresses: candidate.addressLookupTableAddresses as
        | string[]
        | undefined,
    };
  }

  private assertInstructionList(
    value: unknown,
    fieldName: string,
  ): JupiterInstructionPayload[] {
    if (!Array.isArray(value)) {
      throw new Error(
        `Invalid Jupiter instruction payload: ${fieldName} must be an array`,
      );
    }

    return value.map((instruction, index) =>
      this.assertInstruction(instruction, `${fieldName}[${index}]`),
    );
  }

  private assertInstruction(
    value: unknown,
    fieldName: string,
  ): JupiterInstructionPayload {
    if (!value || typeof value !== 'object') {
      throw new Error(
        `Invalid Jupiter instruction payload: ${fieldName} must be an object`,
      );
    }

    const candidate = value as Record<string, unknown>;
    const accounts = candidate.accounts;

    if (typeof candidate.programId !== 'string') {
      throw new Error(
        `Invalid Jupiter instruction payload: ${fieldName}.programId must be a string`,
      );
    }

    if (typeof candidate.data !== 'string' || !this.isBase64(candidate.data)) {
      throw new Error(
        `Invalid Jupiter instruction payload: ${fieldName}.data must be base64 string`,
      );
    }

    if (!Array.isArray(accounts)) {
      throw new Error(
        `Invalid Jupiter instruction payload: ${fieldName}.accounts must be an array`,
      );
    }

    return {
      programId: candidate.programId,
      data: candidate.data,
      accounts: accounts.map((account, index) =>
        this.assertAccount(account, `${fieldName}.accounts[${index}]`),
      ),
    };
  }

  private assertAccount(
    value: unknown,
    fieldName: string,
  ): JupiterAccountPayload {
    if (!value || typeof value !== 'object') {
      throw new Error(
        `Invalid Jupiter instruction payload: ${fieldName} must be an object`,
      );
    }

    const candidate = value as Record<string, unknown>;

    if (typeof candidate.pubkey !== 'string') {
      throw new Error(
        `Invalid Jupiter instruction payload: ${fieldName}.pubkey must be a string`,
      );
    }

    if (typeof candidate.isSigner !== 'boolean') {
      throw new Error(
        `Invalid Jupiter instruction payload: ${fieldName}.isSigner must be a boolean`,
      );
    }

    if (typeof candidate.isWritable !== 'boolean') {
      throw new Error(
        `Invalid Jupiter instruction payload: ${fieldName}.isWritable must be a boolean`,
      );
    }

    return {
      pubkey: candidate.pubkey,
      isSigner: candidate.isSigner,
      isWritable: candidate.isWritable,
    };
  }

  private isBase64(value: string): boolean {
    if (value.length === 0 || value.length % 4 !== 0) {
      return false;
    }

    return /^[A-Za-z0-9+/]+={0,2}$/.test(value);
  }

  private isSerializedTransactionTooLarge(base64: string): boolean {
    return (
      Buffer.from(base64, 'base64').byteLength > this.maxRawTransactionBytes
    );
  }

  private isTransactionTooLargeError(error: unknown): boolean {
    const message =
      error instanceof Error
        ? error.message.toLowerCase()
        : String(error).toLowerCase();
    return (
      message.includes('encoding overruns uint8array') ||
      message.includes('too large')
    );
  }

  /**
   * Decodes a single Jupiter instruction from their API format to web3.js format.
   * Jupiter format: { programId, accounts: [{ pubkey, isSigner, isWritable }], data }
   */
  private decodeInstruction(
    ix: JupiterInstructionPayload,
  ): TransactionInstruction {
    try {
      return new TransactionInstruction({
        programId: new PublicKey(ix.programId),
        keys: ix.accounts.map((acc) => ({
          pubkey: new PublicKey(acc.pubkey),
          isSigner: acc.isSigner,
          isWritable: acc.isWritable,
        })),
        data: Buffer.from(ix.data, 'base64'),
      });
    } catch {
      throw new Error(
        'Invalid Jupiter instruction payload: failed to decode instruction',
      );
    }
  }
}
