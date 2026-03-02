# Kawula Proactive Copilot v1 Design

**Date:** 2026-03-01  
**Status:** Validated design  
**Primary user:** Active Solana trader  
**North-star metric:** 7-day retention lift  
**Autonomy mode:** Recommend and prepare actions, always require explicit user approval

## 1. Goal, Scope, and Guardrails

Kawula should evolve from a transactional assistant into a proactive Solana copilot that users rely on daily. The v1 focus is not protocol breadth. The focus is relevance, trust, and repeat opens.

### Product goal

Increase 7-day retention by delivering high-signal proactive insights and action-ready recommendations that are grounded in the user's wallet context.

### In-scope

- Triggered proactive messages from wallet and market events
- Persistent user memory (structured + semantic)
- Personalized recommendation cards with one-tap approve/reject path
- Safety checks and policy enforcement before any executable recommendation
- Feedback loop that improves ranking quality over time

### Out-of-scope (YAGNI)

- Full autopilot execution
- Broad protocol expansion beyond current high-confidence integrations
- Complex multi-region infra or stream processing platform
- Generic social feed features unrelated to retention metric

## 2. Approaches Considered

### Option A: Alert-First Copilot Core (**selected**)

Build trigger intelligence, memory, and recommendation quality first.

- Pros: fastest path to retention lift; aligns with DAU habit loop; lowest trust risk
- Cons: execution surface expands more slowly

### Option B: Analyst-First Copilot

Prioritize deep conversational analytics and historical wallet intelligence.

- Pros: strong perception of intelligence depth
- Cons: weaker proactive habit loop unless paired with trigger engine

### Option C: Execution-Surface Expansion First

Add many protocol actions quickly and rely on planner routing.

- Pros: broad capability marketing story
- Cons: higher safety burden and dilution of signal quality

**Decision:** Option A for v1. Depth of relevance before breadth of actions.

## 3. Target Architecture

Kawula moves to a continuous intelligence loop:

`ingest -> enrich -> retrieve memory -> score trigger -> compose recommendation -> notify -> approve/reject -> execute(if approved) -> learn`

### Ownership by repository

- `kawula-api`: event intake, context graph, memory retrieval, trigger ranking, recommendation composition, tool orchestration
- `kawula-mobile`: notification landing, conversation threads, recommendation cards, approval/rejection UX
- `kawula-anchor-programs`: policy vault enforcement, receipt integrity, protocol limit extensions

### Architectural principles

- Event-driven orchestration for proactive behavior
- Hybrid memory: structured state first, semantic memory second
- Confidence-aware messaging: advisory when uncertain, actionable only when high confidence
- Execution remains user-approved and policy-gated

## 4. Core Components (`kawula-api` Priority)

### 4.1 Event Intake Service

Ingest sources:

- Helius wallet webhooks
- Market data feeds (Jupiter/Birdeye)
- User chat/app events

Responsibilities:

- Normalize events to canonical schema (`wallet_event`, `market_event`, `user_event`)
- Apply idempotency via source event keys
- Attach trace metadata (`wallet`, `event_type`, `received_at`, `source_lag_ms`)

### 4.2 Context Graph Service

Maintains current user state used by ranking and recommendations:

- balances, positions, protocol exposure
- recent swaps/transfers/stakes
- policy ceilings and per-protocol limits
- inferred preferences (risk appetite, token interests, preferred action times)

### 4.3 Memory Service

Persistence model:

- Structured memory in Postgres tables for deterministic retrieval
- Semantic memory in pgvector chunks with OpenAI embeddings

Retrieval model:

1. Hard filters (wallet, timeframe, event class)
2. Semantic lookup for relevant historical context
3. Optional recency/importance reranking in application logic

### 4.4 Trigger and Ranking Engine

Compute a notification score from:

- `impact` (position/material value change)
- `urgency` (time sensitivity)
- `confidence` (data freshness and source agreement)
- `novelty` (non-duplicate insight)
- `fatigue_budget` (user notification tolerance)

Controls:

- cooldown windows per trigger family
- daily caps per user and category
- hard safety bypass for critical security alerts

### 4.5 Recommendation Composer

Generates recommendation cards with:

- plain-language context summary
- why-now explanation
- expected outcome range
- risk notes and safety warnings
- one-tap actions (approve/reject/open details)

If confidence is below actionable threshold, emit insight-only card with explicit uncertainty.

## 5. Data Model (v1)

- `events_raw`: append-only normalized event stream
- `wallet_state_snapshots`: latest context materialization per wallet
- `memory_chunks`: semantic chunks + embedding vector + metadata
- `recommendations`: generated proactive recommendations and score breakdown
- `notification_deliveries`: push/in-app delivery records and status
- `recommendation_feedback`: user outcomes (`approved`, `rejected`, `ignored`, `dismissed`) and reason labels

Key constraints:

- idempotency unique keys on source event IDs
- immutable event rows for replayability
- explicit recommendation lifecycle status transitions

## 6. Runtime Data Flow

1. Event arrives at intake endpoint
2. Dedupe and normalize
3. Enrich from Context Graph
4. Retrieve relevant memory (structured + semantic)
5. Rank trigger eligibility
6. If below threshold: persist only, no push
7. If above threshold: compose recommendation card
8. Deliver push and in-app message
9. On user open: show details and approval options
10. On approve: run policy + simulation + tx build path
11. On reject/ignore: persist feedback signal
12. Update model features and future ranking behavior

## 7. Trust, Safety, and Error Handling

### Pre-action trust gates

Every executable recommendation must pass:

1. Data confidence gate (freshness + source coherence)
2. Policy compatibility gate (limits, known-address checks)
3. Risk gate (token safety, anomaly detection)
4. Execution feasibility gate (route and simulation validity)

Failure behavior:

- downgrade to advisory message if user should still be informed
- suppress message if confidence and urgency are both low

### Reliability behaviors

- bounded retries with exponential backoff for transient source failures
- stale-data labeling in recommendation metadata
- simulation mismatch forces re-confirmation before execution
- high-priority security triggers can bypass fatigue throttling

## 8. Testing and Release Strategy

### Test layers

- Unit: scoring math, dedupe, cooldowns, confidence gating, feedback updates
- Integration: ingest-to-notification and approve-to-execution handoff
- Contract: card DTO parity with `kawula-mobile`
- Adversarial: scam token, stale price, duplicate webhook, policy edge cases

### Quality gates before broad rollout

- minimum recommendation precision threshold
- maximum daily notifications per active wallet
- minimum confidence required for actionable cards
- no regression in policy/simulation safety checks

### Rollout phases

1. Internal wallets
2. 5% cohort
3. 25% cohort
4. 100% rollout with per-trigger kill switches

Primary success: measurable 7-day retention improvement.  
Supporting signals: open rate, alert-to-action conversion, reduction in dismiss/ignore rates.

## 9. Immediate Build Priorities by Repo

### `kawula-api`

- implement `EventIntakeService`, `ContextGraphService`, `TriggerRankingEngine`, `RecommendationComposer`
- add Postgres schema + pgvector retrieval path using OpenAI embeddings
- define recommendation card DTOs and confidence metadata

### `kawula-mobile`

- thread list + proactive recommendation message renderer
- push notification landing to conversation context
- approval/rejection affordances with concise provenance labels

### `kawula-anchor-programs`

- extend policy model toward per-protocol limits
- enrich receipt fields needed for recommendation feedback and analytics

## 10. Definition of v1 Done

v1 is complete when active traders receive relevant proactive recommendations, can safely approve actions with explicit context, and feedback measurably improves recommendation quality while increasing 7-day retention.
