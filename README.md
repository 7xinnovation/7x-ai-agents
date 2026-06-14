# Dialog Platform

Multi-tenant conversational AI. Each agent is **data**, not code, and ships as a
floating widget that expands into a full-page split screen — chat on the left, a
**realtime case builder** on the right. EPGL Dialog is the first agent; the
group's other two companies are added as new rows.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full design.

## Layout

```
apps/web          Next.js — config API, chat SSE, embed split-screen experience
packages/config   AgentDefinition + CaseState schemas (the abstraction)
packages/core     adapters, case engine, Claude orchestrator (runTurn)
packages/db       Drizzle schema + Neon client + EPGL seed (pgvector KB)
packages/embed    dialog.js loader (floating widget → full page)
```

## Setup

1. Fill in `.env` (copy from `.env.example`). `DATABASE_URL` is already set to the
   Neon `dialog-platform` project. **Add your `ANTHROPIC_API_KEY`** to enable chat.
2. Install + provision:

```bash
npm install
npm run db:push          # apply schema to Neon (vector ext auto-enabled)
npm run db:seed          # seed EPGL tenant/agent/journeys/KB
npm run embed:build && cp packages/embed/dist/dialog.js apps/web/public/dialog.js
npm run dev              # http://localhost:3000
```

## Try it

- `/` — overview + links
- `/embed/epgl-dialog` — the agent full-page
- `/demo` — a stand-in customer site with the floating widget installed
- `GET /api/agents/epgl-dialog` — public config
- `POST /api/chat` — SSE conversational turn

## Add another company

Insert a `tenants` row and an `agents` row with a new `AgentDefinition`
(see `packages/db/src/seed.ts`). Point its integration bindings at the company's
systems by registering adapter providers in `apps/web/lib/registry.ts`. Hand them
`<script src=".../dialog.js" data-agent="NEW_SLUG">`.
