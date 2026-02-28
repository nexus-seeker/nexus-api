import type { ExecuteResponse, StepEvent } from '../contracts/mvp';

export type AgentRunResult = ExecuteResponse;
export type { StepEvent } from '../contracts/mvp';

export interface AgentState {
  // Input
  intent: string;
  pubkey: string;
  runId: string;

  // Parsed
  action?: 'swap' | 'transfer';
  tokenIn?: string;
  tokenOut?: string;
  amountLamports?: number;
  protocol?: string;
  recipientPubkey?: string;

  // Policy check
  policyValid?: boolean;
  rejectionReason?: string;
  rejectionField?: string;

  // Route selection (after validate_policy)
  selectedProtocol?: 'raydium' | 'jupiter';
  selectedQuote?: Record<string, unknown>; // raw quote from winner
  raydiumInstructions?: Array<{ transaction: string }>; // populated if winner=raydium
  addressLookupTables?: string[]; // ALTs for tx compilation
  routeOutAmount?: number; // raw output units
  routePriceImpact?: string; // "0.02%"

  // Transaction
  jupiterQuote?: Record<string, unknown>;
  jupiterInstructions?: {
    swapTransaction?: string;
    [key: string]: unknown;
  };
  unsignedTxBase64?: string;
  simulationResult?: {
    fee: number;
    outAmount: number;
    priceImpact: string;
  };

  // Streaming
  steps: StepEvent[];
}
