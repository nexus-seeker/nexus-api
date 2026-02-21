import { AgentService } from './agent.service';
import { TxAssemblerService } from './tx-assembler.service';
import {
  parseIntentNode,
  validatePolicyNode,
  buildTransactionNode,
  assembleTxNode,
} from './graph';

jest.mock('uuid', () => ({
  v4: jest.fn(() => 'run-id'),
}));

jest.mock('./graph', () => ({
  parseIntentNode: jest.fn(),
  validatePolicyNode: jest.fn(),
  buildTransactionNode: jest.fn(),
  assembleTxNode: jest.fn(),
}));

describe('AgentService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects tx_assembly failures without falling back to assembleTxNode', async () => {
    const txAssembler = {
      assembleTransaction: jest.fn().mockRejectedValue(new Error('assembler down')),
    } as unknown as TxAssemblerService;

    const service = new AgentService(txAssembler);

    (parseIntentNode as jest.Mock).mockResolvedValue({
      action: 'swap',
      amountLamports: 100000000,
      protocol: 'jupiter',
      steps: [
        { type: 'step', node: 'parse_intent', status: 'success', label: 'parsed' },
      ],
    });
    (validatePolicyNode as jest.Mock).mockResolvedValue({
      policyValid: true,
      steps: [
        { type: 'step', node: 'validate_policy', status: 'success', label: 'ok' },
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
});
