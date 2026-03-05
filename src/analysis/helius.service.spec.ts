import { HeliusService } from './helius.service';

describe('HeliusService', () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env = { ...originalEnv };
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [],
    });
  });

  afterAll(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  it('calls devnet Helius API when SOLANA_RPC_URL is devnet', async () => {
    process.env.HELIUS_API_KEY = 'test-key';
    process.env.SOLANA_RPC_URL = 'https://api.devnet.solana.com';

    const service = new HeliusService();
    await service.getRecentTransactions('wallet-1', 5);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        'https://api-devnet.helius.xyz/v0/addresses/wallet-1/transactions',
      ),
    );
  });
});
