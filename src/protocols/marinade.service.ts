import { Injectable, Logger } from '@nestjs/common';

export interface StakeQuote {
    amountLamports: number;
    expectedMsolAmount: number;
    msolMintAddress: string;
}

@Injectable()
export class MarinadeService {
    private readonly logger = new Logger(MarinadeService.name);
    // Marinade Finance REST API endpoint
    private readonly apiUrl = 'https://api.marinade.finance/v1';

    /**
     * Fetches a liquid staking transaction from Marinade.
     * Returns a base64-encoded VersionedTransaction ready to be passed to
     * TxAssemblerService.assembleFromRaydiumTx (same pattern — external tx
     * with checkAndRecord prepended).
     *
     * API docs: https://docs.marinade.finance/developers/marinade-api
     */
    async buildStakeTx(
        walletPubkey: string,
        amountLamports: number,
    ): Promise<{ txBase64: string; msolAddress: string }> {
        // Marinade returns a transaction for liquid staking (mSOL)
        const url =
            `${this.apiUrl}/liquid-staking/buy-transaction` +
            `?amount=${amountLamports}&outputMint=mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So` +
            `&wallet=${walletPubkey}`;

        const response = await fetch(url, {
            headers: { accept: 'application/json' },
        });

        if (!response.ok) {
            const body = await response.text().catch(() => response.statusText);
            throw new Error(
                `Marinade API error: ${response.status} — ${body}`,
            );
        }

        const data = (await response.json()) as {
            transaction: string;
            outputMint: string;
        };

        if (!data.transaction) {
            throw new Error('Marinade API returned no transaction');
        }

        this.logger.log(
            `Marinade stake tx fetched for ${walletPubkey}: ${amountLamports} lamports`,
        );

        return {
            txBase64: data.transaction,
            msolAddress: data.outputMint,
        };
    }

    /**
     * Returns the current mSOL exchange rate (for display purposes).
     */
    async getMsolRate(): Promise<number> {
        const url = `${this.apiUrl}/msol-ratio`;
        const response = await fetch(url, {
            headers: { accept: 'application/json' },
        });
        if (!response.ok) return 1.0; // safe fallback
        const data = (await response.json()) as { msolRatio: number };
        return data.msolRatio ?? 1.0;
    }
}
