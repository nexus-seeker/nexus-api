import { Injectable, Logger, Optional } from '@nestjs/common';
import * as crypto from 'crypto';
import { PublicKey } from '@solana/web3.js';
import type { AgentState, StepEvent, AgentRunResult, IntentClass } from './state';
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
import { IntentClassifierService } from './intent-classifier.service';
import { MarketContextService } from './market-context.service';
import { TokenSafetyTool } from './tools/token-safety.tool';
import type { Prisma } from '@prisma/client';

// Anomaly threshold: warn when tx is 5x larger than the user's typical size
const ANOMALY_RATIO_THRESHOLD = 5;

// Token mint map for safety checks
const MINT_MAP: Record<string, string> = {
  SOL: 'So11111111111111111111111111111111111111112',
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  BONK: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
};

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
    private readonly intentClassifier: IntentClassifierService,
    private readonly marketContext: MarketContextService,
    @Optional() private readonly historyEvents?: HistoryEventsService,
    @Optional() private readonly historyProjection?: HistoryProjectionService,
    @Optional() private readonly heliusService?: HeliusService,
    @Optional() private readonly birdeyeService?: BirdeyeService,
    @Optional() private readonly marinadeService?: MarinadeService,
    @Optional() private readonly userMemoryService?: UserMemoryService,
    @Optional() private readonly nameResolutionService?: NameResolutionService,
    @Optional() private readonly tokenSafetyTool?: TokenSafetyTool,
  ) { }

  startAgentRun(intent: string, pubkey: string, threadId?: string): AgentRunResult {
    const resolvedThreadId = this.resolveThreadId(pubkey, threadId);
    const runId = this.initializeRun(intent, pubkey);

    void this.executeAgentWithRunId(intent, pubkey, runId, resolvedThreadId).catch((err: any) => {
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

  async executeAgent(intent: string, pubkey: string, threadId?: string): Promise<AgentRunResult> {
    const resolvedThreadId = this.resolveThreadId(pubkey, threadId);
    const runId = this.initializeRun(intent, pubkey);
    return this.executeAgentWithRunId(intent, pubkey, runId, resolvedThreadId);
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
    threadId: string,
  ): Promise<AgentRunResult> {
    const state: AgentState = { intent, pubkey, threadId, runId, steps: [] };
    const allSteps: StepEvent[] = [];

    try {
      void this.enqueueLifecyclePersistence(runId, pubkey, 'run_started', { intent, threadId });
      void this.enqueueLifecyclePersistence(runId, pubkey, 'message_user', { content: intent, threadId });

      const llm = this.llmService.getLlm();

      // ─── Load user memory (non-blocking) ─────────────────────────
      let memoryContext: string | undefined;
      if (this.userMemoryService) {
        try {
          const memory = await this.userMemoryService.findOrCreate(pubkey);
          const ctx = this.userMemoryService.buildContextString(memory);
          if (ctx) memoryContext = ctx;
          state.intentClass = undefined; // will be set below
        } catch {
          // Non-fatal
        }
      }

      // ─── Step 1: Classify Intent (fast LLM call) ──────────────────
      const intentClass = await this.intentClassifier.classify(intent, llm);
      state.intentClass = intentClass;

      await this.emitStep(runId, pubkey, threadId, allSteps, {
        node: 'classify_intent',
        status: 'success',
        label: `Intent class: ${intentClass}`,
        payload: { intentClass },
      });

      // ─── Step 2: Route to the correct handler ─────────────────────
      switch (intentClass) {
        case 'casual':
          return await this.handleCasual(state, allSteps, llm, memoryContext);
        case 'read':
          return await this.handleRead(state, allSteps, llm, memoryContext);
        case 'safety':
          return await this.handleSafety(state, allSteps, llm, memoryContext);
        case 'learn':
          return await this.handleLearn(state, allSteps, llm, memoryContext);
        case 'complex':
          return await this.handleComplex(state, allSteps, llm, memoryContext);
        case 'action':
        default:
          return await this.handleAction(state, allSteps, llm, memoryContext);
      }
    } catch (err: any) {
      const errorMessage = err?.message || 'Unknown execution error';
      this.logger.error(`[${runId}] Agent execution error: ${errorMessage}`);
      state.rejectionReason = `Agent execution failed: ${errorMessage}`;
      state.rejectionField = 'agent_execution';
      await this.emitStep(runId, pubkey, threadId, allSteps, {
        node: 'error',
        status: 'rejected',
        label: `Execution error: ${errorMessage}`,
      });
      return this.finishRun(runId, allSteps, state);
    }
  }

  // ── CASUAL Handler ────────────────────────────────────────────────
  // Greetings, social chat → inject wallet snapshot + market context → LLM reply
  private async handleCasual(
    state: AgentState,
    allSteps: StepEvent[],
    llm: any,
    memoryContext?: string,
  ): Promise<AgentRunResult> {
    const { runId, pubkey, threadId } = state;

    // Fetch market context (cached)
    const market = await this.marketContext.getContext();
    state.marketContext = market;
    const marketStr = this.marketContext.formatForLlm(market);

    // Fetch wallet balances for context injection (best-effort)
    let walletSnippet = '';
    if (this.heliusService) {
      try {
        const balances = await this.heliusService.getTokenBalances(pubkey);
        const solBalance = (balances.nativeBalance / 1e9).toFixed(3);
        walletSnippet = `User's wallet: ${solBalance} SOL`;
        if (balances.tokens.length > 0) {
          const topTokens = balances.tokens.slice(0, 3).map((t) =>
            `${t.symbol ?? t.mint.slice(0, 6)} ${t.uiAmount?.toFixed(2) ?? '?'}`,
          );
          walletSnippet += `, ${topTokens.join(', ')}`;
        }
      } catch {
        // Non-fatal
      }
    }

    const contextBlock = [memoryContext, marketStr, walletSnippet].filter(Boolean).join('\n');

    const response = await llm.invoke([
      {
        role: 'system',
        content: `${contextBlock}\n\nYou are Kawula, a friendly Solana DeFi assistant. Respond to casual messages with a warm, brief (1-3 sentence) reply. Naturally surface one useful data point from the wallet or market context if relevant. Do not list every number — pick the most interesting one.`,
      },
      { role: 'user', content: state.intent },
    ]);

    state.agentMessage =
      typeof response.content === 'string' ? response.content : JSON.stringify(response.content);

    await this.emitStep(runId, pubkey, threadId!, allSteps, {
      node: 'casual_reply',
      status: 'success',
      label: 'Casual reply generated',
    });

    return this.finishRun(runId, allSteps, state);
  }

  // ── READ Handler ──────────────────────────────────────────────────
  // Read-only queries → parse intent → dispatch to analysis tools (no policy, no tx)
  private async handleRead(
    state: AgentState,
    allSteps: StepEvent[],
    llm: any,
    memoryContext?: string,
  ): Promise<AgentRunResult> {
    const { runId, pubkey, threadId } = state;

    const toolSchema = this.toolRegistry.getSchemaForLlm();
    const parseResult = await parseIntentNode(state, llm, toolSchema, memoryContext);
    Object.assign(state, parseResult);
    if (parseResult.steps) {
      for (const step of parseResult.steps) {
        await this.emitStep(runId, pubkey, threadId!, allSteps, step);
      }
    }

    if (state.rejectionReason) return this.finishRun(runId, allSteps, state);

    const toolName = this.resolveToolName(state.action);
    await this.emitStep(runId, pubkey, threadId!, allSteps, {
      node: 'plan_actions',
      status: 'success',
      label: `Read tool: ${toolName}`,
      payload: { tool: toolName },
    });

    const toolArgs = this.buildToolArgs(state);
    await this.emitStep(runId, pubkey, threadId!, allSteps, {
      node: 'tool_executor',
      status: 'running',
      label: `Running ${toolName}...`,
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

    if (!toolResult.success) {
      state.rejectionReason = toolResult.rejectionReason;
      state.rejectionField = toolResult.rejectionField;
    } else {
      state.agentMessage = toolResult.agentMessage;
      if (!state.agentMessage) {
        const synthResult = await synthesizeResponseNode(state, llm, toolResult, memoryContext);
        Object.assign(state, synthResult);
        if (synthResult.steps) {
          for (const step of synthResult.steps) {
            await this.emitStep(runId, pubkey, threadId!, allSteps, step);
          }
        }
      }
    }

    await this.emitStep(runId, pubkey, threadId!, allSteps, { ...toolResult.stepEvent });
    return this.finishRun(runId, allSteps, state);
  }

  // ── SAFETY Handler ────────────────────────────────────────────────
  // Risk/security questions → RugCheck → explain risk → warn
  private async handleSafety(
    state: AgentState,
    allSteps: StepEvent[],
    llm: any,
    memoryContext?: string,
  ): Promise<AgentRunResult> {
    const { runId, pubkey, threadId } = state;

    await this.emitStep(runId, pubkey, threadId!, allSteps, {
      node: 'safety_check',
      status: 'running',
      label: 'Analysing safety concern...',
    });

    // Extract mint address from the intent message (if any)
    const mintMatch = state.intent.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/);
    let safetyContext = '';

    if (mintMatch && this.tokenSafetyTool) {
      try {
        const report = await this.tokenSafetyTool.safeCheck(mintMatch[0]);
        safetyContext = JSON.stringify(report);
        await this.emitStep(runId, pubkey, threadId!, allSteps, {
          node: 'safety_check',
          status: report.riskScore > 70 ? 'rejected' : 'success',
          label: `Token safety: score ${report.riskScore}/100`,
          payload: report as unknown as Record<string, unknown>,
        });
      } catch {
        // Non-fatal
      }
    }

    // Also check wallet analysis for the sender address, if present
    if (mintMatch && this.heliusService) {
      try {
        const txs = await this.heliusService.getRecentTransactions(mintMatch[0], 5);
        safetyContext += `\n\nSender's recent transactions (last 5):\n${JSON.stringify(txs)}`;
      } catch {
        // Non-fatal
      }
    }

    const memPrefix = memoryContext ? `${memoryContext}\n\n` : '';
    const safetyPrefix = safetyContext
      ? `Token/wallet safety data:\n${safetyContext}\n\n`
      : '';

    const response = await llm.invoke([
      {
        role: 'system',
        content: `${memPrefix}${safetyPrefix}You are Kawula, a Solana DeFi security assistant. Analyse this safety concern and give a clear, direct response. If there is a risk, start with "⚠️ Do not" or "⚠️ Warning". Explain the threat plainly (no jargon). Recommend exactly what the user should do. Keep it under 5 sentences.`,
      },
      { role: 'user', content: state.intent },
    ]);

    state.agentMessage =
      typeof response.content === 'string' ? response.content : JSON.stringify(response.content);

    await this.emitStep(runId, pubkey, threadId!, allSteps, {
      node: 'safety_response',
      status: 'success',
      label: 'Safety assessment complete',
    });

    return this.finishRun(runId, allSteps, state);
  }

  // ── LEARN Handler ─────────────────────────────────────────────────
  // Educational questions → direct LLM with personalization
  private async handleLearn(
    state: AgentState,
    allSteps: StepEvent[],
    llm: any,
    memoryContext?: string,
  ): Promise<AgentRunResult> {
    const { runId, pubkey, threadId } = state;

    await this.emitStep(runId, pubkey, threadId!, allSteps, {
      node: 'learn_response',
      status: 'running',
      label: 'Generating explanation...',
    });

    const memPrefix = memoryContext ? `${memoryContext}\n\n` : '';

    const response = await llm.invoke([
      {
        role: 'system',
        content: `${memPrefix}You are Kawula, a Solana DeFi educational assistant. Explain concepts clearly, adapting to the user's experience level shown above. Use a concrete, numbers-based example from Solana (e.g., actual protocols like Jupiter, Marinade, Orca). After explaining, optionally offer to show the user their own portfolio data related to the concept.`,
      },
      { role: 'user', content: state.intent },
    ]);

    state.agentMessage =
      typeof response.content === 'string' ? response.content : JSON.stringify(response.content);

    await this.emitStep(runId, pubkey, threadId!, allSteps, {
      node: 'learn_response',
      status: 'success',
      label: 'Explanation generated',
    });

    return this.finishRun(runId, allSteps, state);
  }

  // ── COMPLEX Handler ───────────────────────────────────────────────
  // Ambiguous/compound requests → clarify with options → let user choose
  private async handleComplex(
    state: AgentState,
    allSteps: StepEvent[],
    llm: any,
    memoryContext?: string,
  ): Promise<AgentRunResult> {
    const { runId, pubkey, threadId } = state;

    const market = await this.marketContext.getContext();
    state.marketContext = market;
    const marketStr = this.marketContext.formatForLlm(market);

    let walletSnapshot = '';
    if (this.heliusService) {
      try {
        const balances = await this.heliusService.getTokenBalances(pubkey);
        const solBalance = (balances.nativeBalance / 1e9).toFixed(3);
        walletSnapshot = `User has ${solBalance} SOL in wallet.`;
      } catch {
        // Non-fatal
      }
    }

    const contextBlock = [memoryContext, marketStr, walletSnapshot].filter(Boolean).join('\n');

    await this.emitStep(runId, pubkey, threadId!, allSteps, {
      node: 'complex_plan',
      status: 'running',
      label: 'Building options for complex request...',
    });

    const response = await llm.invoke([
      {
        role: 'system',
        content: `${contextBlock}\n\nYou are Kawula, a Solana DeFi assistant. The user has made a vague or complex request. Read their wallet context and present 2-3 concrete, numbered options with: protocol name, expected APY or outcome, and a 1-sentence risk note. Keep it concise. End with "Which fits you best? Or I can explain any of these more."`,
      },
      { role: 'user', content: state.intent },
    ]);

    state.agentMessage =
      typeof response.content === 'string' ? response.content : JSON.stringify(response.content);

    await this.emitStep(runId, pubkey, threadId!, allSteps, {
      node: 'complex_plan',
      status: 'success',
      label: 'Options presented',
    });

    return this.finishRun(runId, allSteps, state);
  }

  // ── ACTION Handler ────────────────────────────────────────────────
  // Execute transaction: full pipeline (parse → precheck → safety → anomaly → tools → assemble)
  private async handleAction(
    state: AgentState,
    allSteps: StepEvent[],
    llm: any,
    memoryContext?: string,
  ): Promise<AgentRunResult> {
    const { runId, pubkey, threadId } = state;

    const toolSchema = this.toolRegistry.getSchemaForLlm();
    const parseResult = await parseIntentNode(state, llm, toolSchema, memoryContext);
    Object.assign(state, parseResult);
    if (parseResult.steps) {
      for (const step of parseResult.steps) {
        await this.emitStep(runId, pubkey, threadId!, allSteps, step);
      }
    }

    if (state.rejectionReason) return this.finishRun(runId, allSteps, state);

    // ── Name resolution ───────────────────────────────────────────
    const resolutionResult = await this.resolveRecipientsInState(state);
    if (!resolutionResult.ok) {
      state.policyValid = false;
      state.rejectionReason = `Recipient resolution failed: ${resolutionResult.reason}`;
      state.rejectionField = 'recipient_resolution';
      await this.emitStep(runId, pubkey, threadId!, allSteps, {
        node: 'plan_actions',
        status: 'rejected',
        label: state.rejectionReason,
      });
      return this.finishRun(runId, allSteps, state);
    }

    if (resolutionResult.resolved.length > 0) {
      await this.emitStep(runId, pubkey, threadId!, allSteps, {
        node: 'plan_actions',
        status: 'success',
        label: `Resolved ${resolutionResult.resolved.length} recipient name(s)`,
        payload: { resolved: resolutionResult.resolved },
      });
    }

    const isAnalysis = state.action === 'analyze';
    const toolName = this.resolveToolName(state.action);

    await this.emitStep(runId, pubkey, threadId!, allSteps, {
      node: 'plan_actions',
      status: 'success',
      label: `Selected tool: ${toolName}`,
      payload: {
        tool: toolName,
        action: state.action,
        availableTools: this.toolRegistry.getAll().map((t) => t.name),
      },
    });

    // ── Onboarding guard (skip for analysis) ─────────────────────
    if (!isAnalysis) {
      let agentProfile: unknown;
      try {
        const ownerKey = new PublicKey(pubkey);
        agentProfile = await this.solanaService.fetchAgentProfile(ownerKey);
      } catch (keyErr: any) {
        const msg = `Agent execution failed: ${keyErr?.message ?? 'Unknown error'}`;
        await this.emitStep(runId, pubkey, threadId!, allSteps, {
          node: 'validate_policy',
          status: 'rejected',
          label: msg,
        });
        state.policyValid = false;
        state.rejectionReason = msg;
        state.rejectionField = 'agent_execution';
        return this.finishRun(runId, allSteps, state);
      }
      if (!agentProfile) {
        const msg = 'Wallet not onboarded. Call POST /policy/onboard to initialize your profile and policy.';
        await this.emitStep(runId, pubkey, threadId!, allSteps, {
          node: 'validate_policy',
          status: 'rejected',
          label: msg,
        });
        state.policyValid = false;
        state.rejectionReason = msg;
        state.rejectionField = 'not_onboarded';
        return this.finishRun(runId, allSteps, state);
      }

      // ── Token Safety Pre-check (swaps only, improvement #2) ──────
      if (state.action === 'swap' && state.tokenOut && this.tokenSafetyTool) {
        const mint = MINT_MAP[state.tokenOut];
        if (mint) {
          try {
            const report = await this.tokenSafetyTool.safeCheck(mint);
            if (report.riskScore > 70 || report.isHoneypot) {
              const warnings = [
                report.isHoneypot ? 'honeypot' : null,
                !report.hasLiquidity ? 'no liquidity' : null,
                report.deployerRugged ? 'deployer has rugged before' : null,
              ].filter(Boolean);

              await this.emitStep(runId, pubkey, threadId!, allSteps, {
                node: 'safety_check',
                status: 'rejected',
                label: `Swap blocked: ${state.tokenOut} safety score ${report.riskScore}/100`,
                payload: report as unknown as Record<string, unknown>,
              });
              state.policyValid = false;
              state.rejectionReason = `I blocked this swap. ${state.tokenOut} failed a safety check (score ${report.riskScore}/100): ${warnings.join(', ')}.`;
              state.rejectionField = 'token_safety';
              return this.finishRun(runId, allSteps, state);
            }

            await this.emitStep(runId, pubkey, threadId!, allSteps, {
              node: 'safety_check',
              status: 'success',
              label: `${state.tokenOut} safety check passed (score ${report.riskScore}/100)`,
            });
          } catch {
            // Non-fatal — don't block if RugCheck is unavailable
          }
        }
      }

      // ── Policy Precheck ──────────────────────────────────────────
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
        await this.emitStep(runId, pubkey, threadId!, allSteps, {
          node: 'validate_policy',
          status: 'rejected',
          label: `Policy precheck error: ${errorMessage}`,
        });
        return this.finishRun(runId, allSteps, state);
      }

      await this.emitStep(runId, pubkey, threadId!, allSteps, {
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

      // ── Anomaly Detection (improvement #6) ───────────────────────
      if (this.userMemoryService && state.amountLamports && state.amountLamports > 0) {
        try {
          const memory = await this.userMemoryService.findOrCreate(pubkey);
          if (memory.avgTradeSizeSol > 0 && memory.runCount >= 3) {
            const requestedSol = state.amountLamports / 1e9;
            const ratio = requestedSol / memory.avgTradeSizeSol;
            if (ratio >= ANOMALY_RATIO_THRESHOLD) {
              await this.emitStep(runId, pubkey, threadId!, allSteps, {
                node: 'anomaly_check',
                status: 'success',
                label: `⚠️ This tx is ${ratio.toFixed(1)}x larger than your usual ${memory.avgTradeSizeSol.toFixed(3)} SOL`,
                payload: { ratio, requestedSol, avgTradeSizeSol: memory.avgTradeSizeSol },
              });
            }
          }
        } catch {
          // Non-fatal
        }
      }
    }

    // ── Tool Executor ─────────────────────────────────────────────
    const toolArgs = this.buildToolArgs(state);

    await this.emitStep(runId, pubkey, threadId!, allSteps, {
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

    if (!toolResult.success) {
      state.rejectionReason = toolResult.rejectionReason;
      state.rejectionField = toolResult.rejectionField;
    } else {
      state.unsignedTxBase64 = toolResult.unsignedTxBase64;
      state.agentMessage = toolResult.agentMessage;
      state.simulationResult = toolResult.simulationResult;

      if (!state.agentMessage) {
        const synthResult = await synthesizeResponseNode(state, llm, toolResult, memoryContext);
        Object.assign(state, synthResult);
        if (synthResult.steps) {
          for (const step of synthResult.steps) {
            await this.emitStep(runId, pubkey, threadId!, allSteps, step);
          }
        }
      }
    }

    await this.emitStep(runId, pubkey, threadId!, allSteps, { ...toolResult.stepEvent });
    return this.finishRun(runId, allSteps, state);
  }

  // ── Shared helpers ────────────────────────────────────────────────

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
        const result = await this.nameResolutionService.resolveNameOrAddress(state.recipientPubkey);
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
          const result = await this.nameResolutionService.resolveNameOrAddress(recipient.pubkey);
          nextRecipients.push({ ...recipient, pubkey: result.address });
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

    if (state.unsignedTxBase64) result.unsignedTx = state.unsignedTxBase64;
    if (state.agentMessage) result.agentMessage = state.agentMessage;
    if (state.rejectionReason) {
      result.rejection = { reason: state.rejectionReason, policyField: state.rejectionField || 'unknown' };
    }
    if (state.simulationResult) result.simulation = state.simulationResult;

    this.runStream.emitComplete(runId, result);

    if (!result.rejection && this.userMemoryService) {
      void this.userMemoryService.updateAfterRun(state.pubkey, {
        tokenIn: state.tokenIn,
        tokenOut: state.tokenOut,
        amountSol: state.amountLamports ? state.amountLamports / 1e9 : undefined,
        recipientPubkey: state.recipientPubkey,
      });
    }

    if (result.rejection) {
      void this.enqueueLifecyclePersistence(runId, state.pubkey, 'run_rejected', {
        reason: result.rejection.reason,
        policyField: result.rejection.policyField,
        intent: state.intent,
        intentClass: state.intentClass,
        threadId: state.threadId,
        steps,
      });
    } else {
      void this.enqueueLifecyclePersistence(runId, state.pubkey, 'run_completed', {
        intent: state.intent,
        intentClass: state.intentClass,
        threadId: state.threadId,
        response: result.agentMessage,
        steps,
        unsignedTx: result.unsignedTx,
        simulation: result.simulation,
      });
    }

    return result;
  }

  private async emitStep(
    runId: string,
    pubkey: string,
    threadId: string,
    allSteps: StepEvent[],
    step: StepEvent,
  ): Promise<void> {
    allSteps.push(step);
    this.runStream.emitStep(runId, step);
    void this.enqueueLifecyclePersistence(runId, pubkey, 'step_emitted', { threadId, step });
  }

  private resolveThreadId(pubkey: string, threadId?: string): string {
    const normalizedThreadId = threadId?.trim();
    return normalizedThreadId ? normalizedThreadId : `default:${pubkey}`;
  }

  private enqueueLifecyclePersistence(
    runId: string,
    pubkey: string,
    type: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const previous = this.persistenceChains.get(runId) ?? Promise.resolve();
    const next = previous.then(() => this.persistLifecycleEvent(runId, pubkey, type, payload));
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
    if (!this.historyEvents || !this.historyProjection) return;

    try {
      const jsonPayload = payload as Prisma.InputJsonValue;
      const event = await this.historyEvents.append({ runId, pubkey, type, payload: jsonPayload });
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
      this.logger.error(`[${runId}] Lifecycle persistence failed for ${type}: ${message}`);
    }
  }

  private resolveToolName(action: string | undefined): string {
    if (!action) return 'swap';
    if (action === 'analyze') return 'analyze_wallet';

    const MAP: Record<string, string> = {
      swap: 'swap',
      transfer: 'transfer',
      multi_send: 'multi_send',
      stake: 'stake',
      analyze_wallet: 'analyze_wallet',
      analyze_token: 'analyze_token',
      check_token_safety: 'check_token_safety',
      compare_yields: 'compare_yields',
      get_pnl_summary: 'get_pnl_summary',
    };

    return MAP[action] ?? action;
  }

  private buildToolArgs(state: AgentState): Record<string, unknown> {
    return {
      amountLamports: state.amountLamports ?? 0,
      tokenIn: state.tokenIn,
      tokenOut: state.tokenOut,
      recipientPubkey: state.recipientPubkey,
      recipients: state.recipients,
      subject: state.analysisSubject ?? state.pubkey,
    };
  }
}
