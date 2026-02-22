import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { PublicKey } from '@solana/web3.js';
import type { AgentState, StepEvent, AgentRunResult } from './state';
import { parseIntentNode, buildTransactionNode } from './graph';
import { TxAssemblerService } from './tx-assembler.service';
import { PolicyPrecheckService } from './policy-precheck.service';
import { RunStreamService } from './run-stream.service';

@Injectable()
export class AgentService {
    private readonly logger = new Logger(AgentService.name);

    constructor(
        private readonly txAssembler: TxAssemblerService,
        private readonly policyPrecheck: PolicyPrecheckService,
        private readonly runStream: RunStreamService,
    ) { }

    startAgentRun(intent: string, pubkey: string): AgentRunResult {
        const runId = this.initializeRun(intent, pubkey);

        void this.executeAgentWithRunId(intent, pubkey, runId).catch((err: any) => {
            const errorMessage = err?.message || 'Unknown execution error';
            this.logger.error(`[${runId}] Agent background execution error: ${errorMessage}`);
            this.runStream.emitComplete(runId, {
                runId,
                steps: [],
                rejection: {
                    reason: `Agent execution failed: ${errorMessage}`,
                    policyField: 'agent_execution',
                },
            });
        });

        return { runId, steps: [] };
    }

    async executeAgent(intent: string, pubkey: string): Promise<AgentRunResult> {
        const runId = this.initializeRun(intent, pubkey);
        return this.executeAgentWithRunId(intent, pubkey, runId);
    }

    private initializeRun(intent: string, pubkey: string): string {
        const runId = uuidv4();
        this.logger.log(`[${runId}] Starting agent run: "${intent}" for ${pubkey}`);
        this.runStream.createRun(runId);
        return runId;
    }

    private async executeAgentWithRunId(
        intent: string,
        pubkey: string,
        runId: string,
    ): Promise<AgentRunResult> {
        const state: AgentState = {
            intent,
            pubkey,
            runId,
            steps: [],
        };

        const allSteps: StepEvent[] = [];

        try {
            // ─── Mock Mode ─────────────────────────────────────────────
            if (process.env.MOCK_MODE === 'true') {
                return this.mockResponse(runId);
            }

            // ─── Real Execution ────────────────────────────────────────

            // Node 1: Parse Intent
            const parseResult = await parseIntentNode(state);
            Object.assign(state, parseResult);
            if (parseResult.steps) {
                for (const step of parseResult.steps) {
                    this.emitStep(runId, allSteps, step);
                }
            }

            if (state.rejectionReason) {
                return this.finishRun(runId, allSteps, state);
            }

            // Node 2: Validate Policy (deterministic precheck)
            let precheck;
            try {
                precheck = await this.policyPrecheck.precheck({
                    pubkey,
                    amountLamports: state.amountLamports || 0,
                    protocol: state.protocol || 'jupiter',
                });
            } catch (err: any) {
                const errorMessage = err?.message || 'Unknown precheck error';
                this.logger.error(`[${runId}] Policy precheck error: ${errorMessage}`);
                state.policyValid = false;
                state.rejectionReason = `Policy precheck failed: ${errorMessage}`;
                state.rejectionField = 'policy_fetch';
                this.emitStep(runId, allSteps, {
                    type: 'step',
                    node: 'validate_policy',
                    status: 'rejected',
                    label: `Policy precheck error: ${errorMessage}`,
                });
                return this.finishRun(runId, allSteps, state);
            }

            this.emitStep(runId, allSteps, {
                type: 'step',
                node: 'validate_policy',
                status: precheck.allowed ? 'success' : 'rejected',
                label: precheck.allowed
                    ? `Policy check passed: ${precheck.reason}`
                    : `Policy check failed: ${precheck.reason}`,
                payload: {
                    amountLamports: precheck.amountLamports,
                    protocol: precheck.protocol,
                    effectiveSpendLamports: precheck.effectiveSpendLamports,
                    projectedSpendLamports: precheck.projectedSpendLamports,
                    dailyMaxLamports: precheck.dailyMaxLamports,
                    allowedProtocols: precheck.allowedProtocols,
                    lastResetTs: precheck.lastResetTs,
                },
            });

            if (!precheck.allowed) {
                state.policyValid = false;
                state.rejectionReason = precheck.reason;
                state.rejectionField = precheck.rejectionField || 'policy';
                return this.finishRun(runId, allSteps, state);
            }

            state.policyValid = true;

            // Node 3: Build Transaction (Jupiter)
            const buildResult = await buildTransactionNode(state);
            Object.assign(state, buildResult);
            if (buildResult.steps) {
                for (const step of buildResult.steps) {
                    this.emitStep(runId, allSteps, step);
                }
            }

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
                if (!state.jupiterInstructions) {
                    throw new Error('Missing Jupiter instructions');
                }

                const txBase64 = await this.txAssembler.assembleTransaction(
                    new PublicKey(pubkey),
                    state.amountLamports || 0,
                    state.protocol || 'jupiter',
                    intent,
                    state.jupiterInstructions,
                );

                if (!txBase64) {
                    throw new Error('Assembler returned empty transaction');
                }

                state.unsignedTxBase64 = txBase64;

                this.emitStep(runId, allSteps, {
                    ...assembleStep,
                    status: 'success',
                    label: 'Transaction assembled with policy enforcement ✓',
                });
            } catch (err: any) {
                this.logger.error(`[${runId}] TxAssembly error: ${err.message}`);
                state.rejectionReason = `Tx assembly failed: ${err.message}`;
                state.rejectionField = 'tx_assembly';
                this.emitStep(runId, allSteps, {
                    ...assembleStep,
                    status: 'rejected',
                    label: `Assembly error: ${err.message}`,
                });
            }

            return this.finishRun(runId, allSteps, state);
        } catch (err: any) {
            const errorMessage = err?.message || 'Unknown execution error';
            this.logger.error(`[${runId}] Agent execution error: ${errorMessage}`);
            state.rejectionReason = `Agent execution failed: ${errorMessage}`;
            state.rejectionField = 'agent_execution';
            this.emitStep(runId, allSteps, {
                type: 'step',
                node: 'agent_execution',
                status: 'rejected',
                label: `Execution error: ${errorMessage}`,
            });
            return this.finishRun(runId, allSteps, state);
        }
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

        this.runStream.emitComplete(runId, result);
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

        for (const step of steps) {
            this.runStream.emitStep(runId, step);
        }

        const result = {
            runId,
            steps,
            unsignedTx: 'MOCK_BASE64_TX_BYTES',
            simulation: {
                fee: 5000,
                outAmount: 14230000,
                priceImpact: '0.02%',
            },
        };
        this.runStream.emitComplete(runId, result);

        return result;
    }

    private emitStep(runId: string, allSteps: StepEvent[], step: StepEvent): void {
        allSteps.push(step);
        this.runStream.emitStep(runId, step);
    }
}
