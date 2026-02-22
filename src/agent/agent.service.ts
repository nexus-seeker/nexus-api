import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { PublicKey } from '@solana/web3.js';
import type { AgentState, StepEvent, AgentRunResult } from './state';
import type { ExecuteResponse } from '../contracts/mvp';
import { parseIntentNode, buildTransactionNode } from './graph';
import { TxAssemblerService } from './tx-assembler.service';
import { PolicyPrecheckService } from './policy-precheck.service';
import { RunStreamService } from './run-stream.service';
import { LlmService } from './llm/llm.service';
import { SolanaService } from '../solana/solana.service';

@Injectable()
export class AgentService {
    private readonly logger = new Logger(AgentService.name);

    constructor(
        private readonly txAssembler: TxAssemblerService,
        private readonly policyPrecheck: PolicyPrecheckService,
        private readonly runStream: RunStreamService,
        private readonly llmService: LlmService,
        private readonly solanaService: SolanaService,
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

    public getMockResponse(): ExecuteResponse {
        return {
            runId: crypto.randomUUID(),
            steps: [
                {
                    node: 'parse_intent',
                    label: 'Parsing: swap 0.1 SOL to USDC',
                    status: 'success',
                },
                {
                    node: 'validate_policy',
                    label: 'Policy check passed \u2713',
                    status: 'success',
                },
                {
                    node: 'build_transaction',
                    label: 'Jupiter quote: 0.1 SOL \u2192 14.23 USDC (0.02% impact)',
                    status: 'success',
                },
                {
                    node: 'assemble_tx',
                    label: 'Transaction assembled with policy enforcement \u2713',
                    status: 'success',
                },
            ],
            unsignedTx: 'MOCK_BASE64_TX_BYTES',
            simulation: {
                fee: 5000,
                outAmount: 14230000,
                priceImpact: '0.02%',
            },
        };
    }

    private initializeRun(intent: string, pubkey: string): string {
        const runId = crypto.randomUUID();
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
            // ─── Real Execution ────────────────────────────────────────

            // Node 1: Parse Intent
            const llm = this.llmService.getLlm();
            const parseResult = await parseIntentNode(state, llm);
            Object.assign(state, parseResult);
            if (parseResult.steps) {
                for (const step of parseResult.steps) {
                    this.emitStep(runId, allSteps, step);
                }
            }

            if (state.rejectionReason) {
                return this.finishRun(runId, allSteps, state);
            }

            // Node 1.5: Onboarding Guard — fail fast if wallet not initialized
            const ownerKey = new PublicKey(pubkey);
            const agentProfile = await this.solanaService.fetchAgentProfile(ownerKey);
            if (!agentProfile) {
                const notOnboardedStep: StepEvent = {
                    node: 'validate_policy',
                    status: 'rejected',
                    label: 'Wallet not onboarded. Call POST /policy/onboard to initialize your profile and policy.',
                };
                this.emitStep(runId, allSteps, notOnboardedStep);
                state.policyValid = false;
                state.rejectionReason = 'Wallet not onboarded. Call POST /policy/onboard to initialize your profile and policy.';
                state.rejectionField = 'not_onboarded';
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
                    node: 'validate_policy',
                    status: 'rejected',
                    label: `Policy precheck error: ${errorMessage}`,
                });
                return this.finishRun(runId, allSteps, state);
            }

            this.emitStep(runId, allSteps, {
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
                node: 'assemble_tx',
                label: 'Assembling transaction...',
                status: 'running',
            };

            try {
                const ownerPubkey = new PublicKey(pubkey);
                const protocol = state.protocol || 'jupiter';

                let txBase64: string;
                if (protocol === 'spl_transfer') {
                    if (!state.recipientPubkey) {
                        throw new Error('Missing transfer recipient pubkey');
                    }

                    txBase64 = await this.txAssembler.assembleSplTransferTransaction(
                        ownerPubkey,
                        new PublicKey(state.recipientPubkey),
                        state.amountLamports || 0,
                    );
                } else {
                    if (!state.jupiterInstructions) {
                        throw new Error('Missing Jupiter instructions');
                    }

                    txBase64 = await this.txAssembler.assembleTransaction(
                        ownerPubkey,
                        state.amountLamports || 0,
                        protocol,
                        state.jupiterInstructions,
                    );
                }

                if (!txBase64) {
                    throw new Error('Assembler returned empty transaction');
                }

                state.unsignedTxBase64 = txBase64;

                // Simulation is best-effort — Jupiter DEX programs (Orca, Raydium, etc.)
                // don't exist on devnet, so simulating the full tx will throw
                // InvalidProgramForExecution. We still return the unsigned tx for signing.
                // Real policy enforcement happens atomically on-chain.
                let simulationFee = 5000; // default lamport estimate
                try {
                    const simulation = await this.txAssembler.simulateUnsignedTx(txBase64);
                    simulationFee = simulation.fee;
                } catch (simErr: any) {
                    this.logger.warn(
                        `[${runId}] Simulation skipped (non-fatal): ${simErr?.message ?? simErr}`,
                    );
                }

                state.simulationResult = {
                    fee: simulationFee,
                    outAmount: state.simulationResult?.outAmount || (protocol === 'spl_transfer' ? (state.amountLamports || 0) : 0),
                    priceImpact: state.simulationResult?.priceImpact || '0.00%',
                };

                this.emitStep(runId, allSteps, {
                    ...assembleStep,
                    status: 'success',
                    label: 'Transaction assembled with policy enforcement ✓',
                });
            } catch (err: any) {
                const errorMessage = err?.message || 'Unknown tx assembly error';
                this.logger.error(`[${runId}] TxAssembly error: ${errorMessage}`);
                state.rejectionReason = `Tx assembly failed: ${errorMessage}`;
                state.rejectionField = 'tx_assembly';
                this.emitStep(runId, allSteps, {
                    ...assembleStep,
                    status: 'rejected',
                    label: `Assembly error: ${errorMessage}`,
                });
            }

            return this.finishRun(runId, allSteps, state);
        } catch (err: any) {
            const errorMessage = err?.message || 'Unknown execution error';
            this.logger.error(`[${runId}] Agent execution error: ${errorMessage}`);
            state.rejectionReason = `Agent execution failed: ${errorMessage}`;
            state.rejectionField = 'agent_execution';
            this.emitStep(runId, allSteps, {
                node: 'error',
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

    private emitStep(runId: string, allSteps: StepEvent[], step: StepEvent): void {
        allSteps.push(step);
        this.runStream.emitStep(runId, step);
    }
}
