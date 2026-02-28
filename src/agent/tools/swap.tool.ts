import { Injectable } from '@nestjs/common';
import { PublicKey } from '@solana/web3.js';
import type { NexusTool, ToolContext, ToolResult } from './tool.interface';
import { buildTransactionNode, selectRouteNode } from '../graph';
import type { AgentState } from '../state';

const MINT_MAP: Record<string, string> = {
    SOL: 'So11111111111111111111111111111111111111112',
    USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    BONK: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
    JUP: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
    RAY: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
};

@Injectable()
export class SwapTool implements NexusTool {
    readonly name = 'swap';

    readonly description =
        'Swap tokens on Solana using Jupiter DEX aggregator with automatic Raydium CLMM route comparison. Picks the best price automatically.';

    readonly schema = {
        amountLamports: 'Amount of input token in lamports (integer)',
        tokenIn: 'Input token symbol, e.g. SOL, USDC, BONK',
        tokenOut: 'Output token symbol, e.g. USDC, SOL, JUP',
    };

    async execute(
        args: Record<string, unknown>,
        ctx: ToolContext,
    ): Promise<ToolResult> {
        const amountLamports = args.amountLamports as number;
        const tokenIn = (args.tokenIn as string | undefined)?.toUpperCase() ?? 'SOL';
        const tokenOut = (args.tokenOut as string | undefined)?.toUpperCase() ?? 'USDC';

        // Build a minimal state slice to reuse the existing graph nodes
        const swapState: AgentState = {
            intent: '',
            pubkey: ctx.pubkey,
            runId: ctx.runId,
            steps: [],
            action: 'swap',
            protocol: 'jupiter',
            amountLamports,
            tokenIn,
            tokenOut,
        };

        // ── Step 1: Jupiter quote + swap instructions ──────────────────
        const buildResult = await buildTransactionNode(swapState);
        if (buildResult.rejectionReason) {
            return {
                success: false,
                rejectionReason: buildResult.rejectionReason,
                rejectionField: buildResult.rejectionField ?? 'jupiter',
                stepEvent: {
                    node: 'build_transaction',
                    status: 'rejected',
                    label: buildResult.rejectionReason,
                },
            };
        }
        Object.assign(swapState, buildResult);

        // ── Step 2: Route selection — Raydium vs Jupiter ───────────────
        const inputMint = MINT_MAP[tokenIn];
        const outputMint = MINT_MAP[tokenOut];
        let selectedProtocol: string = 'jupiter';

        if (inputMint && outputMint) {
            const routeResult = await selectRouteNode(swapState, ctx.routeSelector);
            Object.assign(swapState, routeResult);
            selectedProtocol = swapState.selectedProtocol ?? 'jupiter';
        }

        // ── Step 3: Assemble with check_and_record ─────────────────────
        const ownerPubkey = new PublicKey(ctx.pubkey);
        let txBase64: string;

        if (selectedProtocol === 'raydium' && swapState.raydiumInstructions) {
            txBase64 = await ctx.txAssembler.assembleFromRaydiumTx({
                userPubkey: ctx.pubkey,
                amountLamports,
                protocol: 'raydium',
                raydiumTxBase64: (swapState.raydiumInstructions as any)[0].transaction,
                addressLookupTables: swapState.addressLookupTables ?? [],
            });
        } else {
            if (!swapState.jupiterInstructions) {
                return {
                    success: false,
                    rejectionReason: 'Missing Jupiter instructions after build step',
                    rejectionField: 'jupiter',
                    stepEvent: {
                        node: 'build_transaction',
                        status: 'rejected',
                        label: 'Missing Jupiter instructions',
                    },
                };
            }
            txBase64 = await ctx.txAssembler.assembleTransaction(
                ownerPubkey,
                amountLamports,
                selectedProtocol,
                swapState.jupiterInstructions as any,
            );
        }

        const sim = swapState.simulationResult ?? { fee: 5000, outAmount: 0, priceImpact: '0.00%' };
        const routeLabel = selectedProtocol === 'raydium'
            ? `Raydium CLMM wins — ${(amountLamports / 1e9).toFixed(4)} ${tokenIn} → ${(sim.outAmount / 1e6).toFixed(4)} ${tokenOut}`
            : `Jupiter route — ${(amountLamports / 1e9).toFixed(4)} ${tokenIn} → ${(sim.outAmount / 1e6).toFixed(4)} ${tokenOut}`;

        return {
            success: true,
            unsignedTxBase64: txBase64,
            simulationResult: { fee: sim.fee, outAmount: sim.outAmount, priceImpact: sim.priceImpact },
            stepEvent: {
                node: 'build_transaction',
                status: 'success',
                label: routeLabel,
                payload: { selectedProtocol, outAmount: sim.outAmount, priceImpact: sim.priceImpact },
            },
        };
    }
}
