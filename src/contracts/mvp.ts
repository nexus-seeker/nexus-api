export interface ExecuteRequest {
  intent: string;
  pubkey: string;
}

export type StepNode =
  | 'parse_intent'
  | 'plan_actions'
  | 'tool_executor'
  | 'validate_policy'
  | 'select_route'
  | 'build_transaction'
  | 'assemble_tx'
  | 'multi_send'
  | 'analyze'
  | 'error';

export interface StepEvent {
  node: StepNode;
  label: string;
  status: 'running' | 'success' | 'rejected';
  payload?: unknown;
}

export interface PolicyDto {
  owner: string;
  dailyMaxLamports: number;
  currentSpend: number;
  lastResetTs: number;
  allowedProtocols: string[];
  nextReceiptId: number;
  isActive: boolean;
  bump: number;
}

export interface ReceiptDto {
  agentProfile: string;
  seekerId: string;
  intentHash: number[];
  protocol: string;
  amountLamports: number;
  txSignature: string;
  status: 'Pending' | 'Completed' | 'Rejected' | 'Unknown';
  timestamp: number;
  bump: number;
  address?: string;
}

export interface ExecuteResponse {
  runId: string;
  steps: StepEvent[];
  unsignedTx?: string;
  /** Returned instead of unsignedTx for analysis / conversational intents */
  agentMessage?: string;
  rejection?: {
    reason: string;
    policyField: string;
  };
  simulation?: {
    fee: number;
    outAmount: number;
    priceImpact: string;
  };
}

export interface MessageDto {
  id: string;
  role: string;
  content: string;
  runId: string;
  steps?: unknown[];
  rejection?: {
    reason: string;
    policyField: string;
  };
  timestamp: number;
}

export interface HistoryResponse {
  messages: MessageDto[];
  nextCursor?: number;
  nextCursorId?: string;
}

export type SSEMessage =
  | { type: 'step'; step: StepEvent }
  | { type: 'heartbeat' }
  | { type: 'complete'; result: ExecuteResponse }
  | { type: 'error'; message: string };
