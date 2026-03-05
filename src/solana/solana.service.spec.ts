const getAccountInfoMock = jest.fn();
const getProgramAccountsMock = jest.fn();

jest.mock('@solana/web3.js', () => {
  class PublicKey {
    value: string;

    constructor(value: string | Buffer) {
      this.value = Buffer.isBuffer(value) ? value.toString('hex') : value;
    }

    toBase58() {
      return this.value;
    }

    toBuffer() {
      return Buffer.alloc(32, 7);
    }

    static findProgramAddressSync() {
      return [new PublicKey(Buffer.alloc(32, 7)), 255] as const;
    }
  }

  class Connection {
    getAccountInfo = getAccountInfoMock;
    getProgramAccounts = getProgramAccountsMock;

    constructor() {}
  }

  return {
    Connection,
    PublicKey,
    VersionedTransaction: class {},
    TransactionMessage: class {},
    AddressLookupTableAccount: class {},
    TransactionInstruction: class {},
  };
});

import { SolanaService } from './solana.service';

describe('SolanaService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('uses NEXUS_PROGRAM_ID from env for program id', () => {
    process.env.NEXUS_PROGRAM_ID =
      'DxV7vXf919YddC74X726PpsrPpHLXNZtdBsk6Lweh3HJ';
    delete process.env.Kawula_PROGRAM_ID;

    const service = new SolanaService();

    expect(service.getProgramId().toBase58()).toBe(
      'DxV7vXf919YddC74X726PpsrPpHLXNZtdBsk6Lweh3HJ',
    );
  });

  it('decodes nextReceiptId correctly when protocol_caps are present', async () => {
    process.env.NEXUS_PROGRAM_ID =
      'DxV7vXf919YddC74X726PpsrPpHLXNZtdBsk6Lweh3HJ';
    const service = new SolanaService();

    const discriminator = Buffer.alloc(8, 1);
    const owner = Buffer.alloc(32, 9);
    const dailyMaxLamports = Buffer.alloc(8);
    dailyMaxLamports.writeBigUInt64LE(500_000_000n);
    const currentSpend = Buffer.alloc(8);
    currentSpend.writeBigUInt64LE(100_000_000n);
    const lastResetTs = Buffer.alloc(8);
    lastResetTs.writeBigInt64LE(1_700_000_000n);

    const allowedProtocolsLen = Buffer.alloc(4);
    allowedProtocolsLen.writeUInt32LE(1);
    const protocol = Buffer.from('jupiter', 'utf8');
    const protocolLen = Buffer.alloc(4);
    protocolLen.writeUInt32LE(protocol.length);

    const capsLen = Buffer.alloc(4);
    capsLen.writeUInt32LE(1);
    const capProtocol = Buffer.from('jupiter', 'utf8');
    const capProtocolLen = Buffer.alloc(4);
    capProtocolLen.writeUInt32LE(capProtocol.length);
    const capMax = Buffer.alloc(8);
    capMax.writeBigUInt64LE(150_000_000n);
    const capSpend = Buffer.alloc(8);
    capSpend.writeBigUInt64LE(100_000_000n);

    const nextReceiptId = Buffer.alloc(8);
    nextReceiptId.writeBigUInt64LE(42n);
    const isActive = Buffer.from([1]);
    const bump = Buffer.from([255]);

    getAccountInfoMock.mockResolvedValue({
      data: Buffer.concat([
        discriminator,
        owner,
        dailyMaxLamports,
        currentSpend,
        lastResetTs,
        allowedProtocolsLen,
        protocolLen,
        protocol,
        capsLen,
        capProtocolLen,
        capProtocol,
        capMax,
        capSpend,
        nextReceiptId,
        isActive,
        bump,
      ]),
    });

    const vault = await service.fetchPolicyVault({
      toBuffer: () => Buffer.alloc(32, 5),
      toBase58: () => 'owner',
    } as any);

    expect(vault?.nextReceiptId).toBe(42);
    expect(vault?.isActive).toBe(true);
  });

  it('fetches and decodes execution receipts with protocol_fee_saved_lamports field', async () => {
    process.env.NEXUS_PROGRAM_ID =
      'DxV7vXf919YddC74X726PpsrPpHLXNZtdBsk6Lweh3HJ';
    const service = new SolanaService();

    const discriminator = Buffer.alloc(8, 1);
    const agentProfile = Buffer.alloc(32, 7);
    const seekerId = Buffer.from('bene', 'utf8');
    const seekerIdLen = Buffer.alloc(4);
    seekerIdLen.writeUInt32LE(seekerId.length);
    const intentHash = Buffer.alloc(32, 3);
    const protocol = Buffer.from('spl_transfer', 'utf8');
    const protocolLen = Buffer.alloc(4);
    protocolLen.writeUInt32LE(protocol.length);
    const amountLamports = Buffer.alloc(8);
    amountLamports.writeBigUInt64LE(100_000_000n);
    const protocolFeeSavedLamports = Buffer.alloc(8);
    protocolFeeSavedLamports.writeBigUInt64LE(0n);
    const txSignature = Buffer.from('3fV4M6szaQ7sKfE5DbiY6Q8Q6d6m5N2m8W3jZ8y6Q2kH');
    const txSignatureLen = Buffer.alloc(4);
    txSignatureLen.writeUInt32LE(txSignature.length);
    const status = Buffer.from([1]);
    const timestamp = Buffer.alloc(8);
    timestamp.writeBigInt64LE(1_700_000_000n);
    const bump = Buffer.from([255]);

    getProgramAccountsMock.mockResolvedValue([
      {
        pubkey: { toBase58: () => 'receipt-pda-1' },
        account: {
          data: Buffer.concat([
            discriminator,
            agentProfile,
            seekerIdLen,
            seekerId,
            intentHash,
            protocolLen,
            protocol,
            amountLamports,
            protocolFeeSavedLamports,
            txSignatureLen,
            txSignature,
            status,
            timestamp,
            bump,
          ]),
        },
      },
    ]);

    const receipts = await service.fetchReceiptsByOwner({
      toBuffer: () => Buffer.alloc(32, 5),
      toBase58: () => 'owner',
    } as any);

    expect(getProgramAccountsMock).toHaveBeenCalledWith(
      service.getProgramId(),
      expect.objectContaining({
        filters: expect.arrayContaining([
          expect.objectContaining({ dataSize: 294 }),
        ]),
      }),
    );
    expect(receipts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          address: 'receipt-pda-1',
          protocol: 'spl_transfer',
          amountLamports: 100_000_000,
          txSignature: '3fV4M6szaQ7sKfE5DbiY6Q8Q6d6m5N2m8W3jZ8y6Q2kH',
          status: 'Completed',
        }),
      ]),
    );
  });
});
