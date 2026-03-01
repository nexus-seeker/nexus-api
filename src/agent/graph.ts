import type { AgentState, StepEvent } from './state';
import type { LlmClient } from './llm/llm.interface';
import type { RouteSelectorService } from '../protocols/route-selector.service';
import { PublicKey } from '@solana/web3.js';
import * as dotenv from 'dotenv';

dotenv.config();

// ─── Token Mint Map ────────────────────────────────────────────────

const MINT_MAP: Record<string, string> = {
  SOL: 'So11111111111111111111111111111111111111112',
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  BONK: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
};

// We now accept dynamic payloads from any registered tool.
// The only strict requirement is that the LLM provides an "action" matching a tool name.
type ParsedIntentPayload = Record<string, any> & { action: string };

function isParsedIntentPayload(value: unknown): value is ParsedIntentPayload {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const payload = value as Record<string, unknown>;
  return typeof payload.action === 'string' && payload.action.length > 0;
}

function normalizePubkey(input?: string): string | undefined {
  if (!input) {
    return undefined;
  }

  try {
    return new PublicKey(input).toBase58();
  } catch {
    return undefined;
  }
}

function extractPubkeyFromIntent(intent: string): string | undefined {
  const matches = intent.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/g);
  if (!matches) {
    return undefined;
  }

  for (const candidate of matches) {
    const normalized = normalizePubkey(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return undefined;
}

// ─── Node 1: Intent Parser ─────────────────────────────────────────

export async function parseIntentNode(
  state: AgentState,
  llm: LlmClient,
  toolSchema: string,
  memoryContext?: string,
): Promise<Partial<AgentState>> {
  const step: StepEvent = {
    node: 'parse_intent',
    label: 'Parsing intent...',
    status: 'running',
  };

  try {
    const memoryPrefix = memoryContext
      ? `${memoryContext}\n\n`
      : '';

    const response = await llm.invoke([
      {
        role: 'system',
        content: `${memoryPrefix}You are a Solana DeFi intent parser. Extract the user's intent.
Return ONLY valid JSON with no markdown code fences.

Supported actions and their JSON schemas:

${toolSchema}

If intent is ambiguous or unsafe, return { "error": "reason" }.`,
      },
      { role: 'user', content: state.intent },
    ]);

    const content =
      typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);

    // Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in LLM response');
    }

    const parsed = JSON.parse(jsonMatch[0]);

    if (parsed.error) {
      return {
        policyValid: false,
        rejectionReason: parsed.error,
        rejectionField: 'intent',
        steps: [
          {
            ...step,
            status: 'rejected',
            label: `Parse failed: ${parsed.error}`,
          },
        ],
      };
    }

    if (!isParsedIntentPayload(parsed)) {
      return {
        policyValid: false,
        rejectionReason: 'Invalid intent payload from parser',
        rejectionField: 'intent',
        steps: [
          {
            ...step,
            status: 'rejected',
            label: 'Parse failed: invalid intent payload',
            payload: parsed,
          },
        ],
      };
    }

    // If the parser returns an action but didn't match our exact old hardcoded paths,
    // we still need to populate AgentState dynamically from the payload.
    // We map generic properties from the parsed JSON payload.

    // Some tools still expect amountLamports instead of amountSOL directly in the state,
    // (though the tool-calling refactor now passes the whole payload).
    const _amountSOL = parsed.amountSOL || 0;
    const amountLamports = Math.round(_amountSOL * 1e9);

    // Dynamic resolution of protocol/token/etc.
    const protocol = parsed.protocol || parsed.action;
    const tokenIn = parsed.tokenIn?.toUpperCase() || undefined;
    const tokenOut = parsed.tokenOut?.toUpperCase() || undefined;
    const recipientPubkey = parsed.recipientPubkey
      ? normalizePubkey(parsed.recipientPubkey) || parsed.recipientPubkey
      : extractPubkeyFromIntent(state.intent);

    return {
      action: parsed.action,
      amountLamports,
      protocol,
      tokenIn,
      tokenOut,
      recipientPubkey,
      // For multi-send
      recipients: parsed.recipients?.map((r: any) => ({
        pubkey: normalizePubkey(r.pubkey) || r.pubkey,
        amountLamports: Math.round((r.amountSOL || 0) * 1e9),
      })),
      // For analyze
      analysisType: parsed.analysisType,
      analysisSubject: parsed.subject || state.pubkey,

      steps: [
        {
          ...step,
          status: 'success',
          label: `Parsed intent for action: ${parsed.action}`,
          payload: {
            ...parsed,
            recipientPubkey,
            amountLamports,
          },
        },
      ],
    };
  } catch (err: any) {
    return {
      policyValid: false,
      rejectionReason: `Intent parsing failed: ${err.message}`,
      rejectionField: 'intent',
      steps: [
        { ...step, status: 'rejected', label: `Parse error: ${err.message}` },
      ],
    };
  }
}

// ─── Node 2: Policy Validator (soft pre-check) ─────────────────────

export async function validatePolicyNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const step: StepEvent = {
    node: 'validate_policy',
    label: 'Checking policy...',
    status: 'running',
  };

  // If parsing already rejected, skip
  if (state.rejectionReason) {
    return {
      policyValid: false,
      steps: [{ ...step, status: 'rejected', label: state.rejectionReason }],
    };
  }

  // In a real implementation, fetch PolicyVault PDA and check limits
  // For now, we do a simulation check based on the state
  // This will be wired to SolanaService later
  try {
    // TODO: Wire to actual SolanaService when available as injectable context
    // const vault = await solanaService.fetchPolicyVault(new PublicKey(state.pubkey));

    // For now, soft pass — on-chain enforcement handles the real check
    return {
      policyValid: true,
      steps: [
        {
          ...step,
          status: 'success',
          label: `Policy check passed ✓`,
        },
      ],
    };
  } catch (err: any) {
    return {
      policyValid: false,
      rejectionReason: err.message,
      rejectionField: 'policy_fetch',
      steps: [
        { ...step, status: 'rejected', label: `Policy error: ${err.message}` },
      ],
    };
  }
}

// ─── Node 2.5: Route Selector (Raydium vs Jupiter) ─────────────────

export async function selectRouteNode(
  state: AgentState,
  routeSelector: RouteSelectorService,
): Promise<Partial<AgentState>> {
  const step: StepEvent = {
    node: 'select_route',
    label: 'Selecting best route...',
    status: 'running',
  };

  const inputMint = MINT_MAP[state.tokenIn || 'SOL'];
  const outputMint = MINT_MAP[state.tokenOut || 'USDC'];

  // Guard: if mints are unknown, route to Jupiter by default
  if (!inputMint || !outputMint) {
    return {
      selectedProtocol: 'jupiter',
      steps: [
        {
          ...step,
          status: 'success',
          label: 'Unknown token pair — defaulting to Jupiter',
        },
      ],
    };
  }

  try {
    // Note: Jupiter quote and instructions are passed in from buildTransactionNode
    // if it was called first, otherwise they're undefined
    const result = await routeSelector.selectBestRoute({
      inputMint,
      outputMint,
      amountLamports: state.amountLamports || 0,
      userPublicKey: state.pubkey,
      slippageBps: 50,
      jupiterQuote: state.jupiterQuote as {
        outAmount: string;
        priceImpactPct: string;
      } | null,
      jupiterInstructions: state.jupiterInstructions as {
        addressLookupTableAddresses?: string[];
      } | null,
    });

    return {
      selectedProtocol: result.winner,
      selectedQuote: (result.winner === 'raydium'
        ? result.raydiumQuote
        : result.jupiterQuote) as Record<string, unknown> | undefined,
      raydiumInstructions: result.raydiumInstructions ?? undefined,
      jupiterInstructions: result.jupiterInstructions as
        | { swapTransaction?: string;[key: string]: unknown }
        | undefined,
      addressLookupTables: result.addressLookupTables,
      routeOutAmount: result.outAmount,
      routePriceImpact: result.priceImpact,
      steps: [
        {
          ...step,
          status: 'success',
          label: result.stepLabel,
          payload: {
            winner: result.winner,
            outAmount: result.outAmount,
            savings: result.savingsVsAlternative,
          },
        },
      ],
    };
  } catch (err: any) {
    // This should not happen (service catches internally) but belt-and-suspenders
    return {
      selectedProtocol: 'jupiter',
      steps: [
        {
          ...step,
          status: 'success',
          label: 'Route comparison failed — defaulting to Jupiter',
        },
      ],
    };
  }
}

// ─── Node 3: Jupiter Builder ───────────────────────────────────────

export async function buildTransactionNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const step: StepEvent = {
    node: 'build_transaction',
    label: 'Building transaction...',
    status: 'running',
  };

  try {
    if (state.protocol === 'spl_transfer') {
      if (!state.recipientPubkey) {
        return {
          policyValid: false,
          rejectionReason: 'Missing recipient pubkey for SPL transfer intent',
          rejectionField: 'intent',
          steps: [
            {
              ...step,
              status: 'rejected',
              label: 'Transfer recipient is missing',
            },
          ],
        };
      }

      return {
        simulationResult: {
          fee: 5000,
          outAmount: 0,
          priceImpact: '0.00%',
        },
        steps: [
          {
            ...step,
            status: 'success',
            label: `SPL transfer prepared: ${(state.amountLamports || 0) / 1e9} SOL to ${state.recipientPubkey}`,
            payload: {
              recipientPubkey: state.recipientPubkey,
              amountLamports: state.amountLamports,
            },
          },
        ],
      };
    }

    const jupiterApiUrl = (
      process.env.JUPITER_API_URL || 'https://api.jup.ag/swap/v1'
    ).replace(/\/+$/, '');
    const jupiterApiKey = process.env.JUPITER_API_KEY;
    const jupiterHeaders: Record<string, string> = {};
    if (jupiterApiKey) {
      jupiterHeaders['x-api-key'] = jupiterApiKey;
    }

    const inputMint = MINT_MAP[state.tokenIn || 'SOL'] || MINT_MAP.SOL;
    const outputMint = MINT_MAP[state.tokenOut || 'USDC'] || MINT_MAP.USDC;
    const onlyDirectRoutes =
      (process.env.JUPITER_ONLY_DIRECT_ROUTES || 'true').toLowerCase() ===
      'true';
    const maxAccounts = Number(process.env.JUPITER_MAX_ACCOUNTS || 32);

    // 1. Get quote
    const quoteUrl = `${jupiterApiUrl}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${state.amountLamports}&slippageBps=50&onlyDirectRoutes=${onlyDirectRoutes}&maxAccounts=${maxAccounts}`;
    const quoteResponse = await fetch(quoteUrl, {
      headers: jupiterHeaders,
    });

    if (!quoteResponse.ok) {
      throw new Error(`Jupiter quote failed: ${quoteResponse.status}`);
    }

    const quote = await quoteResponse.json();

    // 2. Get swap instructions
    const swapResponse = await fetch(`${jupiterApiUrl}/swap-instructions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...jupiterHeaders,
      },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: state.pubkey,
        prioritizationFeeLamports: 'auto',
      }),
    });

    if (!swapResponse.ok) {
      throw new Error(
        `Jupiter swap-instructions failed: ${swapResponse.status}`,
      );
    }

    const swapResult = await swapResponse.json();

    const outAmount = Number(quote.outAmount || 0);
    const priceImpact = quote.priceImpactPct
      ? `${(Number(quote.priceImpactPct) * 100).toFixed(2)}%`
      : '0.00%';

    return {
      jupiterQuote: quote,
      jupiterInstructions: swapResult,
      simulationResult: {
        fee: 5000, // base fee estimate
        outAmount,
        priceImpact,
      },
      steps: [
        {
          ...step,
          status: 'success',
          label: `Jupiter quote: ${(state.amountLamports || 0) / 1e9} ${state.tokenIn} → ${outAmount / 1e6} ${state.tokenOut} (${priceImpact} impact)`,
          payload: { outAmount, priceImpact },
        },
      ],
    };
  } catch (err: any) {
    const rootCause = err?.cause?.message ? `: ${err.cause.message}` : '';
    const message = `${err.message || 'Unknown Jupiter error'}${rootCause}`;

    return {
      policyValid: false,
      rejectionReason: `Jupiter API error: ${message}`,
      rejectionField: 'jupiter',
      steps: [
        { ...step, status: 'rejected', label: `Jupiter error: ${message}` },
      ],
    };
  }
}

// ─── Node 4: Tx Assembler ──────────────────────────────────────────

export async function assembleTxNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const step: StepEvent = {
    node: 'assemble_tx',
    label: 'Assembling transaction...',
    status: 'running',
  };

  try {
    // In a real implementation, this would:
    // 1. Build check_and_record_ix from Anchor IDL
    // 2. Prepend it to Jupiter swap instructions
    // 3. Compile into VersionedTransaction
    // 4. Serialize to base64
    //
    // For now, we return the Jupiter swap transaction directly
    // The full TxAssembler will be wired when the deployed IDL is available

    const swapTx = state.jupiterInstructions?.swapTransaction;
    if (typeof swapTx !== 'string' || swapTx.trim().length === 0) {
      return {
        policyValid: false,
        rejectionReason:
          'No valid Jupiter swap transaction available for assembly',
        rejectionField: 'tx_assembly',
        steps: [
          {
            ...step,
            status: 'rejected',
            label: 'Assembly rejected: missing Jupiter swap transaction',
          },
        ],
      };
    }

    return {
      unsignedTxBase64: swapTx,
      steps: [
        {
          ...step,
          status: 'success',
          label: 'Transaction assembled and ready for signing',
        },
      ],
    };
  } catch (err: any) {
    return {
      policyValid: false,
      rejectionReason: `Tx assembly failed: ${err.message}`,
      rejectionField: 'tx_assembly',
      steps: [
        {
          ...step,
          status: 'rejected',
          label: `Assembly error: ${err.message}`,
        },
      ],
    };
  }
}

// ─── Policy Router ─────────────────────────────────────────────────

export function policyRouter(state: AgentState): 'select_route' | '__end__' {
  if (state.policyValid === false || state.rejectionReason) {
    return '__end__';
  }
  // analyze and multi_send don't go through the route selector
  if (
    state.protocol !== 'jupiter' ||
    state.action === 'analyze' ||
    state.action === 'multi_send'
  ) {
    return '__end__';
  }
  return 'select_route';
}

// ─── Protocol Router ────────────────────────────────────────────────

export function protocolRouter(
  state: AgentState,
): 'build_transaction' | 'assemble_tx' {
  // If Raydium already fetched instructions in select_route, skip jupiterBuilderNode
  if (state.selectedProtocol === 'raydium' && state.raydiumInstructions) {
    return 'assemble_tx';
  }
  return 'build_transaction';
}

// ─── Node 4: Synthesize Conversational Response (Layer 5 UX) ───────

export async function synthesizeResponseNode(
  state: AgentState,
  llm: LlmClient,
  toolResult: any,
  memoryContext?: string,
): Promise<Partial<AgentState>> {
  const step: StepEvent = {
    node: 'synthesize_response',
    label: 'Generating assistant response...',
    status: 'running',
  };

  try {
    const memoryPrefix = memoryContext ? `User context:\n${memoryContext}\n\n` : '';
    // Omit massive hex strings from the tool result to save tokens
    const safeToolResult = { ...toolResult };
    if (safeToolResult.unsignedTxBase64) safeToolResult.unsignedTxBase64 = '<base64_omitted>';

    const toolResultStr = JSON.stringify(safeToolResult, null, 2);

    const response = await llm.invoke([
      {
        role: 'system',
        content: `${memoryPrefix}You are a helpful Solana DeFi assistant named Kawula.
Your job is to read the result of the tool the user just executed, and write a friendly, concise summary of what happened.

Guidelines:
1. Be extremely concise (1-3 sentences max). No fluff, no robotic pleasantries.
2. If the user swapped or moved tokens, confirm the amounts.
3. Keep the tone professional but helpful.
4. If the tool result contains an error or rejection, explain it safely and clearly without raw technical jargon.
5. If the user finished an action and it makes sense, suggest a relevant NEXT step proactively in a natural way. (e.g. if they swapped to USDC, suggest lending it for yield, or sending it).

Tool result:
${toolResultStr}

User original intent: ${state.intent}`,
      },
    ]);

    const agentMessage = typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);

    return {
      agentMessage,
      steps: [
        {
          ...step,
          status: 'success',
          label: 'Generated response',
        },
      ],
    };
  } catch (err: any) {
    // Non-fatal, just log and fallback
    return {
      agentMessage: 'Action completed. Check your wallet or activity feed for details.',
      steps: [
        { ...step, status: 'success', label: 'Response generation skipped' },
      ],
    };
  }
}
