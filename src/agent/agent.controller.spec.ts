jest.mock('./agent.service', () => ({
  AgentService: class AgentService {},
}));

import { AgentController } from './agent.controller';

describe('AgentController execute', () => {
  it('returns full mock ExecuteResponse in MOCK_MODE with ordered steps', async () => {
    const previousMockMode = process.env.MOCK_MODE;
    process.env.MOCK_MODE = 'true';
    try {
      const mockResponse = {
        runId: 'mock-run-id',
        steps: [
          { node: 'parse_intent', label: 'Parsing: swap 0.1 SOL to USDC', status: 'success' },
          { node: 'validate_policy', label: 'Policy check passed', status: 'success' },
          { node: 'build_transaction', label: 'Jupiter quote built', status: 'success' },
          { node: 'assemble_tx', label: 'Transaction assembled', status: 'success' },
        ],
        unsignedTx: 'MOCK_BASE64_TX_BYTES',
        simulation: {
          fee: 5000,
          outAmount: 14230000,
          priceImpact: '0.02%',
        },
      };

      const agentService = {
        startAgentRun: jest.fn(),
        getMockResponse: jest.fn().mockReturnValue(mockResponse),
      };
      const runStream = {};
      const controller = new AgentController(agentService as any, runStream as any);

      const result = await controller.execute({
        intent: 'swap 0.1 SOL to USDC',
        pubkey: '11111111111111111111111111111111',
      });

      expect(agentService.getMockResponse).toHaveBeenCalledTimes(1);
      expect(agentService.startAgentRun).not.toHaveBeenCalled();
      expect(result).toEqual(mockResponse);
      expect(result.steps.map((step) => step.node)).toEqual([
        'parse_intent',
        'validate_policy',
        'build_transaction',
        'assemble_tx',
      ]);
    } finally {
      process.env.MOCK_MODE = previousMockMode;
    }
  });

  it('returns immediate run payload from startAgentRun', async () => {
    const agentService = {
      startAgentRun: jest.fn().mockReturnValue({ runId: 'run-id', steps: [] }),
      executeAgent: jest.fn(),
    };
    const runStream = {};
    const controller = new AgentController(agentService as any, runStream as any);

    const result = await controller.execute({
      intent: 'swap 0.1 SOL to USDC',
      pubkey: '11111111111111111111111111111111',
    });

    expect(agentService.startAgentRun).toHaveBeenCalledWith(
      'swap 0.1 SOL to USDC',
      '11111111111111111111111111111111',
    );
    expect(agentService.executeAgent).not.toHaveBeenCalled();
    expect(result).toEqual({ runId: 'run-id', steps: [] });
  });

  it('returns validation error when intent or pubkey is missing', async () => {
    const agentService = {
      startAgentRun: jest.fn(),
    };
    const runStream = {};
    const controller = new AgentController(agentService as any, runStream as any);

    await expect(controller.execute({ intent: '', pubkey: 'x' })).resolves.toEqual({
      error: 'Both intent and pubkey are required',
    });

    expect(agentService.startAgentRun).not.toHaveBeenCalled();
  });

  it('returns validation error when request body is undefined', async () => {
    const agentService = {
      startAgentRun: jest.fn(),
    };
    const runStream = {};
    const controller = new AgentController(agentService as any, runStream as any);

    await expect(controller.execute(undefined as any)).resolves.toEqual({
      error: 'Both intent and pubkey are required',
    });

    expect(agentService.startAgentRun).not.toHaveBeenCalled();
  });
});
