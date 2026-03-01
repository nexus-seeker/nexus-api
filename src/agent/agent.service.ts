import { Injectable, Logger, Optional } from '@nestjs/common';
import * as crypto from 'crypto';
import { PublicKey } from '@solana/web3.js';
import type { AgentState, StepEvent, AgentRunResult } from './state';
import {
  parseIntentNode,
  buildTransactionNode,
  selectRouteNode,
  synthesizeResponseNode,
} from './graph';
import { TxAssemblerService } from './tx-assembler.service';
import { PolicyPrecheckService } from './policy-precheck.service';
import { RunStreamService } from './run-stream.service';
import { LlmService } from './llm/llm.service';
import { SolanaService } from '../solana/solana.service';
import { HistoryEventsService } from '../history/history-events.service';
import { HistoryProjectionService } from '../history/history-projection.service';
import { RouteSelectorService } from '../protocols/route-selector.service';
import { HeliusService } from '../analysis/helius.service';
import { BirdeyeService } from '../analysis/birdeye.service';
import { MarinadeService } from '../protocols/marinade.service';
import { UserMemoryService } from '../memory/user-memory.service';
import { ToolRegistry } from './tools/tool.registry';
import { NameResolutionService } from './name-resolution.service';
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
    private readonly toolRegistry: ToolRegistry,
    @Optional() private readonly historyEvents?: HistoryEventsService,
    @Optional() private readonly historyProjection?: HistoryProjectionService,
    @Optional() private readonly heliusService?: HeliusService,
    @Optional() private readonly birdeyeService?: BirdeyeService,
    @Optional() private readonly marinadeService?: MarinadeService,
    @Optional() private readonly userMemoryService?: UserMemoryService,
    @Optional() private readonly nameResolutionService?: NameResolutionService,
  ) { }

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

      // Load user memory for LLM context injection (non-blocking — errors are silenced)
      const llm = this.llmService.getLlm();
      let memoryContext: string | undefined;
      if (this.userMemoryService) {
        try {
          const memory = await this.userMemoryService.findOrCreate(pubkey);
          const ctx = this.userMemoryService.buildContextString(memory);
          if (ctx) memoryContext = ctx;
        } catch {
          // Non-fatal: proceed without memory context
        }
      }

      // Node 1: Parse Intent (with memory context injected into system prompt)
      const toolSchema = this.toolRegistry.getSchemaForLlm();
      const parseResult = await parseIntentNode(state, llm, toolSchema, memoryContext);
      Object.assign(state, parseResult);
      if (parseResult.steps) {
        for (const step of parseResult.steps) {
          await this.emitStep(runId, pubkey, allSteps, step);
        }
      }

      if (state.rejectionReason) {
        return this.finishRun(runId, allSteps, state);
      }

      const resolutionResult = await this.resolveRecipientsInState(state);
      if (!resolutionResult.ok) {
        state.policyValid = false;
        state.rejectionReason = `Recipient resolution failed: ${resolutionResult.reason}`;
        state.rejectionField = 'recipient_resolution';
        await this.emitStep(runId, pubkey, allSteps, {
          node: 'plan_actions',
          status: 'rejected',
          label: state.rejectionReason,
        });
        return this.finishRun(runId, allSteps, state);
      }

      if (resolutionResult.resolved.length > 0) {
        await this.emitStep(runId, pubkey, allSteps, {
          node: 'plan_actions',
          status: 'success',
          label: `Resolved ${resolutionResult.resolved.length} recipient name(s)`,
          payload: resolutionResult.resolved,
        });
      }

      // ─── plan_actions: Map parsed intent → tool name ──────────────
      // analysis intents skip policy check (no funds moved)
      const isAnalysis = state.action === 'analyze';

      const toolName = this.resolveToolName(state.action);

      await this.emitStep(runId, pubkey, allSteps, {
        node: 'plan_actions',
        status: 'success',
        label: `Selected tool: ${toolName}`,
        payload: {
          tool: toolName,
          action: state.action,
          protocol: state.protocol,
          availableTools: this.toolRegistry.getAll().map((t) => t.name),
        },
      });

      // ─── Onboarding Guard (skip for analysis — no funds moved) ────
      if (!isAnalysis) {
        const ownerKey = new PublicKey(pubkey);
        const agentProfile = await this.solanaService.fetchAgentProfile(ownerKey);
        if (!agentProfile) {
          await this.emitStep(runId, pubkey, allSteps, {
            node: 'validate_policy',
            status: 'rejected',
            label: 'Wallet not onboarded. Call POST /policy/onboard to initialize your profile and policy.',
          });
          state.policyValid = false;
          state.rejectionReason = 'Wallet not onboarded. Call POST /policy/onboard to initialize your profile and policy.';
          state.rejectionField = 'not_onboarded';
          return this.finishRun(runId, allSteps, state);
        }

        // ─── Policy Precheck ────────────────────────────────────────
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
      }

      // ─── Tool Executor ──────────────────────────────────────────────
      //
      // Build args for the selected tool from the parsed state, then dispatch.
      // This single call replaces ~200 lines of hardcoded if/else branches.
      //
      const toolArgs = this.buildToolArgs(state);

      await this.emitStep(runId, pubkey, allSteps, {
        node: 'tool_executor',
        status: 'running',
        label: `Executing ${toolName}...`,
      });

      const toolResult = await this.toolRegistry.dispatch(toolName, toolArgs, {
        pubkey,
        runId,
        llm,
        txAssembler: this.txAssembler,
        routeSelector: this.routeSelector,
        heliusService: this.heliusService,
        birdeyeService: this.birdeyeService,
        marinadeService: this.marinadeService,
      });

      // Apply tool result to state
      if (!toolResult.success) {
        state.rejectionReason = toolResult.rejectionReason;
        state.rejectionField = toolResult.rejectionField;
      } else {
        state.unsignedTxBase64 = toolResult.unsignedTxBase64;
        state.agentMessage = toolResult.agentMessage;
        state.simulationResult = toolResult.simulationResult;

        // ─── Generate Conversational Response (Layer 5 UX) ────────────────
        if (!state.agentMessage) { // Only synthesize if the tool didn't already
          const synthResult = await synthesizeResponseNode(state, llm, toolResult, memoryContext);
          Object.assign(state, synthResult);
          if (synthResult.steps) {
            for (const step of synthResult.steps) {
              await this.emitStep(runId, pubkey, allSteps, step);
            }
          }
        }
      }

      await this.emitStep(runId, pubkey, allSteps, {
        ...toolResult.stepEvent,
      });

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

  private async resolveRecipientsInState(state: AgentState): Promise<{
    ok: boolean;
    reason?: string;
    resolved: Array<{ input: string; address: string }>;
  }> {
    if (!this.nameResolutionService) {
      return { ok: true, resolved: [] };
    }

    const resolved: Array<{ input: string; address: string }> = [];

    if (state.recipientPubkey) {
      try {
        const result = await this.nameResolutionService.resolveNameOrAddress(
          state.recipientPubkey,
        );
        state.recipientPubkey = result.address;
        if (result.source === 'sns_domain') {
          resolved.push({ input: result.input, address: result.address });
        }
      } catch (error: any) {
        return { ok: false, reason: error?.message || 'Unknown recipient resolution error', resolved };
      }
    }

    if (state.recipients && state.recipients.length > 0) {
      const nextRecipients = [] as Array<{ pubkey: string; amountLamports: number }>;

      for (const recipient of state.recipients) {
        try {
          const result = await this.nameResolutionService.resolveNameOrAddress(
            recipient.pubkey,
          );
          nextRecipients.push({
            ...recipient,
            pubkey: result.address,
          });
          if (result.source === 'sns_domain') {
            resolved.push({ input: result.input, address: result.address });
          }
        } catch (error: any) {
          return {
            ok: false,
            reason: error?.message || `Could not resolve ${recipient.pubkey}`,
            resolved,
          };
        }
      }

      state.recipients = nextRecipients;
    }

    return { ok: true, resolved };
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

    if (state.agentMessage) {
      result.agentMessage = state.agentMessage;
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

    // Update user memory after every successful (non-rejected) run
    if (!result.rejection && this.userMemoryService) {
      void this.userMemoryService.updateAfterRun(state.pubkey, {
        tokenIn: state.tokenIn,
        tokenOut: state.tokenOut,
        amountSol: state.amountLamports ? state.amountLamports / 1e9 : undefined,
        recipientPubkey: state.recipientPubkey,
      });
    }

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

  /**
   * Maps the LLM-chosen action string to the registered tool name.
   * Handles legacy 'analyze' action by routing to the correct tool
   * based on analysisType in state.
   */
  private resolveToolName(action: string | undefined): string {
    if (!action) return 'swap'; // safe default

    // Legacy 'analyze' action — route to specific tool via analysisType
    if (action === 'analyze') {
      return 'analyze_wallet'; // WalletAnalyzeTool; token branch handled via args
    }

    // Direct 1:1 mappings
    const MAP: Record<string, string> = {
      swap: 'swap',
      transfer: 'transfer',
      multi_send: 'multi_send',
      stake: 'stake',
      analyze_wallet: 'analyze_wallet',
      analyze_token: 'analyze_token',
    };

    return MAP[action] ?? action;
  }

  /**
   * Builds the args object to pass into the tool's execute() method,
   * extracting the relevant fields from the parsed AgentState.
   */
  private buildToolArgs(state: AgentState): Record<string, unknown> {
    const base: Record<string, unknown> = {
      amountLamports: state.amountLamports ?? 0,
      tokenIn: state.tokenIn,
      tokenOut: state.tokenOut,
      recipientPubkey: state.recipientPubkey,
      recipients: state.recipients,
      subject: state.analysisSubject ?? state.pubkey,
    };

    // For legacy 'analyze' intents, route to the correct analysis tool
    if (state.action === 'analyze') {
      base.subject = state.analysisSubject ?? state.pubkey;
    }

    return base;
  }
}
