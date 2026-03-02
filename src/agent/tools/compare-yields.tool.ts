import { Injectable, Logger } from '@nestjs/common';
import type { KawulaTool, ToolContext, ToolResult } from './tool.interface';

interface YieldPool {
    protocol: string;
    apy: number;
    tvlUsd: number;
    chain: string;
    symbol: string;
}

interface RankedYield {
    rank: number;
    protocol: string;
    apy: string;
    tvlUsd: string;
    safetyTier: 'high' | 'medium' | 'low';
}

const DEFI_LLAMA_BASE = 'https://yields.llama.fi';

// Protocols considered high-safety on Solana
const HIGH_SAFETY_PROTOCOLS = new Set([
    'marinade', 'jito', 'solend', 'marginfi', 'kamino', 'drift', 'orca', 'raydium',
]);
const MEDIUM_SAFETY_PROTOCOLS = new Set([
    'tulip', 'francium', 'lifinity', 'saber', 'mercurial',
]);

@Injectable()
export class CompareYieldsTool implements KawulaTool {
    private readonly logger = new Logger(CompareYieldsTool.name);

    readonly name = 'compare_yields';
    readonly description =
        'Compare current APY for a given token across all Solana DeFi protocols, ranked by safety and yield. Useful for "where should I stake my SOL?" questions.';
    readonly schema = {
        token: 'Token symbol to find yields for, e.g. "SOL", "USDC", "SOL/USDC"',
        limit: '(Optional) Max number of results to return, default 5',
    };

    async execute(
        args: Record<string, unknown>,
        ctx: ToolContext,
    ): Promise<ToolResult> {
        const token = ((args.token as string | undefined) ?? 'SOL').toUpperCase();
        const limit = Math.min(Number(args.limit ?? 5), 10);

        try {
            const ranked = await this.fetchRankedYields(token, limit);

            if (ranked.length === 0) {
                const msg = `Couldn't find any active yield pools for ${token} on Solana right now. Try a different token or check back later.`;
                return {
                    success: true,
                    agentMessage: msg,
                    stepEvent: {
                        node: 'tool_executor',
                        status: 'success',
                        label: `No ${token} yield pools found`,
                    },
                };
            }

            // Build a formatted response
            const rows = ranked
                .map(
                    (r, i) =>
                        `**${i + 1}. ${r.protocol}** — ${r.apy} APY · TVL ${r.tvlUsd} · Safety: ${r.safetyTier}`,
                )
                .join('\n');

            const message = `**Best yields for ${token} on Solana:**\n\n${rows}\n\n_Data from DeFiLlama. APY changes frequently — always check the protocol's UI before depositing._`;

            const top = ranked[0];
            const stepLabel = `Top yield: ${top.protocol} at ${top.apy} (${top.safetyTier} safety)`;

            return {
                success: true,
                agentMessage: message,
                stepEvent: {
                    node: 'tool_executor',
                    status: 'success',
                    label: stepLabel,
                    payload: ranked as unknown as Record<string, unknown>,
                },
            };
        } catch (err: any) {
            this.logger.error(`compare_yields failed: ${err?.message}`);
            return {
                success: false,
                rejectionReason: `Yield comparison failed: ${err?.message}`,
                rejectionField: 'defi_llama',
                stepEvent: {
                    node: 'tool_executor',
                    status: 'rejected',
                    label: `Yield comparison error: ${err?.message}`,
                },
            };
        }
    }

    private async fetchRankedYields(token: string, limit: number): Promise<RankedYield[]> {
        const url = `${DEFI_LLAMA_BASE}/pools`;
        const response = await fetch(url, { signal: AbortSignal.timeout(6000) });

        if (!response.ok) {
            throw new Error(`DeFiLlama pools API returned ${response.status}`);
        }

        const json = await response.json();
        const pools: YieldPool[] = (json?.data ?? []) as YieldPool[];

        const matching = pools.filter(
            (p) =>
                p.chain?.toLowerCase() === 'solana' &&
                p.symbol?.toUpperCase().includes(token) &&
                typeof p.apy === 'number' &&
                p.apy > 0,
        );

        // Sort by safety-adjusted yield:
        // high-safety protocols get a 10% bonus, medium get 0, unknown get -10%
        const scored = matching.map((p) => {
            const protocolLower = p.protocol?.toLowerCase() ?? '';
            const bonus = HIGH_SAFETY_PROTOCOLS.has(protocolLower)
                ? 1.1
                : MEDIUM_SAFETY_PROTOCOLS.has(protocolLower)
                    ? 1.0
                    : 0.9;
            return { pool: p, score: p.apy * bonus };
        });

        scored.sort((a, b) => b.score - a.score);

        return scored.slice(0, limit).map((s, i) => {
            const p = s.pool;
            const protocolLower = p.protocol?.toLowerCase() ?? '';
            const safetyTier: 'high' | 'medium' | 'low' = HIGH_SAFETY_PROTOCOLS.has(protocolLower)
                ? 'high'
                : MEDIUM_SAFETY_PROTOCOLS.has(protocolLower)
                    ? 'medium'
                    : 'low';

            return {
                rank: i + 1,
                protocol: p.protocol ?? 'Unknown',
                apy: `${p.apy.toFixed(1)}%`,
                tvlUsd: p.tvlUsd >= 1_000_000
                    ? `$${(p.tvlUsd / 1_000_000).toFixed(1)}M`
                    : `$${Math.round(p.tvlUsd / 1000)}K`,
                safetyTier,
            };
        });
    }
}
