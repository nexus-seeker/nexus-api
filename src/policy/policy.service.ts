import { Injectable, Logger } from '@nestjs/common';
import { SolanaService } from '../solana/solana.service';
import {
  PublicKey,
  TransactionInstruction,
  SystemProgram,
} from '@solana/web3.js';

// Default policy applied during onboarding for new wallets
const ONBOARD_DAILY_MAX_LAMPORTS = 1_000_000_000; // 1 SOL
const ONBOARD_ALLOWED_PROTOCOLS = [
  'jupiter',
  'raydium',
  'spl_transfer',
  'multi_send',
  'marinade',
];
const ONBOARD_IS_ACTIVE = true;

@Injectable()
export class PolicyService {
  private readonly logger = new Logger(PolicyService.name);

  constructor(private readonly solanaService: SolanaService) {}

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

  /**
   * Checks whether a wallet has been fully onboarded (AgentProfile exists).
   */
  async isWalletOnboarded(pubkey: string): Promise<boolean> {
    const owner = new PublicKey(pubkey);
    const profile = await this.solanaService.fetchAgentProfile(owner);
    return profile !== null;
  }

  /**
   * Builds the onboarding unsigned transaction(s) for a wallet.
   *
   * Both create_profile and update_policy are combined into ONE atomic
   * VersionedTransaction — if create_profile fails on-chain, update_policy
   * never runs, preventing the partial-state bug where PolicyVault exists
   * but AgentProfile doesn't.
   *
   * Handles partial onboarding: if PolicyVault already exists but
   * AgentProfile doesn't, only create_profile is included.
   */
  async buildOnboardTxs(pubkey: string): Promise<{
    alreadyOnboarded: boolean;
    /** Single atomic unsigned base64 VersionedTransaction */
    onboardTx: string | null;
  }> {
    const owner = new PublicKey(pubkey);

    const profile = await this.solanaService.fetchAgentProfile(owner);
    if (profile !== null) {
      return { alreadyOnboarded: true, onboardTx: null };
    }

    const vault = await this.solanaService.fetchPolicyVault(owner);
    const instructions = await this.buildOnboardInstructions(owner, {
      includeUpdatePolicy: vault === null,
    });

    const onboardTx = await this.solanaService.buildVersionedTransaction(
      owner,
      instructions,
    );
    return { alreadyOnboarded: false, onboardTx };
  }

  /**
   * Builds the instruction(s) needed for onboarding.
   * Always includes create_profile. Optionally includes update_policy.
   */
  private async buildOnboardInstructions(
    owner: PublicKey,
    opts: { includeUpdatePolicy: boolean },
  ) {
    const instructions = [];
    instructions.push(await this.buildCreateProfileInstruction(owner));
    if (opts.includeUpdatePolicy) {
      instructions.push(
        await this.buildUpdatePolicyInstruction(
          owner,
          ONBOARD_DAILY_MAX_LAMPORTS,
          ONBOARD_ALLOWED_PROTOCOLS,
          ONBOARD_IS_ACTIVE,
        ),
      );
    }
    return instructions;
  }

  /**
   * Builds the create_profile TransactionInstruction.
   */
  private async buildCreateProfileInstruction(
    owner: PublicKey,
  ): Promise<TransactionInstruction> {
    const [profilePDA] = this.solanaService.findProfilePDA(owner);
    const programId = this.solanaService.getProgramId();
    const crypto = await import('crypto');
    const discriminator = crypto
      .createHash('sha256')
      .update('global:create_profile')
      .digest()
      .slice(0, 8);

    return new TransactionInstruction({
      programId,
      keys: [
        { pubkey: profilePDA, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: discriminator,
    });
  }

  /** Builds an unsigned create_profile VersionedTransaction (single-ix). */
  private async buildCreateProfileTx(owner: PublicKey): Promise<string> {
    const ix = await this.buildCreateProfileInstruction(owner);
    return this.solanaService.buildVersionedTransaction(owner, [ix]);
  }

  /**
   * Builds the update_policy TransactionInstruction.
   */
  private async buildUpdatePolicyInstruction(
    owner: PublicKey,
    dailyMaxLamports: number,
    allowedProtocols: string[],
    isActive: boolean,
  ): Promise<TransactionInstruction> {
    const [policyPDA] = this.solanaService.findPolicyPDA(owner);
    const programId = this.solanaService.getProgramId();

    const crypto = await import('crypto');
    const discriminator = crypto
      .createHash('sha256')
      .update('global:update_policy')
      .digest()
      .slice(0, 8);

    const dailyMaxBuf = Buffer.alloc(8);
    dailyMaxBuf.writeBigUInt64LE(BigInt(dailyMaxLamports));

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

    return new TransactionInstruction({
      programId,
      keys: [
        { pubkey: policyPDA, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: instructionData,
    });
  }

  /** Public method — builds an unsigned update_policy VersionedTransaction (single-ix). */
  async buildUpdatePolicyTx(
    pubkey: string,
    dailyMaxLamports: number,
    allowedProtocols: string[],
    isActive: boolean,
  ): Promise<string> {
    const owner = new PublicKey(pubkey);
    const ix = await this.buildUpdatePolicyInstruction(
      owner,
      dailyMaxLamports,
      allowedProtocols,
      isActive,
    );
    return this.solanaService.buildVersionedTransaction(owner, [ix]);
  }
}
