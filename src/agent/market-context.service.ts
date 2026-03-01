import { Injectable, Logger } from '@nestjs/common';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const CACHE_TTL_MS = 30_000; // 30-second in-memory cache

export interface MarketContext {
    solPrice: number;        // USD
    solChange24h: number;    // percent, e.g. +6.2
    networkCongestion: 'low' | 'medium' | 'high';
    avgTxFeeSOL: number;
}

@Injectable()
export class MarketContextService {
    private readonly logger = new Logger(MarketContextService.name);

    private cachedContext: MarketContext | null = null;
    private cacheExpiresAt = 0;

    /**
     * Returns the current market context.
     * Results are cached for 30 seconds to avoid hammering price APIs on every message.
     */
    async getContext(): Promise<MarketContext> {
        const now = Date.now();
        if (this.cachedContext && now < this.cacheExpiresAt) {
            return this.cachedContext;
        }

        const ctx = await this.fetchFresh();
        this.cachedContext = ctx;
        this.cacheExpiresAt = now + CACHE_TTL_MS;
        return ctx;
    }

    private async fetchFresh(): Promise<MarketContext> {
        try {
            // Jupiter Price API v2 — no auth required
            const url = `https://api.jup.ag/price/v2?ids=${SOL_MINT}&showExtraInfo=true`;
            const response = await fetch(url, {
                signal: AbortSignal.timeout(4000),
            });

            if (!response.ok) {
                throw new Error(`Jupiter price API ${response.status}`);
            }

            const json = await response.json();
            const data = json?.data?.[SOL_MINT];

            const solPrice = Number(data?.price ?? 0);
            // Jupiter v2 extra info may include 24h price history
            const price24hAgo = Number(data?.extraInfo?.quotedAt ?? 0) || solPrice;
            const solChange24h =
                price24hAgo > 0 ? ((solPrice - price24hAgo) / price24hAgo) * 100 : 0;

            return {
                solPrice: Math.round(solPrice * 100) / 100,
                solChange24h: Math.round(solChange24h * 10) / 10,
                networkCongestion: 'low',   // Helius RPC health could improve this
                avgTxFeeSOL: 0.000005,      // Typical priority fee on Solana
            };
        } catch (err: any) {
            this.logger.warn(`Market context fetch failed: ${err?.message} — using defaults`);
            return {
                solPrice: 0,
                solChange24h: 0,
                networkCongestion: 'low',
                avgTxFeeSOL: 0.000005,
            };
        }
    }

    /**
     * Formats the context into a short plain-English string for LLM injection.
     */
    formatForLlm(ctx: MarketContext): string {
        if (ctx.solPrice === 0) return '';
        const sign = ctx.solChange24h >= 0 ? '+' : '';
        return (
            `Market: SOL $${ctx.solPrice} (${sign}${ctx.solChange24h}% 24h), ` +
            `network ${ctx.networkCongestion}, avg fee ${ctx.avgTxFeeSOL} SOL.`
        );
    }
}
