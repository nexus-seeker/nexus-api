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

`LLM_PROVIDER` is wired for MVP with `openai` support only. Use `LLM_API_KEY` and set `LLM_MODEL` for the parser model.

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
