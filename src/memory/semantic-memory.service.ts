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
  private readonly embeddings: OpenAIEmbeddings | null;
  private readonly enabled: boolean;

  constructor(private readonly prisma: PrismaService) {
    // Embeddings use their own keys, completely independent from the chat LLM.
    // Priority: EMBEDDING_API_KEY → OPENAI_API_KEY (fallback for backwards compat)
    const apiKey = process.env.EMBEDDING_API_KEY || process.env.OPENAI_API_KEY;
    const model = process.env.EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL;

    if (apiKey) {
      this.embeddings = new OpenAIEmbeddings({
        apiKey,
        model,
        // Allow pointing at any OpenAI-compatible embedding endpoint
        ...(process.env.EMBEDDING_BASE_URL
          ? { configuration: { baseURL: process.env.EMBEDDING_BASE_URL } }
          : {}),
      });
      this.enabled = true;
    } else {
      this.embeddings = null;
      this.enabled = false;
      console.warn(
        '[SemanticMemoryService] No embedding key found (EMBEDDING_API_KEY / OPENAI_API_KEY not set). ' +
        'Semantic memory is disabled. Set EMBEDDING_API_KEY in .env to enable.',
      );
    }
  }

  async storeChunk(input: StoreChunkInput): Promise<void> {
    if (!this.enabled || !this.embeddings) return;
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
    if (!this.enabled || !this.embeddings) return [];
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
