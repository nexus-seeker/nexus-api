export interface ExecuteRequest {
  intent: string;
  pubkey: string;
  threadId?: string;
}

export const EXECUTE_REQUEST_OPTIONAL_FIELDS = ['threadId'] as const;

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
  | 'synthesize_response'
  | 'error'
  // ── NEXUS v3.0 intent-class routing nodes ──
  | 'classify_intent'
  | 'casual_reply'
  | 'safety_check'
  | 'safety_response'
  | 'learn_response'
  | 'complex_plan'
  | 'anomaly_check';

export interface StepEvent {
  node: StepNode;
  label: string;
  status: 'running' | 'success' | 'rejected';
  payload?: Record<string, unknown>;
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
  threadId?: string;
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

export interface ConversationThreadDto {
  id: string;
  // API-level wallet identifier. Storage may use walletPubkey internally.
  pubkey: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ProactiveRecommendationActionDto {
  id: string;
  label: string;
  type: 'open' | 'approve' | 'reject' | 'ignore';
  payload?: Record<string, unknown>;
}

export interface ProactiveRecommendationDto {
  id: string;
  // API-level wallet identifier. Storage may use walletPubkey internally.
  pubkey: string;
  threadId?: string;
  title: string;
  summary: string;
  confidence: number;
  status: 'pending' | 'approved' | 'rejected' | 'ignored';
  actions: ProactiveRecommendationActionDto[];
  createdAt: number;
}

export const PROACTIVE_RECOMMENDATION_REQUIRED_FIELDS = [
  'confidence',
  'status',
  'actions',
] as const;

export const PROACTIVE_RECOMMENDATION_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'ignored',
] as const;

export const RECOMMENDATION_FEEDBACK_OUTCOMES = [
  'approved',
  'rejected',
  'ignored',
] as const;

export interface ProactiveFeedResponse {
  recommendations: ProactiveRecommendationDto[];
  nextCursor?: number;
}

export interface RecommendationFeedbackRequest {
  outcome?: 'approved' | 'rejected' | 'ignored';
  interaction?: 'opened';
  reason?: string;
}

export type SSEMessage =
  | { type: 'step'; step: StepEvent }
  | { type: 'heartbeat' }
  | { type: 'complete'; result: ExecuteResponse }
  | { type: 'error'; message: string };
