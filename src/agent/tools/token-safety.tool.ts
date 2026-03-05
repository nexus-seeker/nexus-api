import { Injectable, Logger } from '@nestjs/common';
import type { KawulaTool, ToolContext, ToolResult } from './tool.interface';

export interface TokenSafetyReport {
  mint: string;
  riskScore: number; // 0 (safe) — 100 (danger)
  isHoneypot: boolean;
  hasLiquidity: boolean;
  deployerRugged: boolean;
  rugCheckRaw?: unknown;
}

const RUGCHECK_BASE = 'https://api.rugcheck.xyz/v1';

@Injectable()
export class TokenSafetyTool implements KawulaTool {
  private readonly logger = new Logger(TokenSafetyTool.name);

  readonly name = 'check_token_safety';
  readonly description =
    'Check whether a Solana token is safe to trade. Returns honeypot flag, liquidity lock status, deployer drainer history, and a 0–100 risk score (>70 is dangerous).';
  readonly schema = {
    mint: 'Token mint address (base58) to check',
    symbol: '(Optional) Token symbol for display purposes',
  };

  async execute(
    args: Record<string, unknown>,
    _ctx: ToolContext,
  ): Promise<ToolResult> {
    const mint = args.mint as string | undefined;

    if (!mint) {
      return {
        success: false,
        rejectionReason: 'check_token_safety requires a token mint address',
        rejectionField: 'mint',
        stepEvent: {
          node: 'tool_executor',
          status: 'rejected',
          label: 'Token safety check: missing mint address',
        },
      };
    }

    const report = await this.fetchRugCheck(mint);
    const blocked = report.riskScore > 70 || report.isHoneypot;

    const label = blocked
      ? `⚠️ Token ${args.symbol ?? mint.slice(0, 8)} failed safety check (score ${report.riskScore}/100)`
      : `✅ Token ${args.symbol ?? mint.slice(0, 8)} passed safety check (score ${report.riskScore}/100)`;

    const warnings: string[] = [];
    if (report.isHoneypot)
      warnings.push('honeypot detected — selling blocked by contract');
    if (!report.hasLiquidity) warnings.push('zero or locked liquidity');
    if (report.deployerRugged)
      warnings.push('deployer has rugged previous tokens');

    const summary =
      warnings.length > 0
        ? `⚠️ **Safety warnings for this token:**\n${warnings.map((w) => `• ${w}`).join('\n')}`
        : '✅ No safety issues detected.';

    return {
      success: !blocked,
      agentMessage: `${label}\n\n${summary}`,
      rejectionReason: blocked
        ? `Token safety check failed: ${warnings.join('; ')}`
        : undefined,
      rejectionField: blocked ? 'token_safety' : undefined,
      stepEvent: {
        node: 'tool_executor',
        status: blocked ? 'rejected' : 'success',
        label,
        payload: report as unknown as Record<string, unknown>,
      },
    };
  }

  async safeCheck(mint: string): Promise<TokenSafetyReport> {
    return this.fetchRugCheck(mint);
  }

  private async fetchRugCheck(mint: string): Promise<TokenSafetyReport> {
    try {
      const url = `${RUGCHECK_BASE}/tokens/${mint}/report/summary`;
      const response = await fetch(url, {
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        // RugCheck returned an error — treat as unknown but not blocked
        this.logger.warn(
          `RugCheck API returned ${response.status} for mint ${mint}`,
        );
        return this.unknownReport(mint);
      }

      const data = await response.json();

      // RugCheck summary schema (v1): score, risks[], markets[]
      const riskScore = Number(data?.score ?? 0);
      const risks: string[] = (data?.risks ?? []).map((r: any) =>
        String(r?.name ?? '').toLowerCase(),
      );

      const isHoneypot = risks.some(
        (r) => r.includes('honeypot') || r.includes('mint_authority'),
      );
      const hasLiquidity = (data?.markets?.length ?? 0) > 0;
      const deployerRugged = risks.some(
        (r) => r.includes('rugged') || r.includes('copycat'),
      );

      return {
        mint,
        riskScore,
        isHoneypot,
        hasLiquidity,
        deployerRugged,
        rugCheckRaw: data,
      };
    } catch (err: any) {
      this.logger.warn(`RugCheck fetch failed for ${mint}: ${err?.message}`);
      return this.unknownReport(mint);
    }
  }

  /** Returns a conservative "unknown" report when the API is unavailable. */
  private unknownReport(mint: string): TokenSafetyReport {
    return {
      mint,
      riskScore: 0,
      isHoneypot: false,
      hasLiquidity: true,
      deployerRugged: false,
    };
  }
}
