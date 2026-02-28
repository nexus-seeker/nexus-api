import { BadRequestException } from '@nestjs/common';
import { ReceiptsController } from './receipts.controller';

describe('ReceiptsController', () => {
  const TEST_PUBKEY = '11111111111111111111111111111111';

  it('returns receipts for valid pubkey and limit', async () => {
    const receiptsService = {
      getReceipts: jest.fn().mockResolvedValue([]),
    };
    const controller = new ReceiptsController(receiptsService as any);

    const result = await controller.getReceipts(TEST_PUBKEY, '20');

    expect(receiptsService.getReceipts).toHaveBeenCalledWith(TEST_PUBKEY, 20);
    expect(result).toEqual({ receipts: [] });
  });

  it('throws when pubkey query parameter is missing', async () => {
    const receiptsService = {
      getReceipts: jest.fn(),
    };
    const controller = new ReceiptsController(receiptsService as any);

    await expect(controller.getReceipts('', '20')).rejects.toThrow(BadRequestException);
    expect(receiptsService.getReceipts).not.toHaveBeenCalled();
  });

  it('throws when pubkey query parameter is invalid', async () => {
    const receiptsService = {
      getReceipts: jest.fn(),
    };
    const controller = new ReceiptsController(receiptsService as any);

    await expect(controller.getReceipts('invalid-pubkey', '20')).rejects.toThrow(BadRequestException);
    expect(receiptsService.getReceipts).not.toHaveBeenCalled();
  });

  it('throws when limit is zero', async () => {
    const receiptsService = {
      getReceipts: jest.fn(),
    };
    const controller = new ReceiptsController(receiptsService as any);

    await expect(controller.getReceipts(TEST_PUBKEY, '0')).rejects.toThrow(BadRequestException);
    expect(receiptsService.getReceipts).not.toHaveBeenCalled();
  });

  it('throws when limit is not a strict positive integer', async () => {
    const receiptsService = {
      getReceipts: jest.fn(),
    };
    const controller = new ReceiptsController(receiptsService as any);

    await expect(controller.getReceipts(TEST_PUBKEY, '10.5')).rejects.toThrow(BadRequestException);
    expect(receiptsService.getReceipts).not.toHaveBeenCalled();
  });
});
