# Nexus API

NestJS API service for the Nexus MVP.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create your local env file from the template and fill in values:

```bash
cp .env.example .env
```

`LLM_PROVIDER` supports `openai` and `deepseek`. Use `LLM_API_KEY` and set `LLM_MODEL` for the parser model.

For Jupiter routing, set:

- `JUPITER_API_URL=https://api.jup.ag/swap/v1`
- `JUPITER_API_KEY=<your portal key>`

3. Run in development:

```bash
npm run start:dev
```

## Build

```bash
npm run build
```

## Docker

Build the production image:

```bash
docker build -t nexus-api .
```

## Judge Runbook (No Mock, Devnet)

Run the backend in real mode:

```bash
cp .env.example .env
npm install
MOCK_MODE=false npm run start:dev
```

Quick API smoke checks:

```bash
curl -X POST http://localhost:3001/agent/execute \
  -H "Content-Type: application/json" \
  -H "x-api-key: nexus-hackathon-key" \
  -d '{"intent":"Transfer 0.001 SOL to EP4C7RTzhTPqTZZ8fUzfSu443QawGfDUDYjKgWFPfBfZ","pubkey":"EP4C7RTzhTPqTZZ8fUzfSu443QawGfDUDYjKgWFPfBfZ"}'
```

Expected behavior:

- Real SSE step stream (`parse_intent` -> `validate_policy` -> `build_transaction` -> `assemble_tx`)
- `unsignedTx` returned on success
- Plain-English rejection when policy blocks execution
