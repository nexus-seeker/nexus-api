import { PolicyPrecheckService } from './policy-precheck.service';
import { SolanaService } from '../solana/solana.service';

describe('PolicyPrecheckService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects when policy vault is missing', async () => {
    const solanaService = {
      fetchPolicyVault: jest.fn().mockResolvedValue(null),
    } as unknown as SolanaService;

    const service = new PolicyPrecheckService(solanaService);
    const result = await service.precheck({
      pubkey: '11111111111111111111111111111111',
      amountLamports: 100,
      protocol: 'jupiter',
      nowTs: 1_700_000_000,
    });

    expect(result.allowed).toBe(false);
    expect(result.rejectionField).toBe('policy_missing');
    expect(result.reason).toBe('Policy not initialized. Initialize policy vault first.');
  });

  it('resets effective spend when daily window has elapsed', async () => {
    const solanaService = {
      fetchPolicyVault: jest.fn().mockResolvedValue({
        dailyMaxLamports: 1_000,
        currentSpend: 900,
        lastResetTs: 1_600_000_000,
        allowedProtocols: ['jupiter'],
        isActive: true,
      }),
    } as unknown as SolanaService;

    const service = new PolicyPrecheckService(solanaService);
    const result = await service.precheck({
      pubkey: '11111111111111111111111111111111',
      amountLamports: 200,
      protocol: 'jupiter',
      nowTs: 1_600_086_401,
    });

    expect(result.allowed).toBe(true);
    expect(result.effectiveSpendLamports).toBe(0);
    expect(result.projectedSpendLamports).toBe(200);
  });

  it('rejects when policy is inactive', async () => {
    const solanaService = {
      fetchPolicyVault: jest.fn().mockResolvedValue({
        dailyMaxLamports: 1_000,
        currentSpend: 0,
        lastResetTs: 1_700_000_000,
        allowedProtocols: ['jupiter'],
        isActive: false,
      }),
    } as unknown as SolanaService;

    const service = new PolicyPrecheckService(solanaService);
    const result = await service.precheck({
      pubkey: '11111111111111111111111111111111',
      amountLamports: 100,
      protocol: 'jupiter',
      nowTs: 1_700_000_100,
    });

    expect(result.allowed).toBe(false);
    expect(result.rejectionField).toBe('policy_active');
    expect(result.reason).toBe('Policy is inactive. Activate your policy to continue.');
  });

  it('rejects when protocol is not allowed', async () => {
    const solanaService = {
      fetchPolicyVault: jest.fn().mockResolvedValue({
        dailyMaxLamports: 1_000,
        currentSpend: 0,
        lastResetTs: 1_700_000_000,
        allowedProtocols: ['spl_transfer'],
        isActive: true,
      }),
    } as unknown as SolanaService;

    const service = new PolicyPrecheckService(solanaService);
    const result = await service.precheck({
      pubkey: '11111111111111111111111111111111',
      amountLamports: 100,
      protocol: 'jupiter',
      nowTs: 1_700_000_100,
    });

    expect(result.allowed).toBe(false);
    expect(result.rejectionField).toBe('allowed_protocols');
    expect(result.reason).toBe('Protocol "jupiter" is not allowed by your policy.');
  });

  it('rejects when daily max would be exceeded', async () => {
    const solanaService = {
      fetchPolicyVault: jest.fn().mockResolvedValue({
        dailyMaxLamports: 1_000,
        currentSpend: 950,
        lastResetTs: 1_700_000_000,
        allowedProtocols: ['jupiter'],
        isActive: true,
      }),
    } as unknown as SolanaService;

    const service = new PolicyPrecheckService(solanaService);
    const result = await service.precheck({
      pubkey: '11111111111111111111111111111111',
      amountLamports: 100,
      protocol: 'jupiter',
      nowTs: 1_700_000_100,
    });

    expect(result.allowed).toBe(false);
    expect(result.rejectionField).toBe('daily_max_lamports');
    expect(result.reason).toBe('Daily spending limit exceeded for this policy window.');
    expect(result.effectiveSpendLamports).toBe(950);
    expect(result.projectedSpendLamports).toBe(1_050);
  });
});
