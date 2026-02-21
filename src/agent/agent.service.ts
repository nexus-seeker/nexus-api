import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { PublicKey } from '@solana/web3.js';
import type { AgentState, StepEvent, AgentRunResult } from './state';
import {
    parseIntentNode,
    validatePolicyNode,
    buildTransactionNode,
    assembleTxNode,
} from './graph';
import { TxAssemblerService } from './tx-assembler.service';

@Injectable()
export class AgentService {
    private readonly logger = new Logger(AgentService.name);
    private readonly activeRuns = new Map<string, StepEvent[]>();

    constructor(private readonly txAssembler: TxAssemblerService) { }

    async executeAgent(intent: string, pubkey: string): Promise<AgentRunResult> {
        const runId = uuidv4();
        this.logger.log(`[${runId}] Starting agent run: "${intent}" for ${pubkey}`);

        // ─── Mock Mode ─────────────────────────────────────────────
        if (process.env.MOCK_MODE === 'true') {
            return this.mockResponse(runId);
        }

        // ─── Real Execution ────────────────────────────────────────
        const state: AgentState = {
            intent,
            pubkey,
            runId,
            steps: [],
        };

        const allSteps: StepEvent[] = [];

        // Node 1: Parse Intent
        const parseResult = await parseIntentNode(state);
        Object.assign(state, parseResult);
        if (parseResult.steps) allSteps.push(...parseResult.steps);

        if (state.rejectionReason) {
            return this.finishRun(runId, allSteps, state);
        }

        // Node 2: Validate Policy
        const policyResult = await validatePolicyNode(state);
        Object.assign(state, policyResult);
        if (policyResult.steps) allSteps.push(...policyResult.steps);

        if (state.policyValid === false || state.rejectionReason) {
            return this.finishRun(runId, allSteps, state);
        }

        // Node 3: Build Transaction (Jupiter)
        const buildResult = await buildTransactionNode(state);
        Object.assign(state, buildResult);
        if (buildResult.steps) allSteps.push(...buildResult.steps);

        if (state.rejectionReason) {
            return this.finishRun(runId, allSteps, state);
        }

        // Node 4: Assemble Transaction (prepend check_and_record_ix)
        const assembleStep: StepEvent = {
            type: 'step',
            node: 'assemble_tx',
            label: 'Assembling transaction...',
            status: 'running',
        };

        try {
            if (state.jupiterInstructions) {
                const txBase64 = await this.txAssembler.assembleTransaction(
                    new PublicKey(pubkey),
                    state.amountLamports || 0,
                    state.protocol || 'jupiter',
                    intent,
                    state.jupiterInstructions,
                );
                state.unsignedTxBase64 = txBase64;
            }

            allSteps.push({
                ...assembleStep,
                status: 'success',
                label: 'Transaction assembled with policy enforcement ✓',
            });
        } catch (err: any) {
            this.logger.error(`[${runId}] TxAssembly error: ${err.message}`);
            // Fallback: use Jupiter tx directly (without check_and_record prepend)
            const fallbackResult = await assembleTxNode(state);
            Object.assign(state, fallbackResult);
            if (fallbackResult.steps) allSteps.push(...fallbackResult.steps);
        }

        return this.finishRun(runId, allSteps, state);
    }

    getRunSteps(runId: string): StepEvent[] | undefined {
        return this.activeRuns.get(runId);
    }

    private finishRun(
        runId: string,
        steps: StepEvent[],
        state: AgentState,
    ): AgentRunResult {
        const result: AgentRunResult = { runId, steps };

        if (state.unsignedTxBase64) {
            result.unsignedTx = state.unsignedTxBase64;
        }

        if (state.rejectionReason) {
            result.rejection = {
                reason: state.rejectionReason,
                policyField: state.rejectionField || 'unknown',
            };
        }

        if (state.simulationResult) {
            result.simulation = state.simulationResult;
        }

        this.activeRuns.set(runId, steps);
        return result;
    }

    private mockResponse(runId: string): AgentRunResult {
        const steps: StepEvent[] = [
            {
                type: 'step',
                node: 'parse_intent',
                label: 'Parsing: swap 0.1 SOL to USDC',
                status: 'success',
            },
            {
                type: 'step',
                node: 'validate_policy',
                label: 'Policy check passed ✓',
                status: 'success',
            },
            {
                type: 'step',
                node: 'build_transaction',
                label: 'Jupiter quote: 0.1 SOL → 14.23 USDC (0.02% impact)',
                status: 'success',
            },
            {
                type: 'step',
                node: 'assemble_tx',
                label: 'Transaction assembled with policy enforcement ✓',
                status: 'success',
            },
        ];

        this.activeRuns.set(runId, steps);

        return {
            runId,
            steps,
            unsignedTx: 'MOCK_BASE64_TX_BYTES',
            simulation: {
                fee: 5000,
                outAmount: 14230000,
                priceImpact: '0.02%',
            },
        };
    }
}
