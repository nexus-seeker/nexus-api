jest.mock('./agent.service', () => ({
  AgentService: class AgentService {},
}));

import { AgentController } from './agent.controller';

describe('AgentController execute', () => {
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
});
