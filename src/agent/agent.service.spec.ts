import { AgentService } from './agent.service';
import { TxAssemblerService } from './tx-assembler.service';
import { PolicyPrecheckService } from './policy-precheck.service';
import { RunStreamService } from './run-stream.service';
import {
  parseIntentNode,
  buildTransactionNode,
  assembleTxNode,
} from './graph';

jest.mock('uuid', () => ({
  v4: jest.fn(() => 'run-id'),
}));

jest.mock('./graph', () => ({
  parseIntentNode: jest.fn(),
  buildTransactionNode: jest.fn(),
  assembleTxNode: jest.fn(),
}));

describe('AgentService', () => {
  const createRunStreamMock = () => ({
    createRun: jest.fn(),
    emitStep: jest.fn(),
    emitComplete: jest.fn(),
  }) as unknown as RunStreamService;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([undefined, ''])(
    'rejects tx_assembly when assembler returns %p',
    async (assembledTx) => {
      const txAssembler = {
        assembleTransaction: jest.fn().mockResolvedValue(assembledTx),
      } as unknown as TxAssemblerService;
      const policyPrecheck = {
        precheck: jest.fn().mockResolvedValue({
          allowed: true,
          reason: 'Policy precheck passed.',
        }),
      } as unknown as PolicyPrecheckService;
      const runStream = createRunStreamMock();

      const service = new AgentService(txAssembler, policyPrecheck, runStream);

      (parseIntentNode as jest.Mock).mockResolvedValue({
        action: 'swap',
        amountLamports: 100000000,
        protocol: 'jupiter',
        steps: [
          { type: 'step', node: 'parse_intent', status: 'success', label: 'parsed' },
        ],
      });
      (buildTransactionNode as jest.Mock).mockResolvedValue({
        jupiterInstructions: { swapTransaction: 'jupiter-tx' },
        steps: [
          {
            type: 'step',
            node: 'build_transaction',
            status: 'success',
            label: 'built',
          },
        ],
      });

      const result = await service.executeAgent(
        'swap 0.1 SOL to USDC',
        '11111111111111111111111111111111',
      );

      expect(result.unsignedTx).toBeUndefined();
      expect(result.rejection?.policyField).toBe('tx_assembly');
      expect(result.steps).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            node: 'assemble_tx',
            status: 'rejected',
          }),
        ]),
      );
    },
  );

  it('rejects tx_assembly when build node omits jupiterInstructions', async () => {
    const txAssembler = {
      assembleTransaction: jest.fn().mockResolvedValue('should-not-be-used'),
    } as unknown as TxAssemblerService;
    const policyPrecheck = {
      precheck: jest.fn().mockResolvedValue({
        allowed: true,
        reason: 'Policy precheck passed.',
      }),
    } as unknown as PolicyPrecheckService;
    const runStream = createRunStreamMock();

    const service = new AgentService(txAssembler, policyPrecheck, runStream);

    (parseIntentNode as jest.Mock).mockResolvedValue({
      action: 'swap',
      amountLamports: 100000000,
      protocol: 'jupiter',
      steps: [
        { type: 'step', node: 'parse_intent', status: 'success', label: 'parsed' },
      ],
    });
    (buildTransactionNode as jest.Mock).mockResolvedValue({
      steps: [
        {
          type: 'step',
          node: 'build_transaction',
          status: 'success',
          label: 'built',
        },
      ],
    });

    const result = await service.executeAgent(
      'swap 0.1 SOL to USDC',
      '11111111111111111111111111111111',
    );

    expect(txAssembler.assembleTransaction).not.toHaveBeenCalled();
    expect(result.unsignedTx).toBeUndefined();
    expect(result.rejection?.policyField).toBe('tx_assembly');
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          node: 'assemble_tx',
          status: 'rejected',
        }),
      ]),
    );
  });

  it('rejects tx_assembly failures without falling back to assembleTxNode', async () => {
    const txAssembler = {
      assembleTransaction: jest.fn().mockRejectedValue(new Error('assembler down')),
    } as unknown as TxAssemblerService;
    const policyPrecheck = {
      precheck: jest.fn().mockResolvedValue({
        allowed: true,
        reason: 'Policy precheck passed.',
      }),
    } as unknown as PolicyPrecheckService;
    const runStream = createRunStreamMock();

    const service = new AgentService(txAssembler, policyPrecheck, runStream);

    (parseIntentNode as jest.Mock).mockResolvedValue({
      action: 'swap',
      amountLamports: 100000000,
      protocol: 'jupiter',
      steps: [
        { type: 'step', node: 'parse_intent', status: 'success', label: 'parsed' },
      ],
    });
    (buildTransactionNode as jest.Mock).mockResolvedValue({
      jupiterInstructions: { swapTransaction: 'fallback-unsigned-tx' },
      steps: [
        {
          type: 'step',
          node: 'build_transaction',
          status: 'success',
          label: 'built',
        },
      ],
    });
    (assembleTxNode as jest.Mock).mockResolvedValue({
      unsignedTxBase64: 'fallback-unsigned-tx',
      steps: [
        { type: 'step', node: 'assemble_tx', status: 'success', label: 'fallback' },
      ],
    });

    const result = await service.executeAgent(
      'swap 0.1 SOL to USDC',
      '11111111111111111111111111111111',
    );

    expect(assembleTxNode).not.toHaveBeenCalled();
    expect(result.unsignedTx).toBeUndefined();
    expect(result.rejection).toEqual({
      reason: 'Tx assembly failed: assembler down',
      policyField: 'tx_assembly',
    });
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          node: 'assemble_tx',
          status: 'rejected',
        }),
      ]),
    );
  });

  it('rejects before tx build when policy precheck fails', async () => {
    const txAssembler = {
      assembleTransaction: jest.fn().mockResolvedValue('should-not-be-used'),
    } as unknown as TxAssemblerService;
    const policyPrecheck = {
      precheck: jest.fn().mockResolvedValue({
        allowed: false,
        rejectionField: 'daily_max_lamports',
        reason: 'Daily spending limit exceeded for this policy window.',
      }),
    } as unknown as PolicyPrecheckService;
    const runStream = createRunStreamMock();

    const service = new AgentService(txAssembler, policyPrecheck, runStream);

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
    expect(result.rejection).toEqual({
      reason: 'Daily spending limit exceeded for this policy window.',
      policyField: 'daily_max_lamports',
    });
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          node: 'validate_policy',
          status: 'rejected',
          label: expect.stringContaining('Daily spending limit exceeded'),
        }),
      ]),
    );
  });

  it('rejects before tx build when policy vault is missing', async () => {
    const txAssembler = {
      assembleTransaction: jest.fn().mockResolvedValue('should-not-be-used'),
    } as unknown as TxAssemblerService;
    const policyPrecheck = {
      precheck: jest.fn().mockResolvedValue({
        allowed: false,
        rejectionField: 'policy_missing',
        reason: 'Policy not initialized. Initialize policy vault first.',
      }),
    } as unknown as PolicyPrecheckService;
    const runStream = createRunStreamMock();

    const service = new AgentService(txAssembler, policyPrecheck, runStream);

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

    expect(buildTransactionNode).not.toHaveBeenCalled();
    expect(txAssembler.assembleTransaction).not.toHaveBeenCalled();
    expect(result.rejection).toEqual({
      reason: 'Policy not initialized. Initialize policy vault first.',
      policyField: 'policy_missing',
    });
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          node: 'validate_policy',
          status: 'rejected',
          label: expect.stringContaining('Policy not initialized'),
        }),
      ]),
    );
  });

  it.each([
    {
      name: 'invalid pubkey input',
      pubkey: 'not-a-valid-solana-pubkey',
      error: new Error('Invalid public key input'),
    },
    {
      name: 'policy fetch service throws',
      pubkey: '11111111111111111111111111111111',
      error: new Error('policy vault fetch failed'),
    },
  ])('returns structured rejection when precheck fails unexpectedly: $name', async ({ pubkey, error }) => {
    const txAssembler = {
      assembleTransaction: jest.fn().mockResolvedValue('should-not-be-used'),
    } as unknown as TxAssemblerService;
    const policyPrecheck = {
      precheck: jest.fn().mockRejectedValue(error),
    } as unknown as PolicyPrecheckService;
    const runStream = createRunStreamMock();

    const service = new AgentService(txAssembler, policyPrecheck, runStream);

    (parseIntentNode as jest.Mock).mockResolvedValue({
      action: 'swap',
      amountLamports: 100000000,
      protocol: 'jupiter',
      steps: [
        { type: 'step', node: 'parse_intent', status: 'success', label: 'parsed' },
      ],
    });

    const result = await service.executeAgent('swap 0.1 SOL to USDC', pubkey);

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

  it('emits stream step and complete events while executing', async () => {
    const txAssembler = {
      assembleTransaction: jest.fn().mockResolvedValue('assembled-tx'),
    } as unknown as TxAssemblerService;
    const policyPrecheck = {
      precheck: jest.fn().mockResolvedValue({
        allowed: true,
        reason: 'Policy precheck passed.',
      }),
    } as unknown as PolicyPrecheckService;
    const runStream = createRunStreamMock();

    const service = new AgentService(txAssembler, policyPrecheck, runStream);

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
    (buildTransactionNode as jest.Mock).mockResolvedValue({
      jupiterInstructions: { swapTransaction: 'jupiter-tx' },
      steps: [buildStep],
    });

    const result = await service.executeAgent(
      'swap 0.1 SOL to USDC',
      '11111111111111111111111111111111',
    );

    expect(runStream.createRun).toHaveBeenCalledWith('run-id');
    expect(runStream.emitStep).toHaveBeenCalledWith('run-id', parseStep);
    expect(runStream.emitStep).toHaveBeenCalledWith(
      'run-id',
      expect.objectContaining({ node: 'validate_policy', status: 'success' }),
    );
    expect(runStream.emitStep).toHaveBeenCalledWith('run-id', buildStep);
    expect(runStream.emitStep).toHaveBeenCalledWith(
      'run-id',
      expect.objectContaining({ node: 'assemble_tx', status: 'success' }),
    );
    expect(runStream.emitComplete).toHaveBeenCalledWith('run-id', result);
  });

  it('finalizes stream with rejection when a graph node throws unexpectedly', async () => {
    const txAssembler = {
      assembleTransaction: jest.fn().mockResolvedValue('assembled-tx'),
    } as unknown as TxAssemblerService;
    const policyPrecheck = {
      precheck: jest.fn().mockResolvedValue({
        allowed: true,
        reason: 'Policy precheck passed.',
      }),
    } as unknown as PolicyPrecheckService;
    const runStream = createRunStreamMock();

    const service = new AgentService(txAssembler, policyPrecheck, runStream);

    (parseIntentNode as jest.Mock).mockRejectedValue(new Error('parse exploded'));

    await expect(
      service.executeAgent('swap 0.1 SOL to USDC', '11111111111111111111111111111111'),
    ).resolves.toEqual(
      expect.objectContaining({
        runId: 'run-id',
        rejection: {
          reason: 'Agent execution failed: parse exploded',
          policyField: 'agent_execution',
        },
      }),
    );

    expect(runStream.emitComplete).toHaveBeenCalledWith(
      'run-id',
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
    } as unknown as TxAssemblerService;
    const policyPrecheck = {
      precheck: jest.fn(),
    } as unknown as PolicyPrecheckService;
    const runStream = createRunStreamMock();

    const service = new AgentService(txAssembler, policyPrecheck, runStream);

    (parseIntentNode as jest.Mock).mockReturnValue(parsePromise);

    const initial = service.startAgentRun(
      'swap 0.1 SOL to USDC',
      '11111111111111111111111111111111',
    );

    expect(initial).toEqual({ runId: 'run-id', steps: [] });
    expect(runStream.createRun).toHaveBeenCalledWith('run-id');
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

    await Promise.resolve();
    await Promise.resolve();

    expect(runStream.emitComplete).toHaveBeenCalledWith(
      'run-id',
      expect.objectContaining({
        runId: 'run-id',
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
