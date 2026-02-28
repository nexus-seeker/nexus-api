import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';

// ─── Raydium Trade API response shapes ───────────────────────────────────────

interface RaydiumQuoteResponse {
  id: string;
  success: boolean;
  data: {
    swapType: string;
    inputMint: string;
    inputAmount: string;
    outputMint: string;
    outputAmount: string; // ← raw units, use this for comparison
    otherAmountThreshold: string;
    slippageBps: number;
    priceImpactPct: number;
    routePlan: Array<{
      poolId: string;
      inputMint: string;
      outputMint: string;
      feeMint: string;
      feeRate: number;
      feeAmount: string;
    }>;
  };
}

interface RaydiumSwapTxResponse {
  id: string;
  success: boolean;
  data: Array<{
    transaction: string; // base64 VersionedTransaction
  }>;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class RaydiumService {
  private readonly logger = new Logger(RaydiumService.name);
  private readonly http: AxiosInstance;
  private readonly swapHost: string;

  constructor() {
    this.swapHost =
      process.env.RAYDIUM_SWAP_HOST ?? 'https://transaction-v1.raydium.io';

    this.http = axios.create({
      timeout: Number(process.env.ROUTE_SELECTOR_TIMEOUT_MS ?? 3000),
    });
  }

  /**
   * Get a quote from Raydium for an exact-input swap.
   * Returns null if the quote fails (no pool, timeout, etc.) so the caller
   * can fall back to Jupiter gracefully.
   */
  async getQuote(params: {
    inputMint: string;
    outputMint: string;
    amountLamports: number;
    slippageBps?: number;
  }): Promise<RaydiumQuoteResponse | null> {
    const { inputMint, outputMint, amountLamports, slippageBps = 50 } = params;

    try {
      const { data } = await this.http.get<RaydiumQuoteResponse>(
        `${this.swapHost}/compute/swap-base-in`,
        {
          params: {
            inputMint,
            outputMint,
            amount: amountLamports,
            slippageBps,
            txVersion: 'V0',
          },
        },
      );

      if (!data.success) {
        this.logger.warn(
          `Raydium quote returned success=false for ${inputMint}→${outputMint}`,
        );
        return null;
      }

      return data;
    } catch (err) {
      // Log but do not throw — caller will fall back to Jupiter
      this.logger.warn(`Raydium quote failed: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Get swap instructions from Raydium given a prior quote response.
   * Returns an array of base64 VersionedTransaction strings.
   * The TxAssembler will deserialize, extract instructions, and prepend checkIx.
   */
  async getSwapInstructions(params: {
    quoteResponse: RaydiumQuoteResponse;
    userPublicKey: string;
    prioritizationFeeLamports?: string | number;
    wrapSol?: boolean;
    unwrapSol?: boolean;
  }): Promise<RaydiumSwapTxResponse['data'] | null> {
    const {
      quoteResponse,
      userPublicKey,
      prioritizationFeeLamports = 'auto',
      wrapSol = true,
      unwrapSol = true,
    } = params;

    try {
      const { data } = await this.http.post<RaydiumSwapTxResponse>(
        `${this.swapHost}/transaction/swap-base-in`,
        {
          computeUnitPriceMicroLamports: prioritizationFeeLamports,
          swapResponse: quoteResponse,
          txVersion: 'V0',
          wallet: userPublicKey,
          wrapSol,
          unwrapSol,
        },
      );

      if (!data.success || !data.data?.length) {
        this.logger.warn(
          'Raydium swap instructions returned empty or failed response',
        );
        return null;
      }

      return data.data;
    } catch (err) {
      this.logger.warn(
        `Raydium swap instructions failed: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Helper: extract the outputAmount as a number from a quote response.
   */
  extractOutputAmount(quote: RaydiumQuoteResponse): number {
    return Number(quote.data.outputAmount);
  }

  /**
   * Helper: extract priceImpactPct as a formatted string.
   */
  extractPriceImpact(quote: RaydiumQuoteResponse): string {
    return `${quote.data.priceImpactPct.toFixed(4)}%`;
  }
}
