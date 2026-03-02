CREATE TYPE "ProactiveRecommendationStatus" AS ENUM ('pending', 'approved', 'rejected', 'ignored');

CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('queued', 'sent', 'failed');

CREATE TYPE "RecommendationOutcome" AS ENUM ('approved', 'rejected', 'ignored');

CREATE TABLE "conversation_threads" (
    "id" TEXT NOT NULL,
    "walletPubkey" TEXT NOT NULL,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversation_threads_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "agent_runs" ADD COLUMN "threadId" TEXT;

ALTER TABLE "conversation_messages" ADD COLUMN "threadId" TEXT;

CREATE TABLE "proactive_events" (
    "id" TEXT NOT NULL,
    "walletPubkey" TEXT NOT NULL,
    "threadId" TEXT,
    "source" TEXT NOT NULL,
    "sourceEventId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "eventAt" TIMESTAMP(3) NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proactive_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "proactive_recommendations" (
    "id" TEXT NOT NULL,
    "walletPubkey" TEXT NOT NULL,
    "threadId" TEXT,
    "eventId" TEXT,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "status" "ProactiveRecommendationStatus" NOT NULL,
    "actions" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proactive_recommendations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "notification_deliveries" (
    "id" TEXT NOT NULL,
    "recommendationId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" "NotificationDeliveryStatus" NOT NULL,
    "providerMessageId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "recommendation_feedback" (
    "id" TEXT NOT NULL,
    "recommendationId" TEXT NOT NULL,
    "walletPubkey" TEXT NOT NULL,
    "outcome" "RecommendationOutcome" NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recommendation_feedback_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "conversation_threads_walletPubkey_updatedAt_idx" ON "conversation_threads"("walletPubkey", "updatedAt");

CREATE INDEX "agent_runs_threadId_updatedAt_idx" ON "agent_runs"("threadId", "updatedAt");

CREATE INDEX "conversation_messages_threadId_createdAt_idx" ON "conversation_messages"("threadId", "createdAt");

CREATE UNIQUE INDEX "proactive_events_source_sourceEventId_key" ON "proactive_events"("source", "sourceEventId");

CREATE INDEX "proactive_events_walletPubkey_eventAt_idx" ON "proactive_events"("walletPubkey", "eventAt");

CREATE INDEX "proactive_events_threadId_createdAt_idx" ON "proactive_events"("threadId", "createdAt");

CREATE INDEX "proactive_recommendations_walletPubkey_createdAt_idx" ON "proactive_recommendations"("walletPubkey", "createdAt");

CREATE INDEX "proactive_recommendations_threadId_createdAt_idx" ON "proactive_recommendations"("threadId", "createdAt");

CREATE INDEX "proactive_recommendations_status_createdAt_idx" ON "proactive_recommendations"("status", "createdAt");

CREATE INDEX "notification_deliveries_recommendationId_createdAt_idx" ON "notification_deliveries"("recommendationId", "createdAt");

CREATE INDEX "notification_deliveries_status_createdAt_idx" ON "notification_deliveries"("status", "createdAt");

CREATE INDEX "recommendation_feedback_recommendationId_createdAt_idx" ON "recommendation_feedback"("recommendationId", "createdAt");

CREATE INDEX "recommendation_feedback_walletPubkey_createdAt_idx" ON "recommendation_feedback"("walletPubkey", "createdAt");

ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "conversation_threads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "conversation_threads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "proactive_events" ADD CONSTRAINT "proactive_events_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "conversation_threads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "proactive_recommendations" ADD CONSTRAINT "proactive_recommendations_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "conversation_threads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "proactive_recommendations" ADD CONSTRAINT "proactive_recommendations_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "proactive_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "proactive_recommendations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "recommendation_feedback" ADD CONSTRAINT "recommendation_feedback_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "proactive_recommendations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
