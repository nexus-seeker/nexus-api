import { Injectable, Logger } from '@nestjs/common';
import type { KawulaTool, ToolContext, ToolResult } from './tool.interface';
import type { ParsedTransaction } from '../../analysis/helius.service';

type TxLabel = 'income' | 'expense' | 'swap' | 'gas' | 'lp' | 'staking';

interface ClassifiedTx {
  signature: string;
  timestamp: number;
  label: TxLabel;
  amountSol: number;
  description: string;
}

interface PnlSummary {
  incomeSOL: number;
  expenseSOL: number;
  netSOL: number;
  gasFeeSOL: number;
  swapNetSOL: number;
  stakingRewardsSOL: number;
  largestOutflow: { amountSOL: number; description: string } | null;
  windowDays: number;
}

@Injectable()
export class GetPnlTool implements KawulaTool {
  private readonly logger = new Logger(GetPnlTool.name);

  readonly name = 'get_pnl_summary';
  readonly description =
    "Fetch and summarise a wallet's income vs. expense over a given time window (default 30 days). Classifies each transaction as income, expense, swap, gas, LP, or staking. Returns a formatted monthly summary.";
  readonly schema = {
    windowDays: '(Optional) How many days back to look. Default: 30',
    subject:
      "(Optional) Wallet address to analyse. Defaults to the user's own wallet.",
  };

  async execute(
    args: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const windowDays = Math.min(Number(args.windowDays ?? 30), 90);
    const subject = (args.subject as string | undefined) ?? ctx.pubkey;

    if (!ctx.heliusService) {
      return {
        success: false,
        rejectionReason:
          'PnL summary requires HELIUS_API_KEY to be configured.',
        rejectionField: 'helius',
        stepEvent: {
          node: 'tool_executor',
          status: 'rejected',
          label: 'PnL summary: Helius not configured',
        },
      };
    }

    try {
      const cutoff = Math.floor(Date.now() / 1000) - windowDays * 86_400;
      const txs = await ctx.heliusService.getRecentTransactions(subject, 100);
      const recent = txs.filter((t) => t.timestamp >= cutoff);

      const classified = recent.map((tx) => this.classifyTx(tx, subject));
      const summary = this.aggregate(classified, windowDays);
      const message = this.formatMessage(summary, subject);

      return {
        success: true,
        agentMessage: message,
        stepEvent: {
          node: 'tool_executor',
          status: 'success',
          label: `PnL summary: net ${summary.netSOL >= 0 ? '+' : ''}${summary.netSOL.toFixed(3)} SOL over ${windowDays}d`,
          payload: summary as unknown as Record<string, unknown>,
        },
      };
    } catch (err: any) {
      this.logger.error(`get_pnl_summary failed: ${err?.message}`);
      return {
        success: false,
        rejectionReason: `PnL summary failed: ${err?.message}`,
        rejectionField: 'helius',
        stepEvent: {
          node: 'tool_executor',
          status: 'rejected',
          label: `PnL error: ${err?.message}`,
        },
      };
    }
  }

  private classifyTx(
    tx: ParsedTransaction,
    walletPubkey: string,
  ): ClassifiedTx {
    const typeUpper = (tx.type ?? '').toUpperCase();
    const fee = (tx.fee ?? 0) / 1e9; // lamports → SOL

    // Net SOL movement for this wallet from native transfers
    let nativeDelta = 0;
    for (const nt of tx.nativeTransfers ?? []) {
      if (nt.toUserAccount === walletPubkey) nativeDelta += nt.amount / 1e9;
      if (nt.fromUserAccount === walletPubkey) nativeDelta -= nt.amount / 1e9;
    }

    let label: TxLabel = 'expense';
    if (typeUpper.includes('SWAP') || typeUpper.includes('SWAP_EXACT')) {
      label = 'swap';
    } else if (
      typeUpper.includes('STAKE') ||
      typeUpper.includes('STAKING_REWARD')
    ) {
      label = nativeDelta > 0 ? 'staking' : 'expense';
    } else if (
      typeUpper.includes('LP') ||
      typeUpper.includes('LIQUIDITY') ||
      typeUpper.includes('ADD_LIQUIDITY')
    ) {
      label = 'lp';
    } else if (nativeDelta > 0) {
      label = 'income';
    } else if (Math.abs(nativeDelta) < 0.001 && fee > 0) {
      label = 'gas';
    }

    return {
      signature: tx.signature,
      timestamp: tx.timestamp,
      label,
      amountSol: nativeDelta,
      description: tx.description ?? typeUpper,
    };
  }

  private aggregate(txs: ClassifiedTx[], windowDays: number): PnlSummary {
    let incomeSOL = 0;
    let expenseSOL = 0;
    let gasFeeSOL = 0;
    let swapNetSOL = 0;
    let stakingRewardsSOL = 0;
    let largestOutflow: { amountSOL: number; description: string } | null =
      null;

    for (const tx of txs) {
      switch (tx.label) {
        case 'income':
          incomeSOL += tx.amountSol;
          break;
        case 'expense':
          expenseSOL += Math.abs(tx.amountSol);
          if (
            !largestOutflow ||
            Math.abs(tx.amountSol) > largestOutflow.amountSOL
          ) {
            largestOutflow = {
              amountSOL: Math.abs(tx.amountSol),
              description: tx.description,
            };
          }
          break;
        case 'gas':
          gasFeeSOL += Math.abs(tx.amountSol);
          break;
        case 'swap':
          swapNetSOL += tx.amountSol;
          break;
        case 'staking':
          stakingRewardsSOL += tx.amountSol;
          break;
        case 'lp':
          expenseSOL += Math.abs(tx.amountSol);
          break;
      }
    }

    const totalExpense =
      expenseSOL + gasFeeSOL + Math.abs(Math.min(swapNetSOL, 0));
    const totalIncome = incomeSOL + stakingRewardsSOL + Math.max(swapNetSOL, 0);
    const netSOL = totalIncome - totalExpense;

    return {
      incomeSOL: Math.round(totalIncome * 1000) / 1000,
      expenseSOL: Math.round(totalExpense * 1000) / 1000,
      netSOL: Math.round(netSOL * 1000) / 1000,
      gasFeeSOL: Math.round(gasFeeSOL * 1000) / 1000,
      swapNetSOL: Math.round(swapNetSOL * 1000) / 1000,
      stakingRewardsSOL: Math.round(stakingRewardsSOL * 1000) / 1000,
      largestOutflow,
      windowDays,
    };
  }

  private formatMessage(s: PnlSummary, subject: string): string {
    const short =
      subject.length > 8
        ? `${subject.slice(0, 4)}...${subject.slice(-4)}`
        : subject;
    const sign = s.netSOL >= 0 ? '+' : '';
    const lines: string[] = [
      `**${s.windowDays}-day summary for ${short}**\n`,
      `**↑ Income: +${s.incomeSOL} SOL**`,
      s.stakingRewardsSOL > 0
        ? `  • Staking rewards: ${s.stakingRewardsSOL} SOL`
        : null,
      `  • Other inflows: ${Math.max(0, s.incomeSOL - s.stakingRewardsSOL).toFixed(3)} SOL`,
      '',
      `**↓ Expenses: −${s.expenseSOL} SOL**`,
      s.swapNetSOL < 0
        ? `  • Swaps (net): ${s.swapNetSOL.toFixed(3)} SOL`
        : null,
      `  • Gas fees: −${s.gasFeeSOL} SOL`,
      '',
      `**Net: ${sign}${s.netSOL} SOL ${s.netSOL >= 0 ? '↑' : '↓'}**`,
    ].filter((l): l is string => l !== null);

    if (s.largestOutflow) {
      lines.push(
        `\nYour largest outflow was **${s.largestOutflow.amountSOL.toFixed(3)} SOL** — ${s.largestOutflow.description}. Want me to break down any category?`,
      );
    }

    return lines.join('\n');
  }
}
