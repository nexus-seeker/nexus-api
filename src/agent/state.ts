import type { ExecuteResponse, StepEvent } from '../contracts/mvp';

export type AgentRunResult = ExecuteResponse;
export type { StepEvent } from '../contracts/mvp';

export interface AgentState {
  // Input
  intent: string;
  pubkey: string;
  runId: string;

  // Parsed
  action?: string;
  tokenIn?: string;
  tokenOut?: string;
  amountLamports?: number;
  protocol?: string;
  recipientPubkey?: string;

  // Multi-send
  recipients?: Array<{ pubkey: string; amountLamports: number }>;

  // Analysis
  analysisType?: 'wallet' | 'token';
  analysisSubject?: string; // wallet pubkey or token mint/symbol
  agentMessage?: string;   // plain-text response for non-tx intents

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
