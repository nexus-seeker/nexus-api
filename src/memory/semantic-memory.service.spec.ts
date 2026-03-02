import { PrismaService } from '../database/prisma.service';
import { SemanticMemoryService } from './semantic-memory.service';

const embedQuery = jest.fn();

jest.mock('@langchain/openai', () => ({
  OpenAIEmbeddings: jest.fn().mockImplementation(() => ({
    embedQuery,
  })),
}));

describe('SemanticMemoryService', () => {
  const fullEmbedding = () => Array.from({ length: 1536 }, (_, index) => index / 1000);

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';
    process.env.LLM_API_KEY = 'test-api-key';
  });

  it('embeds and stores memory chunks', async () => {
    embedQuery.mockResolvedValue(fullEmbedding());

    const prisma = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn(),
    } as unknown as PrismaService;

    const service = new SemanticMemoryService(prisma);

    await service.storeChunk({
      wallet: 'wallet',
      threadId: 't1',
      text: 'User prefers low slippage routes',
    });

    expect(embedQuery).toHaveBeenCalledWith('User prefers low slippage routes');
    expect((prisma as any).$executeRaw).toHaveBeenCalled();
  });

  it('retrieves top-k relevant chunks for a query', async () => {
    embedQuery.mockResolvedValue(fullEmbedding());

    const prisma = {
      $executeRaw: jest.fn(),
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: 'chunk-1',
          wallet: 'wallet',
          threadId: 't1',
          text: 'Prefers USDC pairs',
          metadata: null,
          distance: 0.12,
        },
      ]),
    } as unknown as PrismaService;

    const service = new SemanticMemoryService(prisma);

    const result = await service.search({
      wallet: 'wallet',
      query: 'best USDC route',
      k: 3,
    });

    expect(embedQuery).toHaveBeenCalledWith('best USDC route');
    expect((prisma as any).$queryRaw).toHaveBeenCalled();
    expect(result[0].text).toContain('USDC');
  });

  it('rejects store when embedding dimension does not match pgvector schema', async () => {
    embedQuery.mockResolvedValue([0.1, 0.2]);

    const prisma = {
      $executeRaw: jest.fn(),
      $queryRaw: jest.fn(),
    } as unknown as PrismaService;

    const service = new SemanticMemoryService(prisma);

    await expect(
      service.storeChunk({
        wallet: 'wallet',
        text: 'dimension mismatch test',
      }),
    ).rejects.toThrow('Embedding dimension mismatch');

    expect((prisma as any).$executeRaw).not.toHaveBeenCalled();
  });
});
