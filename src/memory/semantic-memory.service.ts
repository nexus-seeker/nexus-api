import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { Injectable } from '@nestjs/common';
import { OpenAIEmbeddings } from '@langchain/openai';
import { PrismaService } from '../database/prisma.service';

const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';
const VECTOR_DIMENSION = 1536;

export interface StoreChunkInput {
  wallet: string;
  threadId?: string;
  text: string;
  metadata?: Record<string, unknown>;
}

export interface SearchInput {
  wallet: string;
  query: string;
  k: number;
  threadId?: string;
}

export interface SemanticMemoryChunk {
  id: string;
  wallet: string;
  threadId: string | null;
  text: string;
  metadata: Record<string, unknown> | null;
  distance: number;
}

interface SemanticMemoryRow {
  id: string;
  wallet: string;
  threadId: string | null;
  text: string;
  metadata: Record<string, unknown> | null;
  distance: number;
}

@Injectable()
export class SemanticMemoryService {
  private readonly embeddings: OpenAIEmbeddings;

  constructor(private readonly prisma: PrismaService) {
    this.embeddings = new OpenAIEmbeddings({
      apiKey: process.env.LLM_API_KEY || process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL,
    });
  }

  async storeChunk(input: StoreChunkInput): Promise<void> {
    const embedding = await this.embeddings.embedQuery(input.text);
    this.assertEmbeddingDimension(embedding);
    const vectorLiteral = this.toVectorLiteral(embedding);
    const metadataJson = input.metadata ? JSON.stringify(input.metadata) : null;

    await this.prisma.$executeRaw`
      INSERT INTO memory_chunks (id, wallet_pubkey, thread_id, content, metadata, embedding)
      VALUES (${randomUUID()}, ${input.wallet}, ${input.threadId ?? null}, ${input.text}, ${metadataJson}::jsonb, ${vectorLiteral}::vector)
    `;
  }

  async search(input: SearchInput): Promise<SemanticMemoryChunk[]> {
    const embedding = await this.embeddings.embedQuery(input.query);
    this.assertEmbeddingDimension(embedding);
    const vectorLiteral = this.toVectorLiteral(embedding);
    const numericK = Number.isFinite(input.k) ? Math.trunc(input.k) : 1;
    const clampedK = Math.max(1, Math.min(numericK, 50));
    const threadFilter = input.threadId
      ? Prisma.sql`AND thread_id = ${input.threadId}`
      : Prisma.empty;

    const rows = await this.prisma.$queryRaw<SemanticMemoryRow[]>`
      SELECT
        id,
        wallet_pubkey AS wallet,
        thread_id AS "threadId",
        content AS text,
        metadata,
        (embedding <=> ${vectorLiteral}::vector) AS distance
      FROM memory_chunks
      WHERE wallet_pubkey = ${input.wallet}
      ${threadFilter}
      ORDER BY embedding <=> ${vectorLiteral}::vector
      LIMIT ${clampedK}
    `;

    return rows.map((row) => ({
      id: row.id,
      wallet: row.wallet,
      threadId: row.threadId,
      text: row.text,
      metadata: row.metadata,
      distance: Number(row.distance),
    }));
  }

  private toVectorLiteral(values: number[]): string {
    return `[${values.join(',')}]`;
  }

  private assertEmbeddingDimension(values: number[]): void {
    if (values.length !== VECTOR_DIMENSION) {
      throw new Error(
        `Embedding dimension mismatch: expected ${VECTOR_DIMENSION}, received ${values.length}`,
      );
    }
  }
}
