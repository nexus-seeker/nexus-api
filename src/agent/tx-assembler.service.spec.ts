import { PublicKey, AddressLookupTableAccount } from '@solana/web3.js';
import { TxAssemblerService } from './tx-assembler.service';
import { SolanaService } from '../solana/solana.service';

function toJupiterIx(programId: string, byte: number) {
  return {
    programId,
    accounts: [
      {
        pubkey: '11111111111111111111111111111111',
        isSigner: false,
        isWritable: false,
      },
    ],
    data: Buffer.from([byte]).toString('base64'),
  };
}

describe('TxAssemblerService', () => {
  const owner = new PublicKey('11111111111111111111111111111111');
  const kawulaProgramId = new PublicKey(
    'DxV7vXf919YddC74X726PpsrPpHLXNZtdBsk6Lweh3HJ',
  );

  const createSolanaMock = (overrides?: Partial<SolanaService>) =>
    ({
      getProgramId: jest.fn().mockReturnValue(kawulaProgramId),
      findProfilePDA: jest.fn().mockReturnValue([owner, 255]),
      findPolicyPDA: jest.fn().mockReturnValue([owner, 255]),
      findReceiptPDA: jest.fn().mockReturnValue([owner, 255]),
      fetchPolicyVault: jest.fn().mockResolvedValue({ nextReceiptId: 9 }),
      resolveAddressLookupTables: jest.fn().mockResolvedValue([]),
      buildVersionedTransaction: jest
        .fn()
        .mockResolvedValue('assembled-base64'),
      ...overrides,
    }) as unknown as SolanaService;

  it('does not expose a placeholder check_and_record ix builder', () => {
    const solana = createSolanaMock();
    const service = new TxAssemblerService(solana);

    expect((service as any).buildCheckAndRecordIx).toBeUndefined();
  });

  it('rejects legacy swapTransaction-only Jupiter payloads', async () => {
    const solana = createSolanaMock();
    const service = new TxAssemblerService(solana);

    await expect(
      service.assembleTransaction(owner, 100_000_000, 'jupiter', {
        swapTransaction: 'legacy-blob',
      }),
    ).rejects.toThrow('cannot prepend check_and_record');

    expect((solana as any).buildVersionedTransaction).not.toHaveBeenCalled();
  });

  it('rejects when decoded Jupiter instruction list is empty', async () => {
    const solana = createSolanaMock();
    const service = new TxAssemblerService(solana);

    await expect(
      service.assembleTransaction(owner, 100_000_000, 'jupiter', {
        addressLookupTableAddresses: [],
      }),
    ).rejects.toThrow('No Jupiter instructions to assemble');

    expect((solana as any).buildVersionedTransaction).not.toHaveBeenCalled();
  });

  it('rejects malformed Jupiter instruction payloads before decode', async () => {
    const solana = createSolanaMock();
    const service = new TxAssemblerService(solana);

    await expect(
      service.assembleTransaction(owner, 100_000_000, 'jupiter', {
        swapInstruction: {
          programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3L7N4j7n8Yq7X7qf',
          accounts: [
            {
              pubkey: '11111111111111111111111111111111',
              isSigner: false,
              isWritable: false,
            },
          ],
          data: 12345,
        },
      }),
    ).rejects.toThrow('Invalid Jupiter instruction payload');

    expect((solana as any).buildVersionedTransaction).not.toHaveBeenCalled();
  });

  it('keeps check instruction first and passes resolved ALTs to v0 compiler', async () => {
    const resolvedAlts = [{} as AddressLookupTableAccount];

    const solana = createSolanaMock({
      resolveAddressLookupTables: jest.fn().mockResolvedValue(resolvedAlts),
    });

    const service = new TxAssemblerService(solana);

    const setupOneProgram = 'ComputeBudget111111111111111111111111111111';
    const setupTwoProgram = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
    const swapProgram = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3L7N4j7n8Yq7X7qf';
    const cleanupProgram = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

    const jupiterInstructions = {
      setupInstructions: [
        toJupiterIx(setupOneProgram, 1),
        toJupiterIx(setupTwoProgram, 2),
      ],
      swapInstruction: toJupiterIx(swapProgram, 3),
      cleanupInstruction: toJupiterIx(cleanupProgram, 4),
      addressLookupTableAddresses: [
        'A6QzSWWqM4m9j6u3J2W9Q2XoBg8f6Nw6GxV2o3HfJv9g',
        'G6mP2j4s3Ht9qVY9LQ6q5k2VvXH7HnP1j1n9Wq5fT1Et',
      ],
    };

    const txBase64 = await service.assembleTransaction(
      owner,
      100_000_000,
      'jupiter',
      jupiterInstructions,
    );

    expect(txBase64).toBe('assembled-base64');
    expect((solana as any).resolveAddressLookupTables).toHaveBeenCalledWith(
      jupiterInstructions.addressLookupTableAddresses,
    );

    const buildCall = (solana as any).buildVersionedTransaction.mock.calls[0];
    const passedInstructions = buildCall[1];

    expect(buildCall[0]).toEqual(owner);
    expect(buildCall[2]).toEqual(resolvedAlts);
    expect(passedInstructions[0].programId.toBase58()).toBe(
      kawulaProgramId.toBase58(),
    );

    const checkIxData = Buffer.from(passedInstructions[0].data);
    const protocol = 'jupiter';
    const expectedSize = 8 + 8 + 4 + Buffer.byteLength(protocol, 'utf8');
    expect(checkIxData.length).toBe(expectedSize);

    expect(
      passedInstructions.slice(1).map((ix: any) => ix.programId.toBase58()),
    ).toEqual([setupOneProgram, setupTwoProgram, swapProgram, cleanupProgram]);
  });

  it('assembles SPL transfer with check_and_record first', async () => {
    const recipient = new PublicKey(
      'EP4C7RTzhTPqTZZ8fUzfSu443QawGfDUDYjKgWFPfBfZ',
    );
    const solana = createSolanaMock({
      fetchPolicyVault: jest.fn().mockResolvedValue({ nextReceiptId: 11 }),
    });
    const service = new TxAssemblerService(solana);

    const txBase64 = await service.assembleSplTransferTransaction(
      owner,
      recipient,
      10_000_000,
    );

    expect(txBase64).toBe('assembled-base64');
    const buildCall = (solana as any).buildVersionedTransaction.mock.calls[0];
    const passedInstructions = buildCall[1];

    expect(buildCall[0]).toEqual(owner);
    expect(buildCall[2]).toEqual([]);
    expect(passedInstructions).toHaveLength(2);
    expect(passedInstructions[0].programId.toBase58()).toBe(
      kawulaProgramId.toBase58(),
    );
    expect(passedInstructions[1].programId.toBase58()).toBe(
      '11111111111111111111111111111111',
    );
  });

  it('retries without cleanup instruction when first assembly overflows transaction size', async () => {
    const setupProgram = 'ComputeBudget111111111111111111111111111111';
    const swapProgram = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3L7N4j7n8Yq7X7qf';
    const cleanupProgram = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

    const solana = createSolanaMock({
      buildVersionedTransaction: jest
        .fn()
        .mockRejectedValueOnce(new Error('encoding overruns Uint8Array'))
        .mockResolvedValueOnce('assembled-base64'),
    });

    const service = new TxAssemblerService(solana);

    const txBase64 = await service.assembleTransaction(
      owner,
      100_000_000,
      'jupiter',
      {
        setupInstructions: [toJupiterIx(setupProgram, 1)],
        swapInstruction: toJupiterIx(swapProgram, 2),
        cleanupInstruction: toJupiterIx(cleanupProgram, 3),
        addressLookupTableAddresses: [],
      },
    );

    expect(txBase64).toBe('assembled-base64');
    expect((solana as any).buildVersionedTransaction).toHaveBeenCalledTimes(2);

    const firstCallInstructions = (solana as any).buildVersionedTransaction.mock
      .calls[0][1];
    const secondCallInstructions = (solana as any).buildVersionedTransaction
      .mock.calls[1][1];

    expect(
      firstCallInstructions.slice(1).map((ix: any) => ix.programId.toBase58()),
    ).toEqual([setupProgram, swapProgram, cleanupProgram]);

    expect(
      secondCallInstructions.slice(1).map((ix: any) => ix.programId.toBase58()),
    ).toEqual([setupProgram, swapProgram]);
  });
});
