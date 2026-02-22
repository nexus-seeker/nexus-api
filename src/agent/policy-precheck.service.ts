import { Injectable } from '@nestjs/common';
import { PublicKey } from '@solana/web3.js';
import { SolanaService } from '../solana/solana.service';

const DAILY_WINDOW_SECONDS = 86_400;

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
    const owner = new PublicKey(pubkey);
    const vault = await this.solanaService.fetchPolicyVault(owner);

    if (!vault) {
      return {
        allowed: false,
        rejectionField: 'policy_missing',
        reason: 'Policy not initialized. Initialize policy vault first.',
        amountLamports,
        protocol,
        effectiveSpendLamports: 0,
        projectedSpendLamports: amountLamports,
      };
    }

    const nowTs = input.nowTs ?? Math.floor(Date.now() / 1000);
    const lastResetTs = Number(vault.lastResetTs || 0);
    const currentSpend = Number(vault.currentSpend || 0);
    const dailyMaxLamports = Number(vault.dailyMaxLamports || 0);
    const allowedProtocols = Array.isArray(vault.allowedProtocols)
      ? vault.allowedProtocols
      : [];

    const effectiveSpendLamports =
      nowTs - lastResetTs > DAILY_WINDOW_SECONDS ? 0 : currentSpend;
    const projectedSpendLamports = effectiveSpendLamports + amountLamports;

    const base: PolicyPrecheckResult = {
      allowed: true,
      reason: 'Policy precheck passed.',
      amountLamports,
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
        rejectionField: 'policy_active',
        reason: 'Policy is inactive. Activate your policy to continue.',
      };
    }

    if (!allowedProtocols.includes(protocol)) {
      return {
        ...base,
        allowed: false,
        rejectionField: 'allowed_protocols',
        reason: `Protocol "${protocol}" is not allowed by your policy.`,
      };
    }

    if (projectedSpendLamports > dailyMaxLamports) {
      return {
        ...base,
        allowed: false,
        rejectionField: 'daily_max_lamports',
        reason: 'Daily spending limit exceeded for this policy window.',
      };
    }

    return base;
  }
}
