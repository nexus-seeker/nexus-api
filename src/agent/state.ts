// AgentState — the linear 4-node graph state
export interface StepEvent {
    type: 'step' | 'heartbeat' | 'complete';
    node?: string;
    label?: string;
    status?: 'running' | 'success' | 'rejected';
    payload?: any;
    result?: AgentRunResult;
}

export interface AgentRunResult {
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

    // Policy check
    policyValid?: boolean;
    rejectionReason?: string;
    rejectionField?: string;

    // Transaction
    jupiterQuote?: any;
    jupiterInstructions?: any;
    unsignedTxBase64?: string;
    simulationResult?: {
        fee: number;
        outAmount: number;
        priceImpact: string;
    };

    // Streaming
    steps: StepEvent[];
}
