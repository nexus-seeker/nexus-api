import { Injectable } from '@nestjs/common';
import { PublicKey } from '@solana/web3.js';
import type { KawulaTool, ToolContext, ToolResult } from './tool.interface';

@Injectable()
export class SplTransferTool implements KawulaTool {
  readonly name = 'transfer';

  readonly description =
    'Transfer SOL or an SPL token to a single recipient wallet address.';

  readonly schema = {
    amountLamports: 'Amount in lamports (integer)',
    tokenIn: 'Token symbol to send, e.g. SOL',
    recipientPubkey: 'Recipient Solana wallet address (base58)',
  };

  async execute(
    args: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const amountLamports = args.amountLamports as number;
    const recipientPubkey = args.recipientPubkey as string | undefined;

    if (!recipientPubkey) {
      return {
        success: false,
        rejectionReason: 'Missing recipient address for SPL transfer',
        rejectionField: 'intent',
        stepEvent: {
          node: 'build_transaction',
          status: 'rejected',
          label: 'Transfer recipient is missing',
        },
      };
    }

    const ownerPubkey = new PublicKey(ctx.pubkey);
    const recipientKey = new PublicKey(recipientPubkey);

    const txBase64 = await ctx.txAssembler.assembleSplTransferTransaction(
      ownerPubkey,
      recipientKey,
      amountLamports,
    );

    return {
      success: true,
      unsignedTxBase64: txBase64,
      simulationResult: {
        fee: 5000,
        outAmount: amountLamports,
        priceImpact: '0.00%',
      },
      stepEvent: {
        node: 'build_transaction',
        status: 'success',
        label: `Transfer prepared: ${(amountLamports / 1e9).toFixed(4)} SOL → ${recipientPubkey.slice(0, 8)}...`,
        payload: { recipientPubkey, amountLamports },
      },
    };
  }
}
