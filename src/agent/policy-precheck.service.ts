import { Injectable } from '@nestjs/common';
import { PublicKey } from '@solana/web3.js';
import { SolanaService } from '../solana/solana.service';

const DAILY_WINDOW_SECONDS = 86_400;
const LAMPORTS_PER_SOL = 1_000_000_000;

function normalizeNonNegativeFinite(value: unknown): number {
  const normalized = Number(value ?? 0);
  if (!Number.isFinite(normalized)) {
    return 0;
  }

  return Math.max(0, normalized);
}

function formatLamportsAsSol(lamports: number): string {
  const sol = lamports / LAMPORTS_PER_SOL;
  return sol
    .toFixed(9)
    .replace(/\.0+$/, '')
    .replace(/(\.\d*?)0+$/, '$1');
}

export interface PolicyPrecheckInput {
  pubkey: string;
  amountLamports: number;
  protocol: string;
  nowTs?: number;
}

export interface PolicyPrecheckResult {
  allowed: boolean;
  reason: string;
  rejectionField?: string;
  amountLamports: number;
  protocol: string;
  effectiveSpendLamports: number;
  projectedSpendLamports: number;
  dailyMaxLamports?: number;
  allowedProtocols?: string[];
  lastResetTs?: number;
}

@Injectable()
export class PolicyPrecheckService {
  constructor(private readonly solanaService: SolanaService) {}

  async precheck(input: PolicyPrecheckInput): Promise<PolicyPrecheckResult> {
    const { pubkey, amountLamports, protocol } = input;
    const numericAmountLamports = Number(amountLamports);
    const isAmountLamportsValid =
      Number.isFinite(numericAmountLamports) &&
      Number.isInteger(numericAmountLamports) &&
      numericAmountLamports > 0;

    if (!isAmountLamportsValid) {
      return {
        allowed: false,
        reason: 'Invalid amountLamports: must be a finite positive integer.',
        rejectionField: 'amount_lamports',
        amountLamports: 0,
        protocol,
        effectiveSpendLamports: 0,
        projectedSpendLamports: 0,
      };
    }

    let owner: PublicKey;
    try {
      owner = new PublicKey(pubkey);
    } catch {
      return {
        allowed: false,
        reason: 'Invalid pubkey: must be a valid Solana public key.',
        rejectionField: 'pubkey',
        amountLamports: numericAmountLamports,
        protocol,
        effectiveSpendLamports: 0,
        projectedSpendLamports: numericAmountLamports,
      };
    }

    const vault = await this.solanaService.fetchPolicyVault(owner);

    if (!vault) {
      return {
        allowed: false,
        reason:
          'Wallet not onboarded. Call POST /policy/onboard to initialize your profile and policy.',
        rejectionField: 'not_onboarded',
        amountLamports: numericAmountLamports,
        protocol,
        effectiveSpendLamports: 0,
        projectedSpendLamports: numericAmountLamports,
      };
    }

    const nowTs = input.nowTs ?? Math.floor(Date.now() / 1000);
    const lastResetTs = normalizeNonNegativeFinite(vault.lastResetTs);
    const currentSpend = normalizeNonNegativeFinite(vault.currentSpend);
    const dailyMaxLamports = normalizeNonNegativeFinite(vault.dailyMaxLamports);
    const allowedProtocols = Array.isArray(vault.allowedProtocols)
      ? vault.allowedProtocols
      : [];

    const effectiveSpendLamports =
      nowTs - lastResetTs > DAILY_WINDOW_SECONDS ? 0 : currentSpend;
    const projectedSpendLamports =
      effectiveSpendLamports + numericAmountLamports;

    const base: PolicyPrecheckResult = {
      allowed: true,
      reason: 'Policy precheck passed.',
      amountLamports: numericAmountLamports,
      protocol,
      effectiveSpendLamports,
      projectedSpendLamports,
      dailyMaxLamports,
      allowedProtocols,
      lastResetTs,
    };

    if (!vault.isActive) {
      return {
        ...base,
        allowed: false,
        rejectionField: 'policy_inactive',
        reason: 'Policy is inactive. Activate your policy to continue.',
      };
    }

    if (!allowedProtocols.includes(protocol)) {
      return {
        ...base,
        allowed: false,
        rejectionField: 'protocol_not_allowed',
        reason: `Protocol "${protocol}" is not allowed by your policy.`,
      };
    }

    if (projectedSpendLamports > dailyMaxLamports) {
      const remainingLamports = Math.max(
        0,
        dailyMaxLamports - effectiveSpendLamports,
      );
      return {
        ...base,
        allowed: false,
        rejectionField: 'daily_max',
        reason: `Daily max exceeded: requested ${formatLamportsAsSol(numericAmountLamports)} SOL, cap ${formatLamportsAsSol(dailyMaxLamports)} SOL, remaining ${formatLamportsAsSol(remainingLamports)} SOL.`,
      };
    }

    return base;
  }
}
