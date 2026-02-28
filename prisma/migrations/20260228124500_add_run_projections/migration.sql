CREATE TABLE "agent_runs" (
    "runId" TEXT NOT NULL,
    "pubkey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "intent" TEXT,
    "latestStep" JSONB,
    "completedAt" TIMESTAMP(3),
    "rejectedReason" TEXT,
    "lastEventSeq" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("runId")
);

CREATE TABLE "conversation_messages" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "pubkey" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agent_runs_pubkey_updatedAt_idx" ON "agent_runs"("pubkey", "updatedAt");

CREATE UNIQUE INDEX "conversation_messages_runId_seq_key" ON "conversation_messages"("runId", "seq");

CREATE INDEX "conversation_messages_pubkey_createdAt_idx" ON "conversation_messages"("pubkey", "createdAt");

ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_runId_fkey" FOREIGN KEY ("runId") REFERENCES "agent_runs"("runId") ON DELETE CASCADE ON UPDATE CASCADE;
