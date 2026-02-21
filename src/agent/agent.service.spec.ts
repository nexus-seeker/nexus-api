import { AgentService } from './agent.service';
import { TxAssemblerService } from './tx-assembler.service';
import { PolicyPrecheckService } from './policy-precheck.service';
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

      const service = new AgentService(txAssembler, policyPrecheck);

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

    const service = new AgentService(txAssembler, policyPrecheck);

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

    const service = new AgentService(txAssembler, policyPrecheck);

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

    const service = new AgentService(txAssembler, policyPrecheck);

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
});
