import { Injectable } from '@nestjs/common';
import type { KawulaTool, ToolContext, ToolResult } from './tool.interface';

@Injectable()
export class TokenInfoTool implements KawulaTool {
    readonly name = 'analyze_token';

    readonly description =
        'Fetch live token price, volume, and holder data from Birdeye. Synthesise into a human-readable summary.';

    readonly schema = {
        subject: 'Token symbol (e.g. SOL, BONK, JUP) or mint address',
    };

    async execute(
        args: Record<string, unknown>,
        ctx: ToolContext,
    ): Promise<ToolResult> {
        const subject = args.subject as string;
        let contextData = '';

        if (ctx.birdeyeService) {
            try {
                const info = await ctx.birdeyeService.getTokenInfo(subject);
                contextData = JSON.stringify(info, null, 2);
            } catch (e: any) {
                contextData = `(Could not fetch token data: ${e?.message})`;
            }
        } else {
            contextData = '(Birdeye data source not configured — set BIRDEYE_API_KEY to enable live data)';
        }

        const response = await ctx.llm.invoke([
            {
                role: 'system',
                content:
                    `You are a Solana blockchain analyst. Give a clear summary of the token "${subject}" ` +
                    `using the data below. Include price, 24h volume, and any notable concentration. ` +
                    `Be concise and highlight key risks if present.\n\nData:\n${contextData}`,
            },
            {
                role: 'user',
                content: `Give me a summary of the token ${subject} — price, volume, and any notable holder concentration.`,
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
                label: `Token analysis complete ✓`,
                payload: { subject },
            },
        };
    }
}
