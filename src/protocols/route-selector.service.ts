import { Injectable, Logger } from '@nestjs/common';
import { RaydiumService } from './raydium.service';

// Jupiter quote shape (minimal interface for what we need)
interface JupiterQuote {
  outAmount: string;
  priceImpactPct: string;
}

// Jupiter instructions shape
interface JupiterInstructions {
  setupInstructions?: unknown[];
  swapInstruction?: unknown;
  cleanupInstruction?: unknown;
  addressLookupTableAddresses?: string[];
}

export type SelectedProtocol = 'raydium' | 'jupiter';

export interface RouteSelectionResult {
  winner: SelectedProtocol;
  raydiumQuote: unknown | null; // RaydiumQuoteResponse | null
  jupiterQuote: JupiterQuote | null; // Jupiter quote response | null
  raydiumInstructions: Array<{ transaction: string }> | null; // RaydiumSwapTxResponse.data | null
  jupiterInstructions: JupiterInstructions | null; // JupiterSwapInstructions | null
  addressLookupTables: string[];
  outAmount: number; // raw units (for simulation display)
  priceImpact: string; // "0.02%"
  savingsVsAlternative: number; // raw units difference, 0 if only one route
  stepLabel: string; // human-readable for StepCard
}

@Injectable()
export class RouteSelectorService {
  private readonly logger = new Logger(RouteSelectorService.name);

  constructor(private readonly raydium: RaydiumService) {}

  async selectBestRoute(params: {
    inputMint: string;
    outputMint: string;
    amountLamports: number;
    userPublicKey: string;
    slippageBps?: number;
    jupiterQuote?: JupiterQuote | null;
    jupiterInstructions?: JupiterInstructions | null;
  }): Promise<RouteSelectionResult> {
    const {
      inputMint,
      outputMint,
      amountLamports,
      userPublicKey,
      slippageBps = 50,
      jupiterQuote: providedJupiterQuote,
      jupiterInstructions: providedJupiterInstructions,
    } = params;

    // ── Fire Raydium quote ──────────────────────────────────────────────
    const raydiumQuote = await this.raydium.getQuote({
      inputMint,
      outputMint,
      amountLamports,
      slippageBps,
    });

    const raydiumOut = raydiumQuote
      ? this.raydium.extractOutputAmount(raydiumQuote)
      : 0;
    const jupiterOut = providedJupiterQuote
      ? Number(providedJupiterQuote.outAmount)
      : 0;

    this.logger.log(
      `Route comparison — Raydium: ${raydiumOut} | Jupiter: ${jupiterOut}`,
    );

    // ── Decision logic ────────────────────────────────────────────────────────
    // Prefer Raydium (free). Use Jupiter if Raydium fails OR Jupiter wins by more than 0.
    const useRaydium = raydiumQuote !== null && raydiumOut >= jupiterOut;
    const winner: SelectedProtocol = useRaydium ? 'raydium' : 'jupiter';

    const winnerOut = useRaydium ? raydiumOut : jupiterOut;
    const altOut = useRaydium ? jupiterOut : raydiumOut;
    const savings = Math.max(0, winnerOut - altOut);

    // ── Fetch instructions for the winner only ────────────────────────────────
    let raydiumInstructions: Array<{ transaction: string }> | null = null;
    let jupiterInstructions: JupiterInstructions | null = null;
    let addressLookupTables: string[] = [];
    let priceImpact = '0.00%';

    if (winner === 'raydium' && raydiumQuote) {
      raydiumInstructions = await this.raydium.getSwapInstructions({
        quoteResponse: raydiumQuote,
        userPublicKey,
        prioritizationFeeLamports: 'auto',
      });
      priceImpact = this.raydium.extractPriceImpact(raydiumQuote);

      // If Raydium instruction fetch failed, fall back to Jupiter
      if (!raydiumInstructions && providedJupiterInstructions) {
        this.logger.warn(
          'Raydium instructions failed — falling back to Jupiter',
        );
        jupiterInstructions = providedJupiterInstructions;
        addressLookupTables =
          providedJupiterInstructions?.addressLookupTableAddresses ?? [];
        priceImpact = providedJupiterQuote
          ? `${providedJupiterQuote.priceImpactPct}%`
          : '0.00%';
      }
    } else if (providedJupiterInstructions) {
      jupiterInstructions = providedJupiterInstructions;
      addressLookupTables =
        providedJupiterInstructions?.addressLookupTableAddresses ?? [];
      priceImpact = providedJupiterQuote
        ? `${providedJupiterQuote.priceImpactPct}%`
        : '0.00%';
    }

    // ── Build human-readable step label ──────────────────────────────────────
    const protocolLabel = winner === 'raydium' ? 'Raydium CLMM' : 'Jupiter';
    const bothAvailable = raydiumOut > 0 && jupiterOut > 0;
    const savingsFormatted = (savings / 1e6).toFixed(4); // assumes USDC 6 decimals
    const stepLabel = bothAvailable
      ? `${protocolLabel} wins — ${savingsFormatted} USDC better price`
      : `${protocolLabel} selected (only available route)`;

    return {
      winner: raydiumInstructions ? 'raydium' : 'jupiter', // may have fallen back
      raydiumQuote,
      jupiterQuote: providedJupiterQuote ?? null,
      raydiumInstructions,
      jupiterInstructions,
      addressLookupTables,
      outAmount: winnerOut,
      priceImpact,
      savingsVsAlternative: savings,
      stepLabel,
    };
  }
}
