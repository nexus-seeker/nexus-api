import { assembleTxNode, parseIntentNode, policyRouter } from './graph';
import type { AgentState } from './state';

const mockInvoke = jest.fn();

jest.mock('@langchain/openai', () => ({
  ChatOpenAI: jest.fn().mockImplementation(() => ({
    invoke: mockInvoke,
  })),
}));

describe('parseIntentNode', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  function makeState(intent = 'swap 0.1 SOL to USDC'): AgentState {
    return {
      intent,
      pubkey: '11111111111111111111111111111111',
      runId: 'run-id',
      steps: [],
    };
  }

  it('rejects unsupported LLM provider with clear reason', async () => {
    process.env.LLM_PROVIDER = 'anthropic';

    const result = await parseIntentNode(makeState());

    expect(result.policyValid).toBe(false);
    expect(result.rejectionField).toBe('intent');
    expect(result.rejectionReason).toContain('Unsupported LLM provider');
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
    expect(result.rejectionReason).toContain('No valid Jupiter swap transaction');
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

  it('routes to build_transaction only for jupiter protocol', () => {
    expect(policyRouter(makeState({ protocol: 'jupiter' }))).toBe('build_transaction');
  });

  it('ends route for spl_transfer protocol', () => {
    expect(policyRouter(makeState({ protocol: 'spl_transfer' }))).toBe('__end__');
  });
});
