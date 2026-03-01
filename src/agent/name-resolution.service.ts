import { Injectable, Logger } from '@nestjs/common';
import { Connection, PublicKey } from '@solana/web3.js';
import { TldParser } from '@onsol/tldparser';
import { SolanaService } from '../solana/solana.service';

export type NameResolutionSource = 'raw_address' | 'sns_domain';

export interface NameResolutionResult {
  input: string;
  address: string;
  source: NameResolutionSource;
}

@Injectable()
export class NameResolutionService {
  private readonly logger = new Logger(NameResolutionService.name);
  private readonly parser: TldParser;
  private readonly fallbackRpcUrl: string;
  private fallbackParser?: TldParser;
  private readonly cache = new Map<string, { address: string; expiresAt: number }>();
  private readonly ttlMs: number;

  constructor(private readonly solanaService: SolanaService) {
    this.parser = new TldParser(this.solanaService.getConnection());
    this.fallbackRpcUrl =
      process.env.NAME_RESOLUTION_MAINNET_RPC_URL ||
      'https://api.mainnet-beta.solana.com';

    const configuredTtlMs = Number(process.env.NAME_RESOLUTION_TTL_MS ?? 120_000);
    this.ttlMs = Number.isFinite(configuredTtlMs) && configuredTtlMs > 0
      ? configuredTtlMs
      : 120_000;
  }

  async resolveNameOrAddress(input: string): Promise<NameResolutionResult> {
    const value = input.trim();
    if (!value) {
      throw new Error('Recipient is empty');
    }

    const directAddress = this.normalizeAddress(value);
    if (directAddress) {
      return {
        input: value,
        address: directAddress,
        source: 'raw_address',
      };
    }

    if (!this.looksLikeDomain(value)) {
      throw new Error(`Invalid recipient: ${value}`);
    }

    const cacheKey = value.toLowerCase();
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return {
        input: value,
        address: cached.address,
        source: 'sns_domain',
      };
    }

    const primaryAddress = await this.tryResolveWithParser(this.parser, cacheKey, value);
    const resolvedAddress =
      primaryAddress ||
      (await this.tryResolveWithParser(this.getFallbackParser(), cacheKey, value));

    if (!resolvedAddress) {
      throw new Error(`Could not resolve ${value}`);
    }

    this.cache.set(cacheKey, {
      address: resolvedAddress,
      expiresAt: Date.now() + this.ttlMs,
    });

    return {
      input: value,
      address: resolvedAddress,
      source: 'sns_domain',
    };
  }

  private getFallbackParser(): TldParser {
    if (!this.fallbackParser) {
      const connection = new Connection(this.fallbackRpcUrl, 'confirmed');
      this.fallbackParser = new TldParser(connection);
    }

    return this.fallbackParser;
  }

  private async tryResolveWithParser(
    parser: TldParser,
    cacheKey: string,
    originalInput: string,
  ): Promise<string | undefined> {
    try {
      const owner = await parser.getOwnerFromDomainTld(cacheKey);
      if (!owner) {
        return undefined;
      }

      if (typeof owner === 'string') {
        return owner;
      }

      return owner.toBase58();
    } catch (error: any) {
      const message = error?.message || 'unknown parser error';
      this.logger.warn(`Name resolution parser error for ${originalInput}: ${message}`);
      return undefined;
    }
  }

  private normalizeAddress(input: string): string | undefined {
    try {
      return new PublicKey(input).toBase58();
    } catch {
      return undefined;
    }
  }

  private looksLikeDomain(input: string): boolean {
    return input.includes('.') && !/\s/.test(input);
  }
}
