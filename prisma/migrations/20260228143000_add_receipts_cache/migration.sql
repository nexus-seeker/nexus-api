CREATE TABLE "receipts_cache" (
    "address" TEXT NOT NULL,
    "ownerPubkey" TEXT NOT NULL,
    "agentProfile" TEXT NOT NULL,
    "seekerId" TEXT NOT NULL,
    "intentHash" JSONB NOT NULL,
    "protocol" TEXT NOT NULL,
    "amountLamports" BIGINT NOT NULL,
    "txSignature" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "timestamp" INTEGER NOT NULL,
    "bump" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "receipts_cache_pkey" PRIMARY KEY ("address")
);

CREATE INDEX "receipts_cache_ownerPubkey_timestamp_idx" ON "receipts_cache"("ownerPubkey", "timestamp");

CREATE INDEX "receipts_cache_ownerPubkey_updatedAt_idx" ON "receipts_cache"("ownerPubkey", "updatedAt");
