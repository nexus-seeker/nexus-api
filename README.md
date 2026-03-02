# Kawula API

**Kawula** is an intelligent Solana DeFi agent backend. It classifies user intents, routes them through a 6-branch pipeline (casual, read, action, safety, learn, complex), executes on-chain transactions, and maintains per-user memory.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 22 + TypeScript |
| Framework | NestJS 11 |
| LLM | DeepSeek / OpenAI (via LangChain) |
| Embeddings | OpenAI `text-embedding-3-small` (optional) |
| Database | PostgreSQL 16 + pgvector |
| ORM | Prisma 6 |
| Blockchain | Solana (web3.js, Anchor) |
| Swap routing | Jupiter + Raydium |
| On-chain data | Helius, Birdeye |

---

## Local Development Setup

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (for Postgres)
- Node.js 22+ (use [nvm](https://github.com/nvm-sh/nvm))
- npm 10+

---

### Step 1 — Start Postgres with pgvector

The project ships with a `docker-compose.yml` that uses the pre-built `pgvector/pgvector:pg16` image — no manual extension installation needed.

```bash
docker compose up -d
```

This starts:
- **PostgreSQL 16** with pgvector pre-installed, on `localhost:5432`
- Database: `nexus`, user: `postgres`, password: `postgres`

Verify it's healthy:
```bash
docker compose ps
# kawula-postgres   running (healthy)
```

---

### Step 2 — Configure Environment

```bash
cp .env.example .env
```

Open `.env` and fill in your keys. The table below explains every variable:

#### Database
| Variable | Description |
|---|---|
| `DATABASE_URL` | Postgres connection string. Default matches the Docker Compose config. |

#### Solana
| Variable | Description |
|---|---|
| `SOLANA_RPC_URL` | Helius or Alchemy RPC endpoint (devnet recommended for dev) |
| `NEXUS_PROGRAM_ID` | Deployed Anchor program ID |

#### Chat LLM
| Variable | Description | Example |
|---|---|---|
| `LLM_PROVIDER` | `openai` or `deepseek` | `deepseek` |
| `LLM_API_KEY` | API key for the chat LLM | `sk-...` |
| `LLM_MODEL` | Model name | `deepseek-chat` / `gpt-4o-mini` |

#### Embedding Model (for Semantic Memory)
These are **fully independent** from the chat LLM. You can use DeepSeek for chat and OpenAI for embeddings simultaneously.

| Variable | Required | Description | Default |
|---|---|---|---|
| `EMBEDDING_API_KEY` | Optional | API key for embedding model | — |
| `EMBEDDING_MODEL` | Optional | Embedding model name | `text-embedding-3-small` |
| `EMBEDDING_BASE_URL` | Optional | Custom OpenAI-compatible base URL | OpenAI default |

> **Note:** If `EMBEDDING_API_KEY` is not set, semantic memory (vector search) is silently disabled. All other features — chat, transactions, policy, tools — continue to work normally.

#### Swap Routing
| Variable | Description |
|---|---|
| `JUPITER_API_KEY` | Jupiter v6 API key (get one at [jup.ag](https://jup.ag)) |
| `JUPITER_API_URL` | Jupiter swap endpoint |
| `JUPITER_ONLY_DIRECT_ROUTES` | `true` reduces failure rate on devnet |
| `RAYDIUM_SWAP_HOST` | Raydium swap host (use devnet URL for dev) |

#### On-chain Data
| Variable | Description |
|---|---|
| `HELIUS_API_KEY` | Helius API key — used for tx history, PnL, wallet analysis |
| `BIRDEYE_API_KEY` | Birdeye API key — used for token prices |

#### API Security
| Variable | Description |
|---|---|
| `API_KEY` | Static bearer token sent in `x-api-key` header from mobile |
| `PORT` | HTTP port (default: `3001`) |

---

### Step 3 — Install Dependencies

```bash
npm install
```

---

### Step 4 — Run Database Migrations

```bash
# Apply all migrations
npx prisma migrate deploy

# Regenerate Prisma client after schema changes
npx prisma generate
```

---

### Step 5 — Start the Dev Server

```bash
npm run start:dev
```

The server starts in watch mode (hot reload) on `http://localhost:3001`.

Expected output:
```
🚀 Kawula Agent Backend running on port 3001
[ToolRegistry] Registered tool: swap
[ToolRegistry] Registered tool: transfer
[ToolRegistry] Registered tool: stake
... (10 tools total)
```

---

## API Endpoints

| Method | Route | Auth | Description |
|---|---|---|---|
| `GET` | `/` | — | Health check |
| `POST` | `/agent/execute` | `x-api-key` | Start an agent run |
| `GET` | `/agent/:runId/stream` | `x-api-key` | SSE stream of steps |
| `POST` | `/agent/:runId/approve` | `x-api-key` | Sign and broadcast tx |
| `GET` | `/policy` | `x-api-key` | Get wallet policy |
| `POST` | `/policy/onboard` | `x-api-key` | One-time wallet onboarding |
| `POST` | `/policy/update` | `x-api-key` | Update policy limits |
| `GET` | `/history` | `x-api-key` | Message history |
| `GET` | `/history/threads` | `x-api-key` | Conversation threads |
| `GET` | `/receipts` | `x-api-key` | Transaction receipts |
| `GET` | `/proactive/feed` | `x-api-key` | Proactive recommendations |
| `POST` | `/proactive/events` | `x-api-key` | Ingest proactive event |

All authenticated routes require the header: `x-api-key: <API_KEY>`.

---

## Intent Routing

Every user message is classified into one of 6 intents before routing:

| Intent | Trigger examples | Pipeline |
|---|---|---|
| `casual` | hi, gm, thanks, what can you do | Market context + wallet snapshot → LLM |
| `read` | show my PnL, analyze my wallet, best USDC yield | Parse → Tool loop (no tx) |
| `action` | swap, send, stake, lend | Parse → Safety check → Policy → Anomaly → Tool → TX |
| `safety` | is this token safe?, check this address | RugCheck → LLM risk narrative |
| `learn` | what is impermanent loss?, how does staking work | Personalized LLM explanation |
| `complex` | help me earn on my SOL, what should I do | Market ctx + wallet → 2-3 options |

---

## Available Tools

| Tool | API | Description |
|---|---|---|
| `swap` | Jupiter / Raydium | Token swap with best-route selection |
| `transfer` | Solana SPL | SOL or SPL token transfer |
| `multi_send` | Solana SPL | Batch transfer to multiple recipients |
| `stake` | Marinade | Liquid staking |
| `marginfi_lend` | Marginfi | Lending deposit |
| `analyze_wallet` | Helius | Full wallet breakdown |
| `analyze_token` | Birdeye | Token price + metadata |
| `check_token_safety` | RugCheck | Risk score, honeypot flag, liquidity |
| `compare_yields` | DeFiLlama | Top Solana yield pools ranked by safety × APY |
| `get_pnl_summary` | Helius | 30-day PnL (income / expense / gas / LP / staking) |

---

## Project Structure

```
src/
├── agent/
│   ├── agent.service.ts          # 6-branch intent router (core)
│   ├── intent-classifier.service.ts
│   ├── market-context.service.ts
│   ├── tools/                    # All 10 tools
│   ├── llm/                      # LLM provider abstraction
│   └── graph/                    # LangGraph nodes
├── contracts/
│   └── mvp.ts                    # Shared types (StepEvent, StepNode)
├── history/                      # Run Events + History projection
├── memory/
│   ├── user-memory.service.ts    # Per-user profile, trade history
│   └── semantic-memory.service.ts  # pgvector semantic search
├── policy/                       # On-chain policy precheck
├── proactive/                    # Proactive recommendations engine
├── solana/                       # Anchor client, tx builder
└── analysis/                     # Helius + Birdeye services
```

---

## Running Tests

```bash
# All unit tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:cov
```

Current status: **141 / 141 tests pass**.

---

## Docker Compose Reference

```bash
# Start services
docker compose up -d

# Stop services (data persisted in postgres_data volume)
docker compose stop

# Destroy everything including data
docker compose down -v

# View Postgres logs
docker compose logs -f postgres
```

---

## Common Issues

### `relation "conversation_threads" does not exist` during migration
This happens if migrations are applied on a fresh DB in the wrong order. Run:
```bash
npx prisma migrate resolve --rolled-back 20260301120000_add_pgvector_memory
npx prisma migrate deploy
```

### `pgvector extension is not installed`
If you're NOT using the Docker Compose setup (e.g. a plain `postgres:16` container):
```bash
docker exec <container> apt-get install -y postgresql-16-pgvector
psql $DATABASE_URL -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

### Semantic memory disabled on startup
Expected if `EMBEDDING_API_KEY` is not set. All other features work normally. To enable:
```
EMBEDDING_API_KEY=sk-your-openai-key
EMBEDDING_MODEL=text-embedding-3-small
```

### Server won't start — `Unsupported LLM provider`
Check `LLM_PROVIDER` in `.env`. Only `openai` and `deepseek` are supported.
