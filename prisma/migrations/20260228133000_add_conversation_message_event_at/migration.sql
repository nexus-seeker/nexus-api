ALTER TABLE "conversation_messages"
ADD COLUMN "eventAt" TIMESTAMP(3);

UPDATE "conversation_messages"
SET "eventAt" = "createdAt"
WHERE "eventAt" IS NULL;

ALTER TABLE "conversation_messages"
ALTER COLUMN "eventAt" SET NOT NULL;

CREATE INDEX "conversation_messages_pubkey_eventAt_idx" ON "conversation_messages"("pubkey", "eventAt");
