import { PolicyController } from './policy.controller';

describe('PolicyController updatePolicy', () => {
  it('throws when pubkey is missing in getPolicy', async () => {
    const policyService = {
      getPolicy: jest.fn(),
    };
    const controller = new PolicyController(policyService as any);

    await expect(controller.getPolicy('' as any)).rejects.toThrow(
      'pubkey query parameter is required',
    );
  });

  it('converts dailyMaxSOL to lamports before calling service', async () => {
    const policyService = {
      buildUpdatePolicyTx: jest.fn().mockResolvedValue('unsigned-tx'),
    };
    const controller = new PolicyController(policyService as any);

    const result = await controller.updatePolicy({
      pubkey: '11111111111111111111111111111111',
      dailyMaxSOL: 0.5,
      allowedProtocols: ['jupiter'],
      isActive: true,
    } as any);

    expect(policyService.buildUpdatePolicyTx).toHaveBeenCalledWith(
      '11111111111111111111111111111111',
      500000000,
      ['jupiter'],
      true,
    );
    expect(result).toEqual({ unsignedTx: 'unsigned-tx' });
  });

  it('prefers dailyMaxLamports when both fields are provided', async () => {
    const policyService = {
      buildUpdatePolicyTx: jest.fn().mockResolvedValue('unsigned-tx'),
    };
    const controller = new PolicyController(policyService as any);

    await controller.updatePolicy({
      pubkey: '11111111111111111111111111111111',
      dailyMaxLamports: 123,
      dailyMaxSOL: 999,
      allowedProtocols: ['jupiter'],
      isActive: true,
    });

    expect(policyService.buildUpdatePolicyTx).toHaveBeenCalledWith(
      '11111111111111111111111111111111',
      123,
      ['jupiter'],
      true,
    );
  });

  it('throws when both daily max fields are missing', async () => {
    const policyService = {
      buildUpdatePolicyTx: jest.fn().mockResolvedValue('unsigned-tx'),
    };
    const controller = new PolicyController(policyService as any);

    await expect(
      controller.updatePolicy({
        pubkey: '11111111111111111111111111111111',
        allowedProtocols: ['jupiter'],
        isActive: true,
      } as any),
    ).rejects.toThrow('dailyMaxLamports or dailyMaxSOL is required');
  });

  it('throws when numeric values are invalid', async () => {
    const policyService = {
      buildUpdatePolicyTx: jest.fn().mockResolvedValue('unsigned-tx'),
    };
    const controller = new PolicyController(policyService as any);

    await expect(
      controller.updatePolicy({
        pubkey: '11111111111111111111111111111111',
        dailyMaxSOL: Number.NaN,
        allowedProtocols: ['jupiter'],
        isActive: true,
      } as any),
    ).rejects.toThrow('dailyMaxSOL must be a finite, non-negative number');

    await expect(
      controller.updatePolicy({
        pubkey: '11111111111111111111111111111111',
        dailyMaxLamports: -1,
        allowedProtocols: ['jupiter'],
        isActive: true,
      } as any),
    ).rejects.toThrow('dailyMaxLamports must be a non-negative integer');

    await expect(
      controller.updatePolicy({
        pubkey: '11111111111111111111111111111111',
        dailyMaxLamports: 1.5,
        allowedProtocols: ['jupiter'],
        isActive: true,
      } as any),
    ).rejects.toThrow('dailyMaxLamports must be a non-negative integer');
  });
});
