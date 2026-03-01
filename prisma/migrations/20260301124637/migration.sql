-- CreateTable
CREATE TABLE "user_memory" (
    "pubkey" TEXT NOT NULL,
    "preferredTokens" TEXT[],
    "frequentRecipients" TEXT[],
    "avgTradeSizeSol" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_memory_pkey" PRIMARY KEY ("pubkey")
);
