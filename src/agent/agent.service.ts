import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { PublicKey } from '@solana/web3.js';
import type { AgentState, StepEvent, AgentRunResult } from './state';
import type { ExecuteResponse } from '../contracts/mvp';
import {
  parseIntentNode,
  buildTransactionNode,
  selectRouteNode,
} from './graph';
import { TxAssemblerService } from './tx-assembler.service';
import { PolicyPrecheckService } from './policy-precheck.service';
import { RunStreamService } from './run-stream.service';
import { LlmService } from './llm/llm.service';
import { SolanaService } from '../solana/solana.service';
import { HistoryEventsService } from '../history/history-events.service';
import { HistoryProjectionService } from '../history/history-projection.service';
import { RouteSelectorService } from '../protocols/route-selector.service';
import type { Prisma } from '@prisma/client';

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  private readonly persistenceChains = new Map<string, Promise<void>>();

  constructor(
    private readonly txAssembler: TxAssemblerService,
    private readonly policyPrecheck: PolicyPrecheckService,
    private readonly runStream: RunStreamService,
    private readonly llmService: LlmService,
    private readonly solanaService: SolanaService,
    private readonly routeSelector: RouteSelectorService,
    private readonly historyEvents?: HistoryEventsService,
    private readonly historyProjection?: HistoryProjectionService,
  ) {}

  startAgentRun(intent: string, pubkey: string): AgentRunResult {
    const runId = this.initializeRun(intent, pubkey);

    void this.executeAgentWithRunId(intent, pubkey, runId).catch((err: any) => {
      const errorMessage = err?.message || 'Unknown execution error';
      this.logger.error(
        `[${runId}] Agent background execution error: ${errorMessage}`,
      );
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
          node: 'select_route',
          label: 'Raydium CLMM wins — 0.0042 USDC better price',
          status: 'success',
        },
        {
          node: 'build_transaction',
          label:
            'Raydium route confirmed: 0.1 SOL \u2192 14.27 USDC (0.02% impact)',
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
      void this.enqueueLifecyclePersistence(runId, pubkey, 'run_started', {
        intent,
      });
      void this.enqueueLifecyclePersistence(runId, pubkey, 'message_user', {
        content: intent,
      });

      // ─── Real Execution ────────────────────────────────────────

      // Node 1: Parse Intent
      const llm = this.llmService.getLlm();
      const parseResult = await parseIntentNode(state, llm);
      Object.assign(state, parseResult);
      if (parseResult.steps) {
        for (const step of parseResult.steps) {
          await this.emitStep(runId, pubkey, allSteps, step);
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
          label:
            'Wallet not onboarded. Call POST /policy/onboard to initialize your profile and policy.',
        };
        await this.emitStep(runId, pubkey, allSteps, notOnboardedStep);
        state.policyValid = false;
        state.rejectionReason =
          'Wallet not onboarded. Call POST /policy/onboard to initialize your profile and policy.';
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
        await this.emitStep(runId, pubkey, allSteps, {
          node: 'validate_policy',
          status: 'rejected',
          label: `Policy precheck error: ${errorMessage}`,
        });
        return this.finishRun(runId, allSteps, state);
      }

      await this.emitStep(runId, pubkey, allSteps, {
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

      // Node 3: Build Transaction (Jupiter - fetches quote/instructions)
      const buildResult = await buildTransactionNode(state);
      Object.assign(state, buildResult);
      if (buildResult.steps) {
        for (const step of buildResult.steps) {
          await this.emitStep(runId, pubkey, allSteps, step);
        }
      }

      if (state.rejectionReason) {
        return this.finishRun(runId, allSteps, state);
      }

      // Node 3.5: Select Route (compare Raydium vs Jupiter, pick winner)
      const routeResult = await selectRouteNode(state, this.routeSelector);
      Object.assign(state, routeResult);
      if (routeResult.steps) {
        for (const step of routeResult.steps) {
          await this.emitStep(runId, pubkey, allSteps, step);
        }
      }

      // Node 4: Assemble Transaction (prepend check_and_record_ix)
      const assembleStep: StepEvent = {
        node: 'assemble_tx',
        label: 'Assembling transaction...',
        status: 'running',
      };

      try {
        const ownerPubkey = new PublicKey(pubkey);
        // Use selectedProtocol from route selector, fallback to original protocol
        const selectedProtocol =
          state.selectedProtocol || state.protocol || 'jupiter';

        let txBase64: string;
        if (selectedProtocol === 'spl_transfer') {
          if (!state.recipientPubkey) {
            throw new Error('Missing transfer recipient pubkey');
          }

          txBase64 = await this.txAssembler.assembleSplTransferTransaction(
            ownerPubkey,
            new PublicKey(state.recipientPubkey),
            state.amountLamports || 0,
          );
        } else if (
          selectedProtocol === 'raydium' &&
          state.raydiumInstructions
        ) {
          // Raydium path: instructions arrive as base64 VersionedTransaction
          txBase64 = await this.txAssembler.assembleFromRaydiumTx({
            userPubkey: pubkey,
            amountLamports: state.amountLamports || 0,
            protocol: 'raydium',
            raydiumTxBase64: state.raydiumInstructions[0].transaction,
            addressLookupTables: state.addressLookupTables ?? [],
          });
        } else {
          // Jupiter path
          if (!state.jupiterInstructions) {
            throw new Error('Missing Jupiter instructions');
          }

          txBase64 = await this.txAssembler.assembleTransaction(
            ownerPubkey,
            state.amountLamports || 0,
            selectedProtocol,
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
          const simulation =
            await this.txAssembler.simulateUnsignedTx(txBase64);
          simulationFee = simulation.fee;
        } catch (simErr: any) {
          this.logger.warn(
            `[${runId}] Simulation skipped (non-fatal): ${simErr?.message ?? simErr}`,
          );
        }

        state.simulationResult = {
          fee: simulationFee,
          outAmount:
            state.routeOutAmount ||
            state.simulationResult?.outAmount ||
            (selectedProtocol === 'spl_transfer'
              ? state.amountLamports || 0
              : 0),
          priceImpact:
            state.routePriceImpact ||
            state.simulationResult?.priceImpact ||
            '0.00%',
        };

        await this.emitStep(runId, pubkey, allSteps, {
          ...assembleStep,
          status: 'success',
          label: 'Transaction assembled with policy enforcement ✓',
        });
      } catch (err: any) {
        const errorMessage = err?.message || 'Unknown tx assembly error';
        this.logger.error(`[${runId}] TxAssembly error: ${errorMessage}`);
        state.rejectionReason = `Tx assembly failed: ${errorMessage}`;
        state.rejectionField = 'tx_assembly';
        await this.emitStep(runId, pubkey, allSteps, {
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
      await this.emitStep(runId, pubkey, allSteps, {
        node: 'error',
        status: 'rejected',
        label: `Execution error: ${errorMessage}`,
      });
      return this.finishRun(runId, allSteps, state);
    }
  }

  private async finishRun(
    runId: string,
    steps: StepEvent[],
    state: AgentState,
  ): Promise<AgentRunResult> {
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

    if (result.rejection) {
      void this.enqueueLifecyclePersistence(
        runId,
        state.pubkey,
        'run_rejected',
        {
          reason: result.rejection.reason,
          policyField: result.rejection.policyField,
          intent: state.intent,
          steps,
        },
      );
    } else {
      void this.enqueueLifecyclePersistence(
        runId,
        state.pubkey,
        'run_completed',
        {
          intent: state.intent,
          steps,
          unsignedTx: result.unsignedTx,
          simulation: result.simulation,
        },
      );
    }

    return result;
  }

  private async emitStep(
    runId: string,
    pubkey: string,
    allSteps: StepEvent[],
    step: StepEvent,
  ): Promise<void> {
    allSteps.push(step);
    this.runStream.emitStep(runId, step);
    void this.enqueueLifecyclePersistence(runId, pubkey, 'step_emitted', {
      step,
    });
  }

  private enqueueLifecyclePersistence(
    runId: string,
    pubkey: string,
    type: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const previous = this.persistenceChains.get(runId) ?? Promise.resolve();
    const next = previous.then(() =>
      this.persistLifecycleEvent(runId, pubkey, type, payload),
    );

    this.persistenceChains.set(runId, next);

    return next.finally(() => {
      if (this.persistenceChains.get(runId) === next) {
        this.persistenceChains.delete(runId);
      }
    });
  }

  private async persistLifecycleEvent(
    runId: string,
    pubkey: string,
    type: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (!this.historyEvents || !this.historyProjection) {
      return;
    }

    try {
      const jsonPayload = payload as Prisma.InputJsonValue;
      const event = await this.historyEvents.append({
        runId,
        pubkey,
        type,
        payload: jsonPayload,
      });
      await this.historyProjection.project({
        runId: event.runId,
        pubkey: event.pubkey,
        type: event.eventType,
        seq: event.seq,
        eventAt: event.createdAt,
        payload: event.payload as Prisma.InputJsonValue,
      });
    } catch (error: any) {
      const message = error?.message || 'Unknown persistence error';
      this.logger.error(
        `[${runId}] Lifecycle persistence failed for ${type}: ${message}`,
      );
    }
  }
}
