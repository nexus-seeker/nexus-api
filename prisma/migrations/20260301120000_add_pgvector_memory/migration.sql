DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    RETURN;
  END IF;

  BEGIN
    CREATE EXTENSION vector;
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE EXCEPTION
        'pgvector extension is required before this migration. Ask your DBA to run: CREATE EXTENSION vector;';
  END;
END
$$;

CREATE TABLE IF NOT EXISTS "memory_chunks" (
  "id" TEXT NOT NULL,
  "wallet_pubkey" TEXT NOT NULL,
  "thread_id" TEXT,
  "content" TEXT NOT NULL,
  "metadata" JSONB,
  "embedding" vector(1536) NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "memory_chunks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "memory_chunks_wallet_created_idx"
  ON "memory_chunks"("wallet_pubkey", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "memory_chunks_wallet_thread_created_idx"
  ON "memory_chunks"("wallet_pubkey", "thread_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "memory_chunks_embedding_idx"
  ON "memory_chunks"
  USING ivfflat ("embedding" vector_cosine_ops)
  WITH (lists = 100);
