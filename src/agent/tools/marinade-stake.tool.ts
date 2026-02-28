import { Injectable } from '@nestjs/common';
import type { NexusTool, ToolContext, ToolResult } from './tool.interface';

@Injectable()
export class MarinadeStakeTool implements NexusTool {
    readonly name = 'stake';

    readonly description =
        'Liquid-stake SOL into mSOL via Marinade Finance. Keeps liquidity while earning staking rewards.';

    readonly schema = {
        amountLamports: 'Amount of SOL to stake in lamports (integer)',
    };

    async execute(
        args: Record<string, unknown>,
        ctx: ToolContext,
    ): Promise<ToolResult> {
        if (!ctx.marinadeService) {
            return {
                success: false,
                rejectionReason: 'MarinadeService not available — check MARINADE_API_URL env',
                rejectionField: 'marinade',
                stepEvent: {
                    node: 'build_transaction',
                    status: 'rejected',
                    label: 'Marinade staking is not configured',
                },
            };
        }

        const amountLamports = args.amountLamports as number;

        const { txBase64: marinadeRawTx } = await ctx.marinadeService.buildStakeTx(
            ctx.pubkey,
            amountLamports,
        );

        // Reuse the Raydium assembler pattern — wrap external tx + prepend check_and_record
        const txBase64 = await ctx.txAssembler.assembleFromRaydiumTx({
            userPubkey: ctx.pubkey,
            amountLamports,
            protocol: 'marinade',
            raydiumTxBase64: marinadeRawTx,
            addressLookupTables: [],
        });

        const solAmount = (amountLamports / 1e9).toFixed(4);

        return {
            success: true,
            unsignedTxBase64: txBase64,
            simulationResult: { fee: 5000, outAmount: amountLamports, priceImpact: '0.00%' },
            stepEvent: {
                node: 'build_transaction',
                status: 'success',
                label: `Marinade stake prepared: ${solAmount} SOL → mSOL`,
                payload: { amountLamports, protocol: 'marinade' },
            },
        };
    }
}
