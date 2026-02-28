export interface ExecuteRequest {
  intent: string;
  pubkey: string;
}

export type StepNode =
  | 'parse_intent'
  | 'validate_policy'
  | 'select_route'
  | 'build_transaction'
  | 'assemble_tx'
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
