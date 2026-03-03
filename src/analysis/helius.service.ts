import { Injectable, Logger } from '@nestjs/common';

export interface ParsedTransaction {
  signature: string;
  timestamp: number;
  type: string;
  description: string;
  fee: number;
  nativeTransfers?: Array<{
    fromUserAccount: string;
    toUserAccount: string;
    amount: number;
  }>;
  tokenTransfers?: Array<{
    fromUserAccount: string;
    toUserAccount: string;
    mint: string;
    tokenAmount: number;
  }>;
}

export interface TokenBalance {
  mint: string;
  amount: number;
  decimals: number;
  uiAmount: number;
  symbol?: string;
  name?: string;
}

@Injectable()
export class HeliusService {
  private readonly logger = new Logger(HeliusService.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor() {
    this.apiKey = process.env.HELIUS_API_KEY || '';
    this.baseUrl = this.resolveBaseUrl();
    if (!this.apiKey) {
      this.logger.warn(
        'HELIUS_API_KEY not set — wallet analysis will return partial data',
      );
    }
  }

  private resolveBaseUrl(): string {
    const cluster = (process.env.HELIUS_CLUSTER || '').trim().toLowerCase();
    if (cluster === 'devnet') {
      return 'https://api-devnet.helius.xyz/v0';
    }
    if (cluster === 'mainnet' || cluster === 'mainnet-beta') {
      return 'https://api.helius.xyz/v0';
    }

    const rpcUrl = (process.env.SOLANA_RPC_URL || '').toLowerCase();
    if (rpcUrl.includes('devnet')) {
      return 'https://api-devnet.helius.xyz/v0';
    }

    return 'https://api.helius.xyz/v0';
  }

  /**
   * Fetches the N most recent parsed transactions for a wallet.
   */
  async getRecentTransactions(
    walletPubkey: string,
    limit = 20,
  ): Promise<ParsedTransaction[]> {
    if (!this.apiKey) {
      throw new Error('HELIUS_API_KEY is not configured');
    }

    const url =
      `${this.baseUrl}/addresses/${walletPubkey}/transactions` +
      `?api-key=${this.apiKey}&limit=${limit}&type=ANY`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `Helius transactions API error: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as ParsedTransaction[];
    this.logger.debug(
      `Fetched ${data.length} transactions for ${walletPubkey}`,
    );
    return data;
  }

  /**
   * Fetches token balances for a wallet, including native SOL.
   */
  async getTokenBalances(walletPubkey: string): Promise<{
    nativeBalance: number;
    tokens: TokenBalance[];
  }> {
    if (!this.apiKey) {
      throw new Error('HELIUS_API_KEY is not configured');
    }

    const url =
      `${this.baseUrl}/addresses/${walletPubkey}/balances` +
      `?api-key=${this.apiKey}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `Helius balances API error: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as {
      nativeBalance: number;
      tokens: TokenBalance[];
    };
    return data;
  }

  /**
   * Estimates total fees paid by a wallet across recent transactions.
   */
  async estimateFeesLast30Days(walletPubkey: string): Promise<number> {
    const txs = await this.getRecentTransactions(walletPubkey, 100);
    const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 86_400 * 30;
    const recent = txs.filter((t) => t.timestamp >= thirtyDaysAgo);
    return recent.reduce((acc, t) => acc + (t.fee ?? 0), 0);
  }
}
