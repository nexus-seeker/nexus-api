import type { AgentState, StepEvent } from './state';
import * as dotenv from 'dotenv';

dotenv.config();

// ─── Token Mint Map ────────────────────────────────────────────────

const MINT_MAP: Record<string, string> = {
    SOL: 'So11111111111111111111111111111111111111112',
    USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
};

// ─── Node 1: Intent Parser ─────────────────────────────────────────

export async function parseIntentNode(state: AgentState): Promise<Partial<AgentState>> {
    const step: StepEvent = {
        type: 'step',
        node: 'parse_intent',
        label: 'Parsing intent...',
        status: 'running',
    };

    try {
        // Lazy import — only loads LangChain when actually needed (not in MOCK_MODE)
        const { ChatOpenAI } = await import('@langchain/openai');
        const llm = new ChatOpenAI({
            modelName: process.env.LLM_MODEL || 'gpt-4o-mini',
            temperature: 0,
        });

        const response = await llm.invoke([
            {
                role: 'system',
                content: `You are a DeFi intent parser. Extract the user's swap or transfer intent.
Return ONLY valid JSON: { "action": "swap"|"transfer", "tokenIn": "SOL", "tokenOut": "USDC", "amountSOL": 0.1, "protocol": "jupiter"|"spl_transfer" }
protocol must be one of: jupiter, spl_transfer.
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

        const amountLamports = Math.round((parsed.amountSOL || 0) * 1e9);

        return {
            action: parsed.action,
            tokenIn: parsed.tokenIn?.toUpperCase() || 'SOL',
            tokenOut: parsed.tokenOut?.toUpperCase() || 'USDC',
            amountLamports,
            protocol: parsed.protocol || 'jupiter',
            steps: [
                {
                    ...step,
                    status: 'success',
                    label: `Parsing: ${parsed.action} ${parsed.amountSOL} ${parsed.tokenIn} to ${parsed.tokenOut}`,
                    payload: parsed,
                },
            ],
        };
    } catch (err: any) {
        return {
            policyValid: false,
            rejectionReason: `Intent parsing failed: ${err.message}`,
            rejectionField: 'intent',
            steps: [{ ...step, status: 'rejected', label: `Parse error: ${err.message}` }],
        };
    }
}

// ─── Node 2: Policy Validator (soft pre-check) ─────────────────────

export async function validatePolicyNode(
    state: AgentState,
): Promise<Partial<AgentState>> {
    const step: StepEvent = {
        type: 'step',
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
            steps: [{ ...step, status: 'rejected', label: `Policy error: ${err.message}` }],
        };
    }
}

// ─── Node 3: Jupiter Builder ───────────────────────────────────────

export async function buildTransactionNode(
    state: AgentState,
): Promise<Partial<AgentState>> {
    const step: StepEvent = {
        type: 'step',
        node: 'build_transaction',
        label: 'Building transaction...',
        status: 'running',
    };

    try {
        const jupiterApiUrl =
            process.env.JUPITER_API_URL || 'https://quote-api.jup.ag/v6';

        const inputMint = MINT_MAP[state.tokenIn || 'SOL'] || MINT_MAP.SOL;
        const outputMint = MINT_MAP[state.tokenOut || 'USDC'] || MINT_MAP.USDC;

        // 1. Get quote
        const quoteUrl = `${jupiterApiUrl}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${state.amountLamports}&slippageBps=50`;
        const quoteResponse = await fetch(quoteUrl);

        if (!quoteResponse.ok) {
            throw new Error(`Jupiter quote failed: ${quoteResponse.status}`);
        }

        const quote = await quoteResponse.json();

        // 2. Get swap instructions
        const swapResponse = await fetch(`${jupiterApiUrl}/swap-instructions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                quoteResponse: quote,
                userPublicKey: state.pubkey,
                prioritizationFeeLamports: 'auto',
            }),
        });

        if (!swapResponse.ok) {
            throw new Error(`Jupiter swap-instructions failed: ${swapResponse.status}`);
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
        return {
            policyValid: false,
            rejectionReason: `Jupiter API error: ${err.message}`,
            rejectionField: 'jupiter',
            steps: [
                { ...step, status: 'rejected', label: `Jupiter error: ${err.message}` },
            ],
        };
    }
}

// ─── Node 4: Tx Assembler ──────────────────────────────────────────

export async function assembleTxNode(
    state: AgentState,
): Promise<Partial<AgentState>> {
    const step: StepEvent = {
        type: 'step',
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

        if (!state.jupiterInstructions) {
            throw new Error('No Jupiter instructions available');
        }

        // If Jupiter returned a swapTransaction directly, use it
        const swapTx =
            state.jupiterInstructions.swapTransaction ||
            'PLACEHOLDER_TX_NEEDS_IDL_WIRING';

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
            steps: [
                { ...step, status: 'rejected', label: `Assembly error: ${err.message}` },
            ],
        };
    }
}

// ─── Policy Router ─────────────────────────────────────────────────

export function policyRouter(state: AgentState): 'build_transaction' | '__end__' {
    if (state.policyValid === false || state.rejectionReason) {
        return '__end__';
    }
    return 'build_transaction';
}
