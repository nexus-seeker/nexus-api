import { AgentService } from './agent.service';
import { TxAssemblerService } from './tx-assembler.service';
import { PolicyPrecheckService } from './policy-precheck.service';
import { RunStreamService } from './run-stream.service';
import { LlmService } from './llm/llm.service';
import { SolanaService } from '../solana/solana.service';
import { HistoryEventsService } from '../history/history-events.service';
import { HistoryProjectionService } from '../history/history-projection.service';
import { ToolRegistry } from './tools/tool.registry';
import {
  parseIntentNode,
  buildTransactionNode,
  synthesizeResponseNode,
} from './graph';

jest.mock('uuid', () => ({
  v4: jest.fn(() => 'run-id'),
}));

jest.mock('./graph', () => ({
  parseIntentNode: jest.fn(),
  buildTransactionNode: jest.fn(),
  selectRouteNode: jest.fn(),
  assembleTxNode: jest.fn(),
  synthesizeResponseNode: jest.fn(),
}));

import { selectRouteNode } from './graph';
import { RouteSelectorService } from '../protocols/route-selector.service';

describe('AgentService', () => {
  const createRunStreamMock = () => ({
    createRun: jest.fn(),
    emitStep: jest.fn(),
    emitComplete: jest.fn(),
  }) as unknown as RunStreamService;

  const createHistoryEventsMock = () => ({
    append: jest.fn(),
  }) as unknown as HistoryEventsService;

  const createHistoryProjectionMock = () => ({
    project: jest.fn(),
  }) as unknown as HistoryProjectionService;

  const mockLlmService = {
    getLlm: jest.fn().mockReturnValue({ invoke: jest.fn() }),
  } as unknown as LlmService;

  const mockRouteSelectorService = {} as unknown as RouteSelectorService;

  // Default mock ToolRegistry — dispatch returns a successful unsigned tx result
  const mockToolRegistry = {
    dispatch: jest.fn().mockResolvedValue({
      success: true,
      unsignedTxBase64: 'mock-tx-base64',
      simulationResult: { fee: 5000, outAmount: 0, priceImpact: '0.00%' },
      stepEvent: { node: 'build_transaction', status: 'success', label: 'Tool executed ✓' },
    }),
    getAll: jest.fn().mockReturnValue([]),
    register: jest.fn(),
    get: jest.fn(),
    getSchemaForLlm: jest.fn().mockReturnValue(''),
  } as unknown as ToolRegistry;

  // Default: wallet is onboarded
  const mockSolanaService = {
    fetchAgentProfile: jest.fn().mockResolvedValue({ owner: '11111111111111111111111111111111' }),
  } as unknown as SolanaService;

  beforeEach(() => {
    jest.clearAllMocks();
    (mockSolanaService.fetchAgentProfile as jest.Mock).mockResolvedValue({ owner: '11111111111111111111111111111111' });
    // Default: selectRouteNode returns jupiter
    (selectRouteNode as jest.Mock).mockResolvedValue({
      selectedProtocol: 'jupiter',
      steps: [{ node: 'select_route', status: 'success', label: 'Jupiter selected' }],
    });
    // Default: toolRegistry success — override per-test as needed
    (mockToolRegistry.dispatch as jest.Mock).mockResolvedValue({
      success: true,
      unsignedTxBase64: 'mock-tx-base64',
      simulationResult: { fee: 5000, outAmount: 0, priceImpact: '0.00%' },
      stepEvent: { node: 'build_transaction', status: 'success', label: 'Tool executed ✓' },
    });
    (mockToolRegistry.getAll as jest.Mock).mockReturnValue([]);
    // Default: synthesizeResponseNode returns a valid step
    (synthesizeResponseNode as jest.Mock).mockResolvedValue({
      agentMessage: 'Mocked conversational response',
      steps: [{ node: 'synthesize_response', status: 'success', label: 'Response generated' }],
    });
  });

  it.each([undefined, ''])(
    'rejects tx_assembly when tool dispatch returns no tx (%p)',
    async (assembledTx) => {
      const txAssembler = {} as unknown as TxAssemblerService;
      const policyPrecheck = {
        precheck: jest.fn().mockResolvedValue({ allowed: true, reason: 'ok' }),
      } as unknown as PolicyPrecheckService;
      const runStream = createRunStreamMock();

      // Simulate the tool returning an "empty" tx (treated as failure by registry)
      (mockToolRegistry.dispatch as jest.Mock).mockResolvedValue({
        success: false,
        rejectionReason: 'Assembler returned empty transaction',
        rejectionField: 'tx_assembly',
        stepEvent: { node: 'build_transaction', status: 'rejected', label: 'Empty tx' },
      });

      const service = new AgentService(txAssembler, policyPrecheck, runStream, mockLlmService, mockSolanaService, mockRouteSelectorService, mockToolRegistry);

      (parseIntentNode as jest.Mock).mockResolvedValue({
        action: 'swap',
        amountLamports: 100000000,
        protocol: 'jupiter',
        steps: [{ type: 'step', node: 'parse_intent', status: 'success', label: 'parsed' }],
      });

      const result = await service.executeAgent(
        'swap 0.1 SOL to USDC',
        '11111111111111111111111111111111',
      );

      expect(result.unsignedTx).toBeUndefined();
      expect(result.rejection?.policyField).toBe('tx_assembly');
    },
  );

  it('rejects tx_assembly when tool dispatch returns a build failure', async () => {
    const txAssembler = {} as unknown as TxAssemblerService;
    const policyPrecheck = {
      precheck: jest.fn().mockResolvedValue({ allowed: true, reason: 'ok' }),
    } as unknown as PolicyPrecheckService;
    const runStream = createRunStreamMock();

    (mockToolRegistry.dispatch as jest.Mock).mockResolvedValue({
      success: false,
      rejectionReason: 'Missing Jupiter instructions',
      rejectionField: 'tx_assembly',
      stepEvent: { node: 'build_transaction', status: 'rejected', label: 'Missing Jupiter instructions' },
    });

    const service = new AgentService(txAssembler, policyPrecheck, runStream, mockLlmService, mockSolanaService, mockRouteSelectorService, mockToolRegistry);

    (parseIntentNode as jest.Mock).mockResolvedValue({
      action: 'swap',
      amountLamports: 100000000,
      protocol: 'jupiter',
      steps: [{ type: 'step', node: 'parse_intent', status: 'success', label: 'parsed' }],
    });

    const result = await service.executeAgent(
      'swap 0.1 SOL to USDC',
      '11111111111111111111111111111111',
    );

    expect(result.unsignedTx).toBeUndefined();
    expect(result.rejection?.policyField).toBe('tx_assembly');
  });

  it('rejects tx_assembly failures via tool registry dispatch rejection', async () => {
    const txAssembler = {} as unknown as TxAssemblerService;
    const policyPrecheck = {
      precheck: jest.fn().mockResolvedValue({
        allowed: true,
        reason: 'Policy precheck passed.',
      }),
    } as unknown as PolicyPrecheckService;
    const runStream = createRunStreamMock();

    const failingToolRegistry = {
      dispatch: jest.fn().mockResolvedValue({
        success: false,
        rejectionReason: 'Tx assembly failed: assembler down',
        rejectionField: 'tx_assembly',
        stepEvent: { node: 'build_transaction', status: 'rejected', label: 'Assembly error: assembler down' },
      }),
      getAll: jest.fn().mockReturnValue([]),
      register: jest.fn(),
      get: jest.fn(),
      getSchemaForLlm: jest.fn().mockReturnValue(''),
    } as unknown as ToolRegistry;

    const service = new AgentService(txAssembler, policyPrecheck, runStream, mockLlmService, mockSolanaService, mockRouteSelectorService, failingToolRegistry);

    (parseIntentNode as jest.Mock).mockResolvedValue({
      action: 'swap',
      amountLamports: 100000000,
      protocol: 'jupiter',
      steps: [
        { type: 'step', node: 'parse_intent', status: 'success', label: 'parsed' },
      ],
    });

    const result = await service.executeAgent(
      'swap 0.1 SOL to USDC',
      '11111111111111111111111111111111',
    );

    expect(result.unsignedTx).toBeUndefined();
    expect(result.rejection).toEqual({
      reason: 'Tx assembly failed: assembler down',
      policyField: 'tx_assembly',
    });
  });

  it('uses fallback tx_assembly error when tool dispatch throws without message', async () => {
    const txAssembler = {} as unknown as TxAssemblerService;
    const policyPrecheck = {
      precheck: jest.fn().mockResolvedValue({ allowed: true, reason: 'ok' }),
    } as unknown as PolicyPrecheckService;
    const runStream = createRunStreamMock();

    (mockToolRegistry.dispatch as jest.Mock).mockResolvedValue({
      success: false,
      rejectionReason: 'Tool "swap" failed: Unknown tool execution error',
      rejectionField: 'tool_execution',
      stepEvent: { node: 'tool_executor', status: 'rejected', label: 'Tool error: Unknown tool execution error' },
    });

    const service = new AgentService(txAssembler, policyPrecheck, runStream, mockLlmService, mockSolanaService, mockRouteSelectorService, mockToolRegistry);

    (parseIntentNode as jest.Mock).mockResolvedValue({
      action: 'swap',
      amountLamports: 100000000,
      protocol: 'jupiter',
      steps: [{ type: 'step', node: 'parse_intent', status: 'success', label: 'parsed' }],
    });

    const result = await service.executeAgent(
      'swap 0.1 SOL to USDC',
      '11111111111111111111111111111111',
    );

    expect(result.unsignedTx).toBeUndefined();
    expect(result.rejection).toEqual(
      expect.objectContaining({ policyField: 'tool_execution' }),
    );
  });

  it('rejects before tx build when policy precheck fails', async () => {
    const txAssembler = {
      assembleTransaction: jest.fn().mockResolvedValue('should-not-be-used'),
      simulateUnsignedTx: jest.fn().mockResolvedValue({ fee: 7000 }),
    } as unknown as TxAssemblerService;
    const policyPrecheck = {
      precheck: jest.fn().mockResolvedValue({
        allowed: false,
        rejectionField: 'daily_max',
        reason: 'Daily max exceeded: requested 0.1 SOL, cap 0.05 SOL, remaining 0 SOL.',
      }),
    } as unknown as PolicyPrecheckService;
    const runStream = createRunStreamMock();

    const service = new AgentService(txAssembler, policyPrecheck, runStream, mockLlmService, mockSolanaService, mockRouteSelectorService, mockToolRegistry);

    (parseIntentNode as jest.Mock).mockResolvedValue({
      action: 'swap',
      amountLamports: 100000000,
      protocol: 'jupiter',
      steps: [
        { type: 'step', node: 'parse_intent', status: 'success', label: 'parsed' },
      ],
    });

    const result = await service.executeAgent(
      'swap 0.1 SOL to USDC',
      '11111111111111111111111111111111',
    );

    expect(buildTransactionNode).not.toHaveBeenCalled();
    expect(txAssembler.assembleTransaction).not.toHaveBeenCalled();
    expect(result.rejection?.policyField).toBe('daily_max');
    expect(result.rejection?.reason).toContain('Daily max exceeded');
    expect(result.rejection?.reason).toContain('requested 0.1 SOL');
    expect(result.rejection?.reason).toContain('cap 0.05 SOL');
    expect(result.rejection?.reason).toContain('remaining 0 SOL');
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          node: 'validate_policy',
          status: 'rejected',
          label: expect.stringContaining('Daily max exceeded'),
        }),
      ]),
    );
  });

  it('rejects with not_onboarded when AgentProfile is missing', async () => {
    const txAssembler = {
      assembleTransaction: jest.fn(),
      simulateUnsignedTx: jest.fn(),
    } as unknown as TxAssemblerService;
    const policyPrecheck = {
      precheck: jest.fn(),
    } as unknown as PolicyPrecheckService;
    const runStream = createRunStreamMock();
    const notOnboardedSolanaService = {
      fetchAgentProfile: jest.fn().mockResolvedValue(null),
    } as unknown as SolanaService;

    const service = new AgentService(txAssembler, policyPrecheck, runStream, mockLlmService, notOnboardedSolanaService, mockRouteSelectorService, mockToolRegistry);

    (parseIntentNode as jest.Mock).mockResolvedValue({
      action: 'swap',
      amountLamports: 100000000,
      protocol: 'jupiter',
      steps: [{ type: 'step', node: 'parse_intent', status: 'success', label: 'parsed' }],
    });

    const result = await service.executeAgent(
      'swap 0.1 SOL to USDC',
      '11111111111111111111111111111111',
    );

    expect(policyPrecheck.precheck).not.toHaveBeenCalled();
    expect(txAssembler.assembleTransaction).not.toHaveBeenCalled();
    expect(result.rejection?.policyField).toBe('not_onboarded');
    expect(result.rejection?.reason).toContain('POST /policy/onboard');
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          node: 'validate_policy',
          status: 'rejected',
          label: expect.stringContaining('POST /policy/onboard'),
        }),
      ]),
    );
  });

  it('returns simulation data from tool dispatch result', async () => {
    const txAssembler = {} as unknown as TxAssemblerService;
    const policyPrecheck = {
      precheck: jest.fn().mockResolvedValue({ allowed: true, reason: 'ok' }),
    } as unknown as PolicyPrecheckService;
    const runStream = createRunStreamMock();

    (mockToolRegistry.dispatch as jest.Mock).mockResolvedValue({
      success: true,
      unsignedTxBase64: 'assembled-tx',
      simulationResult: { fee: 9123, outAmount: 14230000, priceImpact: '0.02%' },
      stepEvent: { node: 'build_transaction', status: 'success', label: 'Swap done' },
    });

    const service = new AgentService(txAssembler, policyPrecheck, runStream, mockLlmService, mockSolanaService, mockRouteSelectorService, mockToolRegistry);

    (parseIntentNode as jest.Mock).mockResolvedValue({
      action: 'swap',
      amountLamports: 100000000,
      protocol: 'jupiter',
      steps: [{ type: 'step', node: 'parse_intent', status: 'success', label: 'parsed' }],
    });

    const result = await service.executeAgent(
      'swap 0.1 SOL to USDC',
      '11111111111111111111111111111111',
    );

    expect(result.simulation).toEqual({
      fee: 9123,
      outAmount: 14230000,
      priceImpact: '0.02%',
    });
    expect(result.unsignedTx).toBe('assembled-tx');
  });

  it('assembles spl_transfer via tool registry dispatch', async () => {
    const txAssembler = {} as unknown as TxAssemblerService;
    const policyPrecheck = {
      precheck: jest.fn().mockResolvedValue({ allowed: true, reason: 'ok' }),
    } as unknown as PolicyPrecheckService;
    const runStream = createRunStreamMock();

    (mockToolRegistry.dispatch as jest.Mock).mockResolvedValue({
      success: true,
      unsignedTxBase64: 'spl-transfer-tx',
      simulationResult: { fee: 5000, outAmount: 10_000_000, priceImpact: '0.00%' },
      stepEvent: { node: 'build_transaction', status: 'success', label: 'Transfer prepared' },
    });

    const service = new AgentService(txAssembler, policyPrecheck, runStream, mockLlmService, mockSolanaService, mockRouteSelectorService, mockToolRegistry);

    (parseIntentNode as jest.Mock).mockResolvedValue({
      action: 'transfer',
      amountLamports: 10_000_000,
      protocol: 'spl_transfer',
      recipientPubkey: 'EP4C7RTzhTPqTZZ8fUzfSu443QawGfDUDYjKgWFPfBfZ',
      steps: [{ type: 'step', node: 'parse_intent', status: 'success', label: 'parsed' }],
    });

    const result = await service.executeAgent(
      'transfer 0.01 SOL to EP4C7RTzhTPqTZZ8fUzfSu443QawGfDUDYjKgWFPfBfZ',
      '11111111111111111111111111111111',
    );

    expect(mockToolRegistry.dispatch).toHaveBeenCalledWith(
      'transfer',
      expect.any(Object),
      expect.any(Object),
    );
    expect(result.unsignedTx).toBe('spl-transfer-tx');
    expect(result.rejection).toBeUndefined();
  });

  it('rejects with agent_execution when pubkey is invalid', async () => {
    const txAssembler = {
      assembleTransaction: jest.fn(),
      simulateUnsignedTx: jest.fn(),
    } as unknown as TxAssemblerService;
    const policyPrecheck = {
      precheck: jest.fn(),
    } as unknown as PolicyPrecheckService;
    const runStream = createRunStreamMock();

    const service = new AgentService(txAssembler, policyPrecheck, runStream, mockLlmService, mockSolanaService, mockRouteSelectorService, mockToolRegistry);

    (parseIntentNode as jest.Mock).mockResolvedValue({
      action: 'swap',
      amountLamports: 100000000,
      protocol: 'jupiter',
      steps: [{ type: 'step', node: 'parse_intent', status: 'success', label: 'parsed' }],
    });

    const result = await service.executeAgent('swap 0.1 SOL to USDC', 'not-a-valid-solana-pubkey');

    expect(policyPrecheck.precheck).not.toHaveBeenCalled();
    expect(txAssembler.assembleTransaction).not.toHaveBeenCalled();
    expect(result.rejection?.policyField).toBe('agent_execution');
  });

  it('returns structured rejection when policy precheck service throws', async () => {
    const error = new Error('policy vault fetch failed');
    const txAssembler = {
      assembleTransaction: jest.fn().mockResolvedValue('should-not-be-used'),
      simulateUnsignedTx: jest.fn().mockResolvedValue({ fee: 7000 }),
    } as unknown as TxAssemblerService;
    const policyPrecheck = {
      precheck: jest.fn().mockRejectedValue(error),
    } as unknown as PolicyPrecheckService;
    const runStream = createRunStreamMock();

    const service = new AgentService(txAssembler, policyPrecheck, runStream, mockLlmService, mockSolanaService, mockRouteSelectorService, mockToolRegistry);

    (parseIntentNode as jest.Mock).mockResolvedValue({
      action: 'swap',
      amountLamports: 100000000,
      protocol: 'jupiter',
      steps: [
        { type: 'step', node: 'parse_intent', status: 'success', label: 'parsed' },
      ],
    });

    const result = await service.executeAgent('swap 0.1 SOL to USDC', '11111111111111111111111111111111');

    expect(buildTransactionNode).not.toHaveBeenCalled();
    expect(txAssembler.assembleTransaction).not.toHaveBeenCalled();
    expect(result.rejection).toEqual({
      reason: `Policy precheck failed: ${error.message}`,
      policyField: 'policy_fetch',
    });
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          node: 'validate_policy',
          status: 'rejected',
          label: expect.stringContaining(error.message),
        }),
      ]),
    );
  });

  it('writes run_started, message_user, step_emitted, and run_completed events in order', async () => {
    const txAssembler = {
      assembleTransaction: jest.fn().mockResolvedValue('assembled-tx'),
      simulateUnsignedTx: jest.fn().mockResolvedValue({ fee: 7000 }),
    } as unknown as TxAssemblerService;
    const policyPrecheck = {
      precheck: jest.fn().mockResolvedValue({
        allowed: true,
        reason: 'Policy precheck passed.',
      }),
    } as unknown as PolicyPrecheckService;
    const runStream = createRunStreamMock();
    const historyEvents = createHistoryEventsMock();
    const historyProjection = createHistoryProjectionMock();

    (historyEvents.append as jest.Mock)
      .mockResolvedValueOnce({ runId: 'run-1', pubkey: 'pk', seq: 1, eventType: 'run_started', createdAt: new Date('2026-02-28T12:00:00.000Z') })
      .mockResolvedValueOnce({ runId: 'run-1', pubkey: 'pk', seq: 2, eventType: 'message_user', createdAt: new Date('2026-02-28T12:00:01.000Z') })
      .mockResolvedValueOnce({ runId: 'run-1', pubkey: 'pk', seq: 3, eventType: 'step_emitted', createdAt: new Date('2026-02-28T12:00:02.000Z') })
      .mockResolvedValueOnce({ runId: 'run-1', pubkey: 'pk', seq: 4, eventType: 'step_emitted', createdAt: new Date('2026-02-28T12:00:03.000Z') })
      .mockResolvedValueOnce({ runId: 'run-1', pubkey: 'pk', seq: 5, eventType: 'step_emitted', createdAt: new Date('2026-02-28T12:00:04.000Z') })
      .mockResolvedValueOnce({ runId: 'run-1', pubkey: 'pk', seq: 6, eventType: 'step_emitted', createdAt: new Date('2026-02-28T12:00:05.000Z') })
      // select_route step (added by selectRouteNode mock)
      .mockResolvedValueOnce({ runId: 'run-1', pubkey: 'pk', seq: 7, eventType: 'step_emitted', createdAt: new Date('2026-02-28T12:00:06.000Z') })
      .mockResolvedValueOnce({ runId: 'run-1', pubkey: 'pk', seq: 8, eventType: 'step_emitted', createdAt: new Date('2026-02-28T12:00:07.000Z') })
      .mockResolvedValueOnce({ runId: 'run-1', pubkey: 'pk', seq: 9, eventType: 'run_completed', createdAt: new Date('2026-02-28T12:00:08.000Z') });

    const service = new (AgentService as any)(
      txAssembler,
      policyPrecheck,
      runStream,
      mockLlmService,
      mockSolanaService,
      mockRouteSelectorService,
      mockToolRegistry,
      historyEvents,
      historyProjection,
    ) as AgentService;

    (parseIntentNode as jest.Mock).mockResolvedValue({
      action: 'swap',
      amountLamports: 100000000,
      protocol: 'jupiter',
      steps: [{ type: 'step', node: 'parse_intent', status: 'success', label: 'parsed' }],
    });
    (buildTransactionNode as jest.Mock).mockResolvedValue({
      jupiterInstructions: { swapTransaction: 'jupiter-tx' },
      steps: [{ type: 'step', node: 'build_transaction', status: 'success', label: 'built' }],
    });

    await service.executeAgent('swap 0.1 SOL to USDC', '11111111111111111111111111111111');
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(historyEvents.append).toHaveBeenNthCalledWith(1, expect.objectContaining({ type: 'run_started' }));
    expect(historyEvents.append).toHaveBeenNthCalledWith(2, expect.objectContaining({ type: 'message_user' }));
    expect(historyEvents.append).toHaveBeenCalledWith(expect.objectContaining({ type: 'step_emitted' }));
    expect(historyEvents.append).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'run_completed' }));
    expect(historyProjection.project).toHaveBeenCalledTimes((historyEvents.append as jest.Mock).mock.calls.length);
  });

  it('writes run_rejected as the terminal event when execution is rejected', async () => {
    const txAssembler = {
      assembleTransaction: jest.fn(),
      simulateUnsignedTx: jest.fn(),
    } as unknown as TxAssemblerService;
    const policyPrecheck = {
      precheck: jest.fn().mockResolvedValue({
        allowed: false,
        rejectionField: 'daily_max',
        reason: 'Daily max exceeded',
      }),
    } as unknown as PolicyPrecheckService;
    const runStream = createRunStreamMock();
    const historyEvents = createHistoryEventsMock();
    const historyProjection = createHistoryProjectionMock();

    (historyEvents.append as jest.Mock)
      .mockResolvedValueOnce({ runId: 'run-2', pubkey: 'pk', seq: 1, eventType: 'run_started', createdAt: new Date('2026-02-28T12:10:00.000Z') })
      .mockResolvedValueOnce({ runId: 'run-2', pubkey: 'pk', seq: 2, eventType: 'message_user', createdAt: new Date('2026-02-28T12:10:01.000Z') })
      .mockResolvedValueOnce({ runId: 'run-2', pubkey: 'pk', seq: 3, eventType: 'step_emitted', createdAt: new Date('2026-02-28T12:10:02.000Z') })
      .mockResolvedValueOnce({ runId: 'run-2', pubkey: 'pk', seq: 4, eventType: 'step_emitted', createdAt: new Date('2026-02-28T12:10:03.000Z') })
      .mockResolvedValueOnce({ runId: 'run-2', pubkey: 'pk', seq: 5, eventType: 'run_rejected', createdAt: new Date('2026-02-28T12:10:04.000Z') });

    const service = new (AgentService as any)(
      txAssembler,
      policyPrecheck,
      runStream,
      mockLlmService,
      mockSolanaService,
      mockRouteSelectorService,
      mockToolRegistry,
      historyEvents,
      historyProjection,
    ) as AgentService;

    (parseIntentNode as jest.Mock).mockResolvedValue({
      action: 'swap',
      amountLamports: 100000000,
      protocol: 'jupiter',
      steps: [{ type: 'step', node: 'parse_intent', status: 'success', label: 'parsed' }],
    });

    await service.executeAgent('swap 0.1 SOL to USDC', '11111111111111111111111111111111');
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(historyEvents.append).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'run_rejected' }));
    expect(historyEvents.append).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'run_completed' }));
  });

  it('emits stream step and complete events while executing', async () => {
    const txAssembler = {
      assembleTransaction: jest.fn().mockResolvedValue('assembled-tx'),
      simulateUnsignedTx: jest.fn().mockResolvedValue({ fee: 7000 }),
    } as unknown as TxAssemblerService;
    const policyPrecheck = {
      precheck: jest.fn().mockResolvedValue({
        allowed: true,
        reason: 'Policy precheck passed.',
      }),
    } as unknown as PolicyPrecheckService;
    const runStream = createRunStreamMock();

    const service = new AgentService(txAssembler, policyPrecheck, runStream, mockLlmService, mockSolanaService, mockRouteSelectorService, mockToolRegistry);

    const parseStep = {
      type: 'step',
      node: 'parse_intent',
      status: 'success',
      label: 'parsed',
    };
    const buildStep = {
      type: 'step',
      node: 'build_transaction',
      status: 'success',
      label: 'built',
    };

    (parseIntentNode as jest.Mock).mockResolvedValue({
      action: 'swap',
      amountLamports: 100000000,
      protocol: 'jupiter',
      steps: [parseStep],
    });

    const synthStep = {
      type: 'step',
      node: 'synthesize_response',
      status: 'success',
      label: 'Generated response',
    };
    (synthesizeResponseNode as jest.Mock).mockResolvedValue({
      agentMessage: 'Swapped 0.1 SOL for USDC',
      steps: [synthStep],
    });
    (buildTransactionNode as jest.Mock).mockResolvedValue({
      jupiterInstructions: { swapTransaction: 'jupiter-tx' },
      steps: [buildStep],
    });

    const result = await service.executeAgent(
      'swap 0.1 SOL to USDC',
      '11111111111111111111111111111111',
    );
    const runId = result.runId;

    expect(runStream.createRun).toHaveBeenCalledWith(runId);
    expect(runStream.emitStep).toHaveBeenCalledWith(runId, parseStep);
    expect(runStream.emitStep).toHaveBeenCalledWith(
      runId,
      expect.objectContaining({ node: 'plan_actions', status: 'success' }),
    );
    expect(runStream.emitStep).toHaveBeenCalledWith(
      runId,
      expect.objectContaining({ node: 'validate_policy', status: 'success' }),
    );
    expect(runStream.emitStep).toHaveBeenCalledWith(
      runId,
      expect.objectContaining({ node: 'tool_executor', status: 'running' }),
    );
    // Tool dispatch result step
    expect(runStream.emitStep).toHaveBeenCalledWith(
      runId,
      expect.objectContaining({ node: 'build_transaction', status: 'success' }),
    );
    expect(runStream.emitStep).toHaveBeenCalledWith(runId, synthStep);
    expect(runStream.emitComplete).toHaveBeenCalledWith(runId, result);
  });

  it('does not block step emission when startup lifecycle persistence is slow', async () => {
    let releaseStartupPersistence: (() => void) | undefined;
    const startupPersistenceGate = new Promise<void>((resolve) => {
      releaseStartupPersistence = resolve;
    });

    const txAssembler = {
      assembleTransaction: jest.fn().mockResolvedValue('assembled-tx'),
      simulateUnsignedTx: jest.fn().mockResolvedValue({ fee: 7000 }),
    } as unknown as TxAssemblerService;
    const policyPrecheck = {
      precheck: jest.fn().mockResolvedValue({
        allowed: true,
        reason: 'Policy precheck passed.',
      }),
    } as unknown as PolicyPrecheckService;
    const runStream = createRunStreamMock();
    const historyEvents = createHistoryEventsMock();
    const historyProjection = createHistoryProjectionMock();

    (historyEvents.append as jest.Mock).mockImplementation(({ runId, pubkey, type, payload }) => {
      if (type === 'run_started' || type === 'message_user') {
        return startupPersistenceGate.then(() => ({
          runId,
          pubkey,
          seq: type === 'run_started' ? 1 : 2,
          eventType: type,
          createdAt: new Date('2026-02-28T12:00:00.000Z'),
          payload,
        }));
      }

      return Promise.resolve({
        runId,
        pubkey,
        seq: 3,
        eventType: type,
        createdAt: new Date('2026-02-28T12:00:00.000Z'),
        payload,
      });
    });

    const service = new (AgentService as any)(
      txAssembler,
      policyPrecheck,
      runStream,
      mockLlmService,
      mockSolanaService,
      mockRouteSelectorService,
      mockToolRegistry,
      historyEvents,
      historyProjection,
    ) as AgentService;

    const parseStep = {
      type: 'step',
      node: 'parse_intent',
      status: 'success',
      label: 'parsed',
    };

    (parseIntentNode as jest.Mock).mockResolvedValue({
      action: 'swap',
      amountLamports: 100000000,
      protocol: 'jupiter',
      steps: [parseStep],
    });
    (buildTransactionNode as jest.Mock).mockResolvedValue({
      jupiterInstructions: { swapTransaction: 'jupiter-tx' },
      steps: [],
    });

    const runPromise = service.executeAgent('swap 0.1 SOL to USDC', '11111111111111111111111111111111');
    const runId = (runStream.createRun as jest.Mock).mock.calls[0][0];

    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(runStream.emitStep).toHaveBeenCalledWith(runId, parseStep);

    releaseStartupPersistence?.();
    await runPromise;
  });

  it('queues lifecycle persistence per run while keeping stream emission non-blocking', async () => {
    let releaseStartupPersistence: (() => void) | undefined;
    const startupPersistenceGate = new Promise<void>((resolve) => {
      releaseStartupPersistence = resolve;
    });

    const txAssembler = {
      assembleTransaction: jest.fn().mockResolvedValue('assembled-tx'),
      simulateUnsignedTx: jest.fn().mockResolvedValue({ fee: 7000 }),
    } as unknown as TxAssemblerService;
    const policyPrecheck = {
      precheck: jest.fn().mockResolvedValue({
        allowed: true,
        reason: 'Policy precheck passed.',
      }),
    } as unknown as PolicyPrecheckService;
    const runStream = createRunStreamMock();
    const historyEvents = createHistoryEventsMock();
    const historyProjection = createHistoryProjectionMock();
    const persistedTypes: string[] = [];

    (historyEvents.append as jest.Mock).mockImplementation(async ({ runId, pubkey, type, payload }) => {
      if (type === 'run_started') {
        await startupPersistenceGate;
      }

      persistedTypes.push(type);

      return {
        runId,
        pubkey,
        seq: persistedTypes.length,
        eventType: type,
        createdAt: new Date('2026-02-28T12:00:00.000Z'),
        payload,
      };
    });

    const service = new (AgentService as any)(
      txAssembler,
      policyPrecheck,
      runStream,
      mockLlmService,
      mockSolanaService,
      mockRouteSelectorService,
      mockToolRegistry,
      historyEvents,
      historyProjection,
    ) as AgentService;

    const parseStep = {
      type: 'step',
      node: 'parse_intent',
      status: 'success',
      label: 'parsed',
    };

    (parseIntentNode as jest.Mock).mockResolvedValue({
      action: 'swap',
      amountLamports: 100000000,
      protocol: 'jupiter',
      steps: [parseStep],
    });
    (buildTransactionNode as jest.Mock).mockResolvedValue({
      jupiterInstructions: { swapTransaction: 'jupiter-tx' },
      steps: [],
    });

    const runPromise = service.executeAgent('swap 0.1 SOL to USDC', '11111111111111111111111111111111');
    const runId = (runStream.createRun as jest.Mock).mock.calls[0][0];

    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(runStream.emitStep).toHaveBeenCalledWith(runId, parseStep);
    expect(persistedTypes).toEqual([]);

    releaseStartupPersistence?.();
    await runPromise;
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(persistedTypes[0]).toBe('run_started');
    expect(persistedTypes[1]).toBe('message_user');
    expect(persistedTypes).toContain('step_emitted');
    expect(persistedTypes[persistedTypes.length - 1]).toBe('run_completed');
  });

  it('emits stream step before slow lifecycle persistence resolves', async () => {
    let releaseStepPersistence: (() => void) | undefined;
    const stepPersistenceGate = new Promise<void>((resolve) => {
      releaseStepPersistence = resolve;
    });

    const txAssembler = {
      assembleTransaction: jest.fn().mockResolvedValue('assembled-tx'),
      simulateUnsignedTx: jest.fn().mockResolvedValue({ fee: 7000 }),
    } as unknown as TxAssemblerService;
    const policyPrecheck = {
      precheck: jest.fn().mockResolvedValue({
        allowed: true,
        reason: 'Policy precheck passed.',
      }),
    } as unknown as PolicyPrecheckService;
    const runStream = createRunStreamMock();
    const historyEvents = createHistoryEventsMock();
    const historyProjection = createHistoryProjectionMock();

    (historyEvents.append as jest.Mock).mockImplementation(({ runId, pubkey, type, payload }) => {
      if (type === 'step_emitted' && payload?.step?.node === 'parse_intent') {
        return stepPersistenceGate.then(() => ({
          runId,
          pubkey,
          seq: 3,
          eventType: type,
          createdAt: new Date('2026-02-28T12:00:00.000Z'),
          payload,
        }));
      }

      return Promise.resolve({
        runId,
        pubkey,
        seq: 1,
        eventType: type,
        createdAt: new Date('2026-02-28T12:00:00.000Z'),
        payload,
      });
    });

    const service = new (AgentService as any)(
      txAssembler,
      policyPrecheck,
      runStream,
      mockLlmService,
      mockSolanaService,
      mockRouteSelectorService,
      mockToolRegistry,
      historyEvents,
      historyProjection,
    ) as AgentService;

    const parseStep = {
      type: 'step',
      node: 'parse_intent',
      status: 'success',
      label: 'parsed',
    };

    (parseIntentNode as jest.Mock).mockResolvedValue({
      action: 'swap',
      amountLamports: 100000000,
      protocol: 'jupiter',
      steps: [parseStep],
    });
    (buildTransactionNode as jest.Mock).mockResolvedValue({
      jupiterInstructions: { swapTransaction: 'jupiter-tx' },
      steps: [],
    });

    const runPromise = service.executeAgent('swap 0.1 SOL to USDC', '11111111111111111111111111111111');
    const runId = (runStream.createRun as jest.Mock).mock.calls[0][0];

    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(runStream.emitStep).toHaveBeenCalledWith(runId, parseStep);

    releaseStepPersistence?.();
    await runPromise;
  });

  it('emits stream completion before slow terminal lifecycle persistence resolves', async () => {
    let releaseTerminalPersistence: (() => void) | undefined;
    const terminalPersistenceGate = new Promise<void>((resolve) => {
      releaseTerminalPersistence = resolve;
    });

    const txAssembler = {
      assembleTransaction: jest.fn().mockResolvedValue('assembled-tx'),
      simulateUnsignedTx: jest.fn().mockResolvedValue({ fee: 7000 }),
    } as unknown as TxAssemblerService;
    const policyPrecheck = {
      precheck: jest.fn().mockResolvedValue({
        allowed: true,
        reason: 'Policy precheck passed.',
      }),
    } as unknown as PolicyPrecheckService;
    const runStream = createRunStreamMock();
    const historyEvents = createHistoryEventsMock();
    const historyProjection = createHistoryProjectionMock();

    (historyEvents.append as jest.Mock).mockImplementation(({ runId, pubkey, type, payload }) => {
      if (type === 'run_completed') {
        return terminalPersistenceGate.then(() => ({
          runId,
          pubkey,
          seq: 5,
          eventType: type,
          createdAt: new Date('2026-02-28T12:00:10.000Z'),
          payload,
        }));
      }

      return Promise.resolve({
        runId,
        pubkey,
        seq: 1,
        eventType: type,
        createdAt: new Date('2026-02-28T12:00:00.000Z'),
        payload,
      });
    });

    const service = new (AgentService as any)(
      txAssembler,
      policyPrecheck,
      runStream,
      mockLlmService,
      mockSolanaService,
      mockRouteSelectorService,
      mockToolRegistry,
      historyEvents,
      historyProjection,
    ) as AgentService;

    (parseIntentNode as jest.Mock).mockResolvedValue({
      action: 'swap',
      amountLamports: 100000000,
      protocol: 'jupiter',
      steps: [],
    });
    (buildTransactionNode as jest.Mock).mockResolvedValue({
      jupiterInstructions: { swapTransaction: 'jupiter-tx' },
      steps: [],
    });

    const runPromise = service.executeAgent('swap 0.1 SOL to USDC', '11111111111111111111111111111111');
    const runId = (runStream.createRun as jest.Mock).mock.calls[0][0];

    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(runStream.emitComplete).toHaveBeenCalledWith(
      runId,
      expect.objectContaining({
        runId,
      }),
    );

    releaseTerminalPersistence?.();
    await runPromise;
  });

  it('finalizes stream with rejection when a graph node throws unexpectedly', async () => {
    const txAssembler = {
      assembleTransaction: jest.fn().mockResolvedValue('assembled-tx'),
      simulateUnsignedTx: jest.fn().mockResolvedValue({ fee: 7000 }),
    } as unknown as TxAssemblerService;
    const policyPrecheck = {
      precheck: jest.fn().mockResolvedValue({
        allowed: true,
        reason: 'Policy precheck passed.',
      }),
    } as unknown as PolicyPrecheckService;
    const runStream = createRunStreamMock();

    const service = new AgentService(txAssembler, policyPrecheck, runStream, mockLlmService, mockSolanaService, mockRouteSelectorService, mockToolRegistry);

    (parseIntentNode as jest.Mock).mockRejectedValue(new Error('parse exploded'));

    const result = await service.executeAgent(
      'swap 0.1 SOL to USDC',
      '11111111111111111111111111111111',
    );

    expect(result).toEqual(
      expect.objectContaining({
        rejection: {
          reason: 'Agent execution failed: parse exploded',
          policyField: 'agent_execution',
        },
      }),
    );

    expect(runStream.emitComplete).toHaveBeenCalledWith(
      result.runId,
      expect.objectContaining({
        rejection: {
          reason: 'Agent execution failed: parse exploded',
          policyField: 'agent_execution',
        },
      }),
    );
  });

  it('startAgentRun returns run id immediately and executes in background', async () => {
    let resolveParse: ((value: unknown) => void) | undefined;
    const parsePromise = new Promise((resolve) => {
      resolveParse = resolve;
    });

    const txAssembler = {
      assembleTransaction: jest.fn().mockResolvedValue('should-not-be-used'),
      simulateUnsignedTx: jest.fn().mockResolvedValue({ fee: 7000 }),
    } as unknown as TxAssemblerService;
    const policyPrecheck = {
      precheck: jest.fn(),
    } as unknown as PolicyPrecheckService;
    const runStream = createRunStreamMock();

    const service = new AgentService(txAssembler, policyPrecheck, runStream, mockLlmService, mockSolanaService, mockRouteSelectorService, mockToolRegistry);

    (parseIntentNode as jest.Mock).mockReturnValue(parsePromise);

    const initial = service.startAgentRun(
      'swap 0.1 SOL to USDC',
      '11111111111111111111111111111111',
    );
    const runId = initial.runId;

    expect(initial).toEqual({ runId, steps: [] });
    expect(runStream.createRun).toHaveBeenCalledWith(runId);
    expect(runStream.emitComplete).not.toHaveBeenCalled();
    expect(policyPrecheck.precheck).not.toHaveBeenCalled();

    resolveParse?.({
      rejectionReason: 'Rejected during parse',
      rejectionField: 'intent',
      steps: [
        {
          type: 'step',
          node: 'parse_intent',
          status: 'rejected',
          label: 'bad intent',
        },
      ],
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(runStream.emitComplete).toHaveBeenCalledWith(
      runId,
      expect.objectContaining({
        runId,
        steps: expect.arrayContaining([
          expect.objectContaining({ node: 'parse_intent', status: 'rejected' }),
        ]),
        rejection: {
          reason: 'Rejected during parse',
          policyField: 'intent',
        },
      }),
    );
  });
});
