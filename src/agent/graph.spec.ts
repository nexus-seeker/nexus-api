import {
  assembleTxNode,
  buildTransactionNode,
  parseIntentNode,
  policyRouter,
} from './graph';
import type { AgentState } from './state';
import type { LlmClient } from './llm/llm.interface';

// ── Mock LlmClient ──────────────────────────────────────────────────
const mockInvoke = jest.fn();
const mockLlm: LlmClient = { invoke: mockInvoke } as any;

describe('parseIntentNode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function makeState(intent = 'swap 0.1 SOL to USDC'): AgentState {
    return {
      intent,
      pubkey: '11111111111111111111111111111111',
      runId: 'run-id',
      steps: [],
    };
  }

  it('parses a valid swap intent successfully', async () => {
    mockInvoke.mockResolvedValue({
      content: JSON.stringify({
        action: 'swap',
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amountSOL: 0.1,
        protocol: 'jupiter',
      }),
    });

    const result = await parseIntentNode(makeState(), mockLlm);

    expect(result.rejectionReason).toBeUndefined();
    expect(result.action).toBe('swap');
    expect(result.tokenIn).toBe('SOL');
    expect(result.tokenOut).toBe('USDC');
    expect(result.amountLamports).toBe(100_000_000);
    expect(result.protocol).toBe('jupiter');
  });

  it('normalizes swap protocol alias to jupiter for policy checks', async () => {
    mockInvoke.mockResolvedValue({
      content: JSON.stringify({
        action: 'swap',
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amountSOL: 0.1,
        protocol: 'swap',
      }),
    });

    const result = await parseIntentNode(makeState(), mockLlm, '');

    expect(result.rejectionReason).toBeUndefined();
    expect(result.action).toBe('swap');
    expect(result.protocol).toBe('jupiter');
  });

  it('accepts transfer payloads where tokenOut is null', async () => {
    mockInvoke.mockResolvedValue({
      content: JSON.stringify({
        action: 'transfer',
        tokenIn: 'SOL',
        tokenOut: null,
        amountSOL: 0.001,
        protocol: 'spl_transfer',
      }),
    });

    const result = await parseIntentNode(
      {
        intent:
          'Transfer 0.001 SOL to EP4C7RTzhTPqTZZ8fUzfSu443QawGfDUDYjKgWFPfBfZ',
        pubkey: 'EP4C7RTzhTPqTZZ8fUzfSu443QawGfDUDYjKgWFPfBfZ',
        runId: 'run-id',
        steps: [],
      },
      mockLlm,
    );

    expect(result.rejectionReason).toBeUndefined();
    expect(result.protocol).toBe('spl_transfer');
    expect(result.recipientPubkey).toBe(
      'EP4C7RTzhTPqTZZ8fUzfSu443QawGfDUDYjKgWFPfBfZ',
    );
  });

  it('parses transfer amount when amountSOL comes as a unit string', async () => {
    mockInvoke.mockResolvedValue({
      content: JSON.stringify({
        action: 'transfer',
        tokenIn: 'SOL',
        tokenOut: null,
        amountSOL: '0.1 sol',
        protocol: 'spl_transfer',
        recipientPubkey: 'bene.skr',
      }),
    });

    const result = await parseIntentNode(
      {
        intent: 'can you transfer 0.1 sol to bene.skr',
        pubkey: '11111111111111111111111111111111',
        runId: 'run-id',
        steps: [],
      },
      mockLlm,
      '',
    );

    expect(result.rejectionReason).toBeUndefined();
    expect(result.protocol).toBe('spl_transfer');
    expect(result.recipientPubkey).toBe('bene.skr');
    expect(result.amountLamports).toBe(100_000_000);
  });

  it('extracts .skr recipient from intent text when parser omits recipient field', async () => {
    mockInvoke.mockResolvedValue({
      content: JSON.stringify({
        action: 'transfer',
        tokenIn: 'SOL',
        tokenOut: null,
        amountSOL: 0.1,
        protocol: 'spl_transfer',
      }),
    });

    const result = await parseIntentNode(
      {
        intent: 'can you transfer 0.1 sol to bene.skr',
        pubkey: '11111111111111111111111111111111',
        runId: 'run-id',
        steps: [],
      },
      mockLlm,
      '',
    );

    expect(result.rejectionReason).toBeUndefined();
    expect(result.protocol).toBe('spl_transfer');
    expect(result.recipientPubkey).toBe('bene.skr');
  });

  it('accepts recipient alias field from parser payload', async () => {
    mockInvoke.mockResolvedValue({
      content: JSON.stringify({
        action: 'transfer',
        tokenIn: 'SOL',
        tokenOut: null,
        amountSOL: 0.1,
        protocol: 'spl_transfer',
        recipient: 'bene.skr',
      }),
    });

    const result = await parseIntentNode(
      {
        intent: 'can you transfer 0.1 sol to bene.skr',
        pubkey: '11111111111111111111111111111111',
        runId: 'run-id',
        steps: [],
      },
      mockLlm,
      '',
    );

    expect(result.rejectionReason).toBeUndefined();
    expect(result.protocol).toBe('spl_transfer');
    expect(result.recipientPubkey).toBe('bene.skr');
  });

  it('rejects when LLM returns an error field', async () => {
    mockInvoke.mockResolvedValue({
      content: JSON.stringify({ error: 'ambiguous intent' }),
    });

    const result = await parseIntentNode(makeState(), mockLlm, '');

    expect(result.policyValid).toBe(false);
    expect(result.rejectionField).toBe('intent');
    expect(result.rejectionReason).toContain('ambiguous intent');
  });

  it('rejects when LLM response contains no JSON', async () => {
    mockInvoke.mockResolvedValue({ content: 'sorry I cannot help with that' });

    const result = await parseIntentNode(makeState(), mockLlm, '');

    expect(result.policyValid).toBe(false);
    expect(result.rejectionField).toBe('intent');
  });

  it('rejects when LLM throws', async () => {
    mockInvoke.mockRejectedValue(new Error('network timeout'));

    const result = await parseIntentNode(makeState(), mockLlm, '');

    expect(result.policyValid).toBe(false);
    expect(result.rejectionReason).toContain('network timeout');
  });

  it('falls back to connected wallet for "analyze my wallet" when parser asks for address', async () => {
    mockInvoke.mockResolvedValue({
      content: JSON.stringify({
        error: 'Please provide your wallet address for analysis.',
      }),
    });

    const state = makeState('Analyze my wallet activity');
    state.pubkey = 'EP4C7RTzhTPqTZZ8fUzfSu443QawGfDUDYjKgWFPfBfZ';

    const result = await parseIntentNode(state, mockLlm, '');

    expect(result.rejectionReason).toBeUndefined();
    expect(result.action).toBe('analyze_wallet');
    expect(result.analysisSubject).toBe(
      'EP4C7RTzhTPqTZZ8fUzfSu443QawGfDUDYjKgWFPfBfZ',
    );
    expect(result.steps?.[0]?.status).toBe('success');
  });
});

describe('assembleTxNode', () => {
  it('rejects when Jupiter swap transaction is missing', async () => {
    const state = {
      intent: 'swap 0.1 SOL to USDC',
      pubkey: '11111111111111111111111111111111',
      runId: 'run-id',
      steps: [],
      jupiterInstructions: {},
    } as AgentState;

    const result = await assembleTxNode(state);

    expect(result.policyValid).toBe(false);
    expect(result.rejectionField).toBe('tx_assembly');
    expect(result.rejectionReason).toContain(
      'No valid Jupiter swap transaction',
    );
    expect(result.unsignedTxBase64).toBeUndefined();
  });

  it('returns unsigned tx when Jupiter swap transaction exists', async () => {
    const state = {
      intent: 'swap 0.1 SOL to USDC',
      pubkey: '11111111111111111111111111111111',
      runId: 'run-id',
      steps: [],
      jupiterInstructions: { swapTransaction: 'valid-base64-tx' },
    } as AgentState;

    const result = await assembleTxNode(state);

    expect(result.unsignedTxBase64).toBe('valid-base64-tx');
    expect(result.policyValid).toBeUndefined();
  });
});

describe('buildTransactionNode', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    (globalThis as any).fetch = jest.fn();
  });

  afterEach(() => {
    delete (globalThis as any).fetch;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('uses Jupiter swap/v1 endpoints and forwards API key header', async () => {
    process.env.JUPITER_API_URL = 'https://api.jup.ag/swap/v1';
    process.env.JUPITER_API_KEY = 'jup-test-key';

    const state = {
      intent: 'swap 0.1 SOL to USDC',
      pubkey: '11111111111111111111111111111111',
      runId: 'run-id',
      steps: [],
      tokenIn: 'SOL',
      tokenOut: 'USDC',
      amountLamports: 100_000_000,
    } as AgentState;

    (globalThis.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          outAmount: '14230000',
          priceImpactPct: '0.02',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          swapInstruction: {
            programId: '11111111111111111111111111111111',
            accounts: [],
            data: '',
          },
        }),
      });

    const result = await buildTransactionNode(state);

    expect(result.rejectionReason).toBeUndefined();
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'https://api.jup.ag/swap/v1/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=100000000&slippageBps=50&onlyDirectRoutes=true&maxAccounts=32',
      { headers: { 'x-api-key': 'jup-test-key' } },
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'https://api.jup.ag/swap/v1/swap-instructions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'x-api-key': 'jup-test-key',
        }),
      }),
    );
  });

  it('short-circuits Jupiter calls for spl_transfer intents', async () => {
    const state = {
      intent:
        'transfer 0.01 SOL to EP4C7RTzhTPqTZZ8fUzfSu443QawGfDUDYjKgWFPfBfZ',
      pubkey: '11111111111111111111111111111111',
      runId: 'run-id',
      steps: [],
      protocol: 'spl_transfer',
      tokenIn: 'SOL',
      amountLamports: 10_000_000,
      recipientPubkey: 'EP4C7RTzhTPqTZZ8fUzfSu443QawGfDUDYjKgWFPfBfZ',
    } as AgentState;

    const result = await buildTransactionNode(state);

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(result.rejectionReason).toBeUndefined();
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          node: 'build_transaction',
          status: 'success',
          label: expect.stringContaining('SPL transfer prepared'),
        }),
      ]),
    );
  });
});

describe('policyRouter', () => {
  function makeState(overrides: Partial<AgentState> = {}): AgentState {
    return {
      intent: 'swap 0.1 SOL to USDC',
      pubkey: '11111111111111111111111111111111',
      runId: 'run-id',
      steps: [],
      protocol: 'jupiter',
      policyValid: true,
      ...overrides,
    };
  }

  it('routes to select_route only for jupiter protocol', () => {
    expect(policyRouter(makeState({ protocol: 'jupiter' }))).toBe(
      'select_route',
    );
  });

  it('ends route for spl_transfer protocol', () => {
    expect(policyRouter(makeState({ protocol: 'spl_transfer' }))).toBe(
      '__end__',
    );
  });
});
