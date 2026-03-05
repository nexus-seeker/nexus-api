import { NameResolutionService } from './name-resolution.service';
import type { SolanaService } from '../solana/solana.service';
import { TldParser } from '@onsol/tldparser';

const mockGetOwnerFromDomainTld = jest.fn();

jest.mock('@onsol/tldparser', () => ({
  TldParser: jest.fn().mockImplementation(() => ({
    getOwnerFromDomainTld: mockGetOwnerFromDomainTld,
  })),
}));

describe('NameResolutionService', () => {
  const mockSolanaService = {
    getConnection: jest.fn().mockReturnValue({}),
  } as unknown as SolanaService;

  const mockPrismaService = {
    receiptCache: {
      findFirst: jest.fn(),
    },
  } as unknown as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns valid base58 addresses without parser lookups', async () => {
    const service = new NameResolutionService(mockSolanaService, mockPrismaService);

    const result = await service.resolveNameOrAddress(
      'EP4C7RTzhTPqTZZ8fUzfSu443QawGfDUDYjKgWFPfBfZ',
    );

    expect(result).toEqual({
      input: 'EP4C7RTzhTPqTZZ8fUzfSu443QawGfDUDYjKgWFPfBfZ',
      address: 'EP4C7RTzhTPqTZZ8fUzfSu443QawGfDUDYjKgWFPfBfZ',
      source: 'raw_address',
    });
    expect(mockGetOwnerFromDomainTld).not.toHaveBeenCalled();
  });

  it('resolves domain names and caches results', async () => {
    const service = new NameResolutionService(mockSolanaService, mockPrismaService);
    mockGetOwnerFromDomainTld.mockResolvedValue({
      toBase58: () => 'DasLSgNnPyMmFFGNQf45jraj37GgnQZRaqQ5YptVVsVo',
    });

    const first = await service.resolveNameOrAddress('alice.skr');
    const second = await service.resolveNameOrAddress('alice.skr');

    expect(first).toEqual({
      input: 'alice.skr',
      address: 'DasLSgNnPyMmFFGNQf45jraj37GgnQZRaqQ5YptVVsVo',
      source: 'sns_domain',
    });
    expect(second.address).toBe('DasLSgNnPyMmFFGNQf45jraj37GgnQZRaqQ5YptVVsVo');
    expect(mockGetOwnerFromDomainTld).toHaveBeenCalledTimes(1);
  });

  it('accepts parser owners already returned as base58 strings', async () => {
    const service = new NameResolutionService(mockSolanaService, mockPrismaService);
    mockGetOwnerFromDomainTld.mockResolvedValue(
      'DasLSgNnPyMmFFGNQf45jraj37GgnQZRaqQ5YptVVsVo',
    );

    const result = await service.resolveNameOrAddress('alice.skr');

    expect(result).toEqual({
      input: 'alice.skr',
      address: 'DasLSgNnPyMmFFGNQf45jraj37GgnQZRaqQ5YptVVsVo',
      source: 'sns_domain',
    });
  });

  it('throws for unresolved domains', async () => {
    const service = new NameResolutionService(mockSolanaService, mockPrismaService);
    mockGetOwnerFromDomainTld.mockResolvedValue(null);

    await expect(service.resolveNameOrAddress('unknown.skr')).rejects.toThrow(
      'Could not resolve unknown.skr',
    );
  });

  it('falls back to mainnet parser when primary resolver misses', async () => {
    const service = new NameResolutionService(mockSolanaService, mockPrismaService);
    mockGetOwnerFromDomainTld
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        toBase58: () => 'DasLSgNnPyMmFFGNQf45jraj37GgnQZRaqQ5YptVVsVo',
      });

    const result = await service.resolveNameOrAddress('alice.skr');

    expect(result).toEqual({
      input: 'alice.skr',
      address: 'DasLSgNnPyMmFFGNQf45jraj37GgnQZRaqQ5YptVVsVo',
      source: 'sns_domain',
    });
    expect(TldParser).toHaveBeenCalledTimes(2);
    expect(mockGetOwnerFromDomainTld).toHaveBeenCalledTimes(2);
  });

  it('resolves .skr domains from the local cache database', async () => {
    const service = new NameResolutionService(mockSolanaService, mockPrismaService);
    mockPrismaService.receiptCache.findFirst.mockResolvedValueOnce({
      ownerPubkey: 'EP4C7RTzhTPqTZZ8fUzfSu443QawGfDUDYjKgWFPfBfZ',
    });

    const result = await service.resolveNameOrAddress('bene.skr');

    expect(result.address).toBe('EP4C7RTzhTPqTZZ8fUzfSu443QawGfDUDYjKgWFPfBfZ');
    expect(result.source).toBe('sns_domain');
    expect(mockPrismaService.receiptCache.findFirst).toHaveBeenCalledWith({
      where: { seekerId: 'bene' },
      select: { ownerPubkey: true },
      orderBy: { timestamp: 'desc' },
    });
  });

  it('handles library crashes gracefully in tryResolveWithParser', async () => {
    const service = new NameResolutionService(mockSolanaService, mockPrismaService);
    mockGetOwnerFromDomainTld.mockImplementationOnce(() => {
      throw new Error('Simulated library crash');
    });

    // Should not throw, but return null (which then triggers fallback or error in resolveNameOrAddress)
    await expect(service.resolveNameOrAddress('crash.sol')).rejects.toThrow(
      'Could not resolve crash.sol',
    );
    expect(mockGetOwnerFromDomainTld).toHaveBeenCalled();
  });
});
