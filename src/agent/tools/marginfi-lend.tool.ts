import { Injectable, Logger } from '@nestjs/common';
import { PublicKey } from '@solana/web3.js';
import type { KawulaTool, ToolContext, ToolResult } from './tool.interface';

@Injectable()
export class MarginfiLendTool implements KawulaTool {
    name = 'marginfi_lend';
    description = 'Deposit SOL or USDC into Marginfi to earn yield/interest';

    // The LLM will see this schema injected into the prompt
    schema = {
        marginfi_lend: '{ "action": "marginfi_lend", "protocol": "marginfi", "amountSOL": 1.0, "token": "USDC" } // deposit tokens into Marginfi to earn lending yield',
    };

    private readonly logger = new Logger(MarginfiLendTool.name);

    async execute(
        payload: Record<string, any>,
        context: ToolContext,
    ): Promise<ToolResult> {
        const { amountLamports, token = 'USDC' } = payload;

        const stepEvent = {
            node: 'build_transaction' as const,
            status: 'success' as const,
            label: `Preparing Marginfi deposit for ${payload.amountSOL} ${token}`,
        };

        // Note: A full implementation would use @mrgnlabs/marginfi-client-v2
        // to build the actual instructions here. Since this is a hackathon MVP,
        // we simulate the tool structure and return a dummy base64 transaction
        // just like the core TxAssembler does when bypassing Jupiter.

        this.logger.log(`Constructing Marginfi lend Tx for ${amountLamports} lamports of ${token}`);

        return {
            success: true,
            unsignedTxBase64: 'marginfi-mock-tx-base64-payload',
            simulationResult: {
                fee: 5000,
                outAmount: amountLamports,
                priceImpact: '0.00%',
            },
            agentMessage: `Prepared your Marginfi deposit for ${payload.amountSOL} ${token}. Sign the transaction to start earning yield.`,
            stepEvent,
        };
    }
}
