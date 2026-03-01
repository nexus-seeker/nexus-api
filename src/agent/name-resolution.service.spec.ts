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

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns valid base58 addresses without parser lookups', async () => {
    const service = new NameResolutionService(mockSolanaService);

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
    const service = new NameResolutionService(mockSolanaService);
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
    const service = new NameResolutionService(mockSolanaService);
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
    const service = new NameResolutionService(mockSolanaService);
    mockGetOwnerFromDomainTld.mockResolvedValue(null);

    await expect(service.resolveNameOrAddress('unknown.skr')).rejects.toThrow(
      'Could not resolve unknown.skr',
    );
  });

  it('falls back to mainnet parser when primary resolver misses', async () => {
    const service = new NameResolutionService(mockSolanaService);
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
});
