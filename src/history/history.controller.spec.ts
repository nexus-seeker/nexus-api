import { BadRequestException } from '@nestjs/common';
import { HistoryController } from './history.controller';

describe('HistoryController', () => {
  const TEST_PUBKEY = '11111111111111111111111111111111';

  it('returns ordered messages for a wallet with optional limit', async () => {
    const historyService = {
      getHistory: jest.fn().mockResolvedValue({
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            content: 'Swap 0.1 SOL to USDC',
            runId: 'run-1',
            timestamp: 1700000000000,
          },
        ],
      }),
    };
    const controller = new HistoryController(historyService as any);

    const result = await controller.getHistory(TEST_PUBKEY, '50');

    expect(historyService.getHistory).toHaveBeenCalledWith(TEST_PUBKEY, 50, undefined, undefined);
    expect(result.messages).toBeDefined();
    expect(Array.isArray(result.messages)).toBe(true);
  });

  it('passes beforeTs and beforeId cursor to service', async () => {
    const historyService = {
      getHistory: jest.fn().mockResolvedValue({ messages: [] }),
    };
    const controller = new HistoryController(historyService as any);

    await controller.getHistory(TEST_PUBKEY, '10', '1700000000000', 'msg-9');

    expect(historyService.getHistory).toHaveBeenCalledWith(TEST_PUBKEY, 10, 1700000000000, 'msg-9');
  });

  it('defaults limit to 50 when omitted', async () => {
    const historyService = {
      getHistory: jest.fn().mockResolvedValue({ messages: [] }),
    };
    const controller = new HistoryController(historyService as any);

    await controller.getHistory(TEST_PUBKEY, undefined, undefined);

    expect(historyService.getHistory).toHaveBeenCalledWith(TEST_PUBKEY, 50, undefined, undefined);
  });

  it('caps and normalizes invalid limits', async () => {
    const historyService = {
      getHistory: jest.fn().mockResolvedValue({ messages: [] }),
    };
    const controller = new HistoryController(historyService as any);

    await controller.getHistory(TEST_PUBKEY, '999', undefined);
    await controller.getHistory(TEST_PUBKEY, '0', undefined);

    expect(historyService.getHistory).toHaveBeenNthCalledWith(1, TEST_PUBKEY, 100, undefined, undefined);
    expect(historyService.getHistory).toHaveBeenNthCalledWith(2, TEST_PUBKEY, 1, undefined, undefined);
  });

  it('throws when limit is non-numeric', async () => {
    const historyService = {
      getHistory: jest.fn(),
    };
    const controller = new HistoryController(historyService as any);

    await expect(controller.getHistory(TEST_PUBKEY, '10abc')).rejects.toThrow(BadRequestException);
    expect(historyService.getHistory).not.toHaveBeenCalled();
  });

  it('throws when beforeTs is non-numeric', async () => {
    const historyService = {
      getHistory: jest.fn(),
    };
    const controller = new HistoryController(historyService as any);

    await expect(controller.getHistory(TEST_PUBKEY, '50', '1700000000000ms')).rejects.toThrow(BadRequestException);
    expect(historyService.getHistory).not.toHaveBeenCalled();
  });

  it('throws when pubkey query parameter is missing', async () => {
    const historyService = {
      getHistory: jest.fn(),
    };
    const controller = new HistoryController(historyService as any);

    await expect(controller.getHistory('', '50')).rejects.toThrow(BadRequestException);
    expect(historyService.getHistory).not.toHaveBeenCalled();
  });
});
