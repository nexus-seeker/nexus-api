import { PolicyPrecheckService } from './policy-precheck.service';
import { SolanaService } from '../solana/solana.service';

describe('PolicyPrecheckService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows when policy vault is missing', async () => {
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

    expect(result.allowed).toBe(true);
    expect(result.rejectionField).toBeUndefined();
    expect(result.reason).toBe('No policy found — proceeding without limits');
  });

  it('rejects deterministically when amountLamports is invalid', async () => {
    const solanaService = {
      fetchPolicyVault: jest.fn(),
    } as unknown as SolanaService;

    const service = new PolicyPrecheckService(solanaService);
    const result = await service.precheck({
      pubkey: '11111111111111111111111111111111',
      amountLamports: Number.NaN,
      protocol: 'jupiter',
      nowTs: 1_700_000_000,
    });

    expect(result.allowed).toBe(false);
    expect(result.rejectionField).toBe('amount_lamports');
    expect(result.reason).toBe('Invalid amountLamports: must be a finite positive integer.');
    expect(solanaService.fetchPolicyVault).not.toHaveBeenCalled();
  });

  it('rejects deterministically when pubkey is invalid', async () => {
    const solanaService = {
      fetchPolicyVault: jest.fn(),
    } as unknown as SolanaService;

    const service = new PolicyPrecheckService(solanaService);
    const result = await service.precheck({
      pubkey: 'not-a-valid-pubkey',
      amountLamports: 100,
      protocol: 'jupiter',
      nowTs: 1_700_000_000,
    });

    expect(result.allowed).toBe(false);
    expect(result.rejectionField).toBe('pubkey');
    expect(result.reason).toBe('Invalid pubkey: must be a valid Solana public key.');
    expect(solanaService.fetchPolicyVault).not.toHaveBeenCalled();
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

  it('does not reset effective spend when exactly 86400 seconds have elapsed', async () => {
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
      amountLamports: 50,
      protocol: 'jupiter',
      nowTs: 1_600_086_400,
    });

    expect(result.allowed).toBe(true);
    expect(result.effectiveSpendLamports).toBe(900);
    expect(result.projectedSpendLamports).toBe(950);
  });

  it('does not reset effective spend when 86399 seconds have elapsed', async () => {
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
      amountLamports: 50,
      protocol: 'jupiter',
      nowTs: 1_600_086_399,
    });

    expect(result.allowed).toBe(true);
    expect(result.effectiveSpendLamports).toBe(900);
    expect(result.projectedSpendLamports).toBe(950);
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
    expect(result.rejectionField).toBe('policy_inactive');
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
    expect(result.rejectionField).toBe('protocol_not_allowed');
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
    expect(result.rejectionField).toBe('daily_max');
    expect(result.reason).toContain('Daily max exceeded:');
    expect(result.reason).toContain('requested');
    expect(result.reason).toContain('cap');
    expect(result.reason).toContain('remaining');
    expect(result.reason).toContain('SOL');
    expect(result.effectiveSpendLamports).toBe(950);
    expect(result.projectedSpendLamports).toBe(1_050);
  });

  it('normalizes malformed numeric vault fields to finite non-negative values', async () => {
    const solanaService = {
      fetchPolicyVault: jest.fn().mockResolvedValue({
        dailyMaxLamports: 'not-a-number',
        currentSpend: -50,
        lastResetTs: 'bad-ts',
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
    expect(result.rejectionField).toBe('daily_max');
    expect(result.lastResetTs).toBe(0);
    expect(result.effectiveSpendLamports).toBe(0);
    expect(result.projectedSpendLamports).toBe(100);
    expect(result.dailyMaxLamports).toBe(0);
    expect(Number.isFinite(result.effectiveSpendLamports)).toBe(true);
    expect(Number.isFinite(result.projectedSpendLamports)).toBe(true);
    expect(Number.isFinite(result.dailyMaxLamports ?? NaN)).toBe(true);
  });
});
