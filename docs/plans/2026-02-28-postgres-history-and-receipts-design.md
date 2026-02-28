# NEXUS Postgres History and Receipts Design

**Date:** 2026-02-28  
**Status:** Validated design  
**Scope:** `nexus-api` write/read persistence plus mobile-facing history and receipt retrieval contracts

## 1. Goal and Boundaries

Add PostgreSQL as the off-chain experience layer for NEXUS so conversation history, agent run traces, and receipt reads remain fast, durable, and replayable without weakening on-chain policy guarantees.

This design keeps a strict truth split:

- **On-chain (Solana):** policy enforcement, immutable execution proof, receipt authenticity
- **Off-chain (Postgres):** UX history, execution timeline replay, low-latency receipt queries

Core boundary rule: Postgres never authorizes value movement. The `check_and_record` path remains first and atomic in every executable transaction.

## 2. Approaches Considered

### Option A - Append-only event store with projections (**selected**)

Persist every run lifecycle event (`run_started`, step events, completion/rejection, receipt sync) in `run_events`, then build query-friendly projection tables.

- Pros: best replay/debug fidelity, easy audit timeline, future analytics-ready
- Cons: slightly more implementation than direct row writes

### Option B - Direct run + message tables only

Write only final run records plus message rows, with optional embedded steps JSON.

- Pros: fastest initial implementation
- Cons: weaker forensic timeline and harder partial-run recovery

### Option C - Receipts cache only

Cache receipts in SQL, keep run/message history ephemeral.

- Pros: lowest immediate risk
- Cons: does not solve persistent chat history goal

**Decision:** Option A with in-API writes and an async reconciler gives the best MVP reliability-to-complexity ratio.

## 3. Architecture Overview

Implement four persistence components in `nexus-api`:

1. **Run ingestion writer**
   - Called from `agent.service.ts` and SSE lifecycle boundaries.
   - Writes append-only events with per-run monotonic sequence numbers.

2. **Projection processor**
   - Consumes events in order and updates read models.
   - Runs in-process for MVP (no queue dependency).

3. **History query service**
   - Serves `GET /history` from projection tables only.
   - No runtime dependency on Solana RPC for chat replay.

4. **Receipt reconciler**
   - Periodically syncs Solana `ExecutionReceipt` data into `receipts_cache`.
   - Emits reconciliation events and exposes lag metrics.

Recommended persistence stack: Prisma + PostgreSQL + JSONB payload columns.

## 4. Data Model

### `run_events` (append-only source of off-chain truth)

- `id` (uuid, pk)
- `run_id` (uuid/text, indexed)
- `pubkey` (text, indexed)
- `seq` (int, unique with `run_id`)
- `event_type` (enum/text)
- `payload` (jsonb)
- `created_at` (timestamptz)

Constraints:

- `unique(run_id, seq)` for idempotent replay
- immutable rows (no update/delete in normal flow)

### `agent_runs` (current snapshot per run)

- `run_id` (pk)
- `pubkey`
- `intent`
- `status` (`running|completed|rejected|faulted|inconsistent`)
- `unsigned_tx` (nullable text)
- `rejection_reason` / `rejection_field` (nullable)
- `simulation` (jsonb)
- `started_at`, `completed_at`, `updated_at`

### `conversation_messages` (mobile history projection)

- `id` (uuid, pk)
- `pubkey` (indexed)
- `role` (`user|agent`)
- `content` (text)
- `run_id` (nullable/indexed)
- `steps` (jsonb nullable)
- `rejection` (jsonb nullable)
- `timestamp` (timestamptz indexed)

Retention policy: store full content with TTL policy (default 90 days) and planned soft-delete support.

### `receipts_cache` (fast query mirror of on-chain receipts)

- `owner_pubkey` (indexed)
- `receipt_id` (bigint)
- `receipt_address`
- `tx_signature`
- `protocol`
- `amount_lamports`
- `seeker_id`
- `status`
- `timestamp`
- `synced_at`

Constraint: `unique(owner_pubkey, receipt_id)`.

## 5. Runtime Data Flow

1. `POST /agent/execute` creates `run_id`.
2. Persist `run_started` event.
3. Persist a user message event for the submitted intent.
4. As each `StepEvent` is emitted to SSE, persist `step_emitted` event.
5. On terminal outcome, persist `run_completed` or `run_rejected` event.
6. Projection processor updates `agent_runs` and `conversation_messages`.
7. Mobile `GET /history` returns paginated projected messages.
8. Receipt reconciler syncs chain receipts into `receipts_cache` and emits `receipt_synced` events.
9. `GET /receipts` reads from `receipts_cache` (not direct RPC), with optional staleness metadata.

MVP contract additions:

- `GET /history?pubkey=<base58>&limit=50&beforeTs=<optional>`
- response: `{ messages: MessageDto[], nextCursor?: number }`

`MessageDto` keeps current proposed shape (`role`, `content`, `runId`, optional `steps`, optional `rejection`, `timestamp`).

## 6. Error Handling and Consistency Rules

- If initial event persistence fails, execution does not start (fail closed).
- Mid-run persistence failures trigger bounded retries; repeated failure marks run `faulted`.
- Projection processor is idempotent via `(run_id, seq)` and resumable from cursor.
- Reconciler never hard-deletes receipts; it applies monotonic status transitions.
- Drift between projection and chain is corrected by reconciler and logged as reconciliation events.

## 7. Testing Strategy

### Unit

- Event serialization and sequencing
- Projection reducers and idempotency checks
- TTL retention boundary behavior
- Receipt status transition guards

### Integration (API + Postgres)

- `POST /agent/execute` writes expected events/messages
- `GET /history` ordering and cursor pagination
- `GET /receipts` serves cache path and handles empty owner history

### Reconciler tests

- Chain fixture sync happy path
- Replay after interruption
- Duplicate/late event tolerance

### Contract tests

- Mobile DTO compatibility for `MessageDto` and receipt rows

## 8. Rollout Plan

1. **Slice 1:** Add schema, migration, and event writes (keep reads unchanged).
2. **Slice 2:** Add `/history` endpoint and mobile chat hydration from SQL history.
3. **Slice 3:** Switch `/receipts` to `receipts_cache` with reconciler and lag metrics.

Recommended operational metrics:

- `projection_backlog_count`
- `projection_lag_seconds`
- `receipt_sync_lag_seconds`
- `run_faulted_count`
- `run_inconsistent_count`

## 9. YAGNI Non-Goals for MVP

- No queue or stream infra dependency in first release
- No full-text search requirements in initial history endpoint
- No multi-region replica strategy
- No policy bypass or off-chain authorization paths

This keeps implementation focused on reliable demo behavior: persistent chat timeline, replayable run reasoning, and low-latency receipt history backed by chain reconciliation.
