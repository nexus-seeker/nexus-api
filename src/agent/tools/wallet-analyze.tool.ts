import { Injectable } from '@nestjs/common';
import type { NexusTool, ToolContext, ToolResult } from './tool.interface';

@Injectable()
export class WalletAnalyzeTool implements NexusTool {
    readonly name = 'analyze_wallet';

    readonly description =
        'Analyse a Solana wallet — recent transaction history, token balances, and spending patterns. Uses Helius live data and LLM synthesis.';

    readonly schema = {
        subject: 'Solana wallet public key to analyse (base58)',
    };

    async execute(
        args: Record<string, unknown>,
        ctx: ToolContext,
    ): Promise<ToolResult> {
        const subject = (args.subject as string | undefined) ?? ctx.pubkey;

        let contextData = '';

        if (ctx.heliusService) {
            try {
                const [txs, balances] = await Promise.all([
                    ctx.heliusService.getRecentTransactions(subject, 20),
                    ctx.heliusService.getTokenBalances(subject),
                ]);
                contextData =
                    `Recent transactions (last 20):\n${JSON.stringify(txs, null, 2)}\n\n` +
                    `Token balances:\n${JSON.stringify(balances, null, 2)}`;
            } catch (e: any) {
                contextData = `(Could not fetch live data: ${e?.message})`;
            }
        } else {
            contextData = '(Helius data source not configured — set HELIUS_API_KEY to enable live data)';
        }

        const response = await ctx.llm.invoke([
            {
                role: 'system',
                content:
                    `You are a Solana blockchain analyst. Summarise the wallet "${subject}" ` +
                    `using the data below. Be concise, friendly, and highlight key insights. ` +
                    `If data is missing, acknowledge it honestly.\n\nData:\n${contextData}`,
            },
            {
                role: 'user',
                content: `Summarise the wallet activity and balances for ${subject}.`,
            },
        ]);

        const message =
            typeof response.content === 'string'
                ? response.content
                : JSON.stringify(response.content);

        return {
            success: true,
            agentMessage: message,
            stepEvent: {
                node: 'analyze',
                status: 'success',
                label: `Wallet analysis complete ✓`,
                payload: { subject },
            },
        };
    }
}
