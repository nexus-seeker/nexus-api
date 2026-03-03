import { Injectable } from '@nestjs/common';
import { PublicKey } from '@solana/web3.js';
import type { KawulaTool, ToolContext, ToolResult } from './tool.interface';

@Injectable()
export class MultiSendTool implements KawulaTool {
  readonly name = 'multi_send';

  readonly description =
    'Fan-out SOL to multiple recipients in a single atomic transaction. Policy enforces the aggregate total.';

  readonly schema = {
    amountLamports: 'Total SOL in lamports (sum of all recipients)',
    recipients: 'Array of { pubkey: string, amountLamports: number } objects',
  };

  async execute(
    args: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const recipients = args.recipients as Array<{
      pubkey: string;
      amountLamports: number;
    }>;

    if (!recipients || recipients.length === 0) {
      return {
        success: false,
        rejectionReason: 'No recipients provided for multi-send',
        rejectionField: 'intent',
        stepEvent: {
          node: 'multi_send',
          status: 'rejected',
          label: 'Multi-send requires at least one recipient',
        },
      };
    }

    const ownerPubkey = new PublicKey(ctx.pubkey);
    const recipientEntries = recipients.map((r) => ({
      pubkey: new PublicKey(r.pubkey),
      amountLamports: r.amountLamports,
    }));
    const totalLamports = recipientEntries.reduce(
      (acc, r) => acc + r.amountLamports,
      0,
    );

    const txBase64 = await ctx.txAssembler.assembleMultiSendTransaction(
      ownerPubkey,
      recipientEntries,
      totalLamports,
    );

    return {
      success: true,
      unsignedTxBase64: txBase64,
      simulationResult: {
        fee: 5000,
        outAmount: totalLamports,
        priceImpact: '0.00%',
      },
      stepEvent: {
        node: 'multi_send',
        status: 'success',
        label: `Multi-send assembled: ${recipients.length} recipients, ${(totalLamports / 1e9).toFixed(4)} SOL total`,
        payload: { recipientCount: recipients.length, totalLamports },
      },
    };
  }
}
