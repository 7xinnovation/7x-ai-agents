# Dialog Platform — Architecture

A multi-tenant conversational AI platform. Each **agent** is defined as data and
ships as a **floating widget** that expands into a **full-page split screen**:
chat on the left, a **realtime case builder** on the right. EPGL Dialog (from the
PRD) is the first agent; the group's other two companies are added as new rows,
not new code.

## Three layers

```
┌────────────────────────────────────────────────────────────────┐
│ EMBED LAYER  (packages/embed → dialog.js)                        │
│  one <script> tag → floating launcher + iframe-isolated app      │
│  postMessage bridge for expand / collapse / close                │
└──────────────────────────┬─────────────────────────────────────┘
                           │ iframe loads /embed/<agent>
┌──────────────────────────▼─────────────────────────────────────┐
│ AGENT RUNTIME  (apps/web + packages/core)                        │
│  /api/agents/<agent>  → public config (no secrets)               │
│  /api/chat (SSE)      → runTurn(): Claude tool-use loop          │
│      intent → journey → field extraction → case mutation         │
│      KB grounding + guardrails + adapters                        │
└──────────────────────────┬─────────────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────────────┐
│ DATA + INTEGRATIONS  (packages/db on Neon, adapters)             │
│  agents · journeys (jsonb) · kb_chunks (pgvector) · cases ·      │
│  conversations · messages · escalations · audit_log             │
│  adapters: CRM · Auth · KB · Storage · Notifications            │
└────────────────────────────────────────────────────────────────┘
```

## Packages

| Package | Responsibility |
|---|---|
| `@dialog/config` | Zod schemas + types for the **AgentDefinition** (tenant, theme, intents, journeys, fields, document matrix, guardrails, integration bindings) and the runtime **CaseState**. The whole abstraction lives here. |
| `@dialog/db` | Drizzle schema + Neon client + seed. pgvector-ready KB. |
| `@dialog/core` | Adapter interfaces + registry, mock adapters, the pure **case engine** (validation, condition eval, readiness), and the **Claude orchestrator** (`runTurn`) with tools. Transport-agnostic. |
| `@dialog/embed` | The vanilla-TS loader (`dialog.js`) host sites install. |
| `@dialog/web` | Next.js app: config API, chat SSE API, and the split-screen embed experience. |

## How a turn flows

1. UI POSTs `{ agentSlug, userMessage, history, case, locale, authenticated }` to `/api/chat`.
2. The route loads the agent, resolves its adapters, and calls `runTurn`.
3. `runTurn` builds the system prompt (persona + guardrails + journey + live case),
   streams Claude, and runs tool calls:
   - `search_knowledge` → grounded retrieval (refuse/escalate if empty)
   - `set_journey` / `collect_field` / `record_document` → mutate `CaseState`
   - `submit_case` → CRM adapter (duplicate guard, reference number)
   - `request_escalation` → CRM callback
   - `request_authentication` → gate transactional actions for guests
4. Events stream back as SSE: `text`, `case`, `citation`, `auth_required`,
   `escalation`, `submitted`, `done`, `error`. The right panel re-renders from
   each `case` event — that **is** the realtime case builder.

## Why this maps to the PRD

- **Conversation-first, structured inputs as support** → chat drives; the case
  panel is a pure render of collected state.
- **Submission readiness check** → `recomputeReadiness` blocks submit until all
  mandatory fields/documents are present.
- **Document matrix per license type** → declarative `DocumentRequirement` with
  `condition` expressions.
- **Grounding / refusal / confidence escalation** → `Guardrails` + KB-first prompt.
- **Auth model (guest vs transactional)** → `requiresAuth` on intents/journeys/steps
  enforced in tools; identity always delegated to an Auth adapter (UAE PASS).
- **Salesforce as system of record** → CRM adapter (`createCase`, `getStatus`,
  `createCallback`, `findDuplicate`).
- **Arabic/English + RTL** → every label is a `LocalizedString`; the UI flips `dir`.

## Adding a new company (the multiplier)

1. Insert a `tenants` row.
2. Insert an `agents` row with a new `AgentDefinition` (branding, locales,
   journeys, guardrails, integration bindings).
3. Implement/point integration bindings at the company's real systems by
   registering adapter providers (e.g. `salesforce`, `dynamics`, `uaepass`).
4. Hand them the embed snippet with `data-agent="<slug>"`.

No application code changes for a new agent that reuses existing adapter providers.

## Built and live

- Claude orchestrator with tool use: grounded Q&A (Neon full-text KB, OR-matched,
  english/simple config), `set_journey` + `collect_field` driving the case,
  refusal/escalation, auth gating.
- Per-turn persistence + audit + resume; server-authoritative history.
- Inline document upload with format/size validation, rejection reasons, and
  storage adapter (`/api/upload`).
- Multi-tenant: two agents (EPGL + a second company) generated from config alone.

## Production hardening (roadmap)

- Real adapters: Salesforce, UAE PASS (OAuth/JWT), S3/object storage, Voyage
  embeddings for true vector search (the KB is full-text today; pgvector column
  is ready).
- Persist conversations/messages/cases per turn (tables exist) + audit every
  transactional action; enforce PDPL consent, retention, PII masking in logs.
- Admin console to author agents/journeys/KB with versioning + KB review cadence.
- `frame-ancestors` per agent from `allowedOrigins`; rate limiting; analytics.
- Eval harness for intent accuracy + hallucination rate + Arabic/English parity.
