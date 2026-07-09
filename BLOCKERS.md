# Dialog Platform — Blockers & Outstanding Items

_Last updated: 2026-06-29_

A simple running list of what's blocking progress and what's still needed.
Items are grouped by whether they stop things working **now**, need **assets/credentials
from the client**, or are **engineering to-dos** that aren't blocked.

---

## 1. Active blockers (stopping things working right now)

| # | Blocker | Impact | What's needed |
|---|---------|--------|---------------|
| 1 | **Anthropic API credits** (resolved via Azure) | Previously live chat/eval failed with `credit balance too low`. | Resolved: all Claude traffic now routes through **Azure AI Foundry (Sonnet 4.6)**. |
| 2 | ~~No hosted deployment~~ **Deployed to Railway 2026-07-08** | Live at `https://app-production-207e.up.railway.app` (project `7x-ai-agents`, service `app` **connected to the GitHub repo — auto-deploys on push to main**; **Railway Postgres + pgvector** with all Neon data migrated; DB layer is now driver-agnostic). All agents + a live Salesforce chat turn verified on the deployment. **Remaining:** register the Railway callback URL (`…up.railway.app/api/uaepass/callback`) with UAE PASS — until then sign-in on the hosted app fails with `callback.not.match` (local testing on :4500 unaffected). Custom domain TBD. |
| 3 | **NXN guest renewal `Save` blocked on EP staging** | The real guest renewal **read + pricing** work live (`Guest/Renewal/Details`, `Guest/Renewal/Pricing` → real box + real fee, e.g. box 50500 = AED 695). But `POST /api/Guest/Renewal/Save` returns an opaque `400 {"payload":null}` even with a fully correct payload (validated: `requestSource:"Web"`, future target `expiryDate`, `totalAmount` matching Pricing, full `customerKYC`/billing). The order-creation / payment-gateway step fails server-side with no diagnostic. | **Emirates Post / NXN** to either provision the guest renewal payment gateway (Network International) in staging, confirm the exact required `Save` payload (swagger marks only 3 fields required but the backend needs more), or supply a renewable test box with the gateway enabled. **Until then:** the chatbot completes renewals with real data + real pricing through the internal secure checkout (`request_payment` → webhook → `submit_case`); the NXN write ops are disabled so the agent can't call the blocked endpoints. Re-enable `saveTool`/`confirmTool` on the renewal `apiFlow` and the `Save`/`ConfirmPayment` ops to switch to the fully-real flow once unblocked. |
| 4 | **NXN `/api/MOE/*` and non-guest `/api/Renewal/*` need UAE PASS** | These return `401` with the X-API-KEY alone (guest auth insufficient). | Wire UAE PASS sign-in for the authenticated PO Box flows (renewal-by-account, MOE entity lookups). Guest renewal + rental bundle reads work key-only today. These ops are currently disabled for the agent. |

---

## 2. Needs assets or credentials from the client

### Fonts (brand typography)
Already done: **PP Valve** (NXN headings, self-hosted) and **Tajawal** (Arabic, self-hosted).
Still needed (currently falling back to system fonts until files are provided):

| Font | Used for | Status |
|------|----------|--------|
| **Object Sans** | NXN body text | need `.woff2`/`.otf`/`.ttf` |
| **TWBold** | EPGL headings | need file |
| **TWRegular** | EPGL body text | need file |

> Drop the files in `apps/web/public/fonts/` and they render immediately (one `@font-face` block each).

### Live integration credentials (adapters are code-complete; default to mock)
Each is built and selectable per agent; supplying credentials switches it from mock to live with no code change.

| System | Env vars / config needed | Notes |
|--------|--------------------------|-------|
| **Salesforce CRM** | `SF_INSTANCE_URL`, `SF_ACCESS_TOKEN` (or `SF_CLIENT_ID/SECRET/USERNAME/PASSWORD`) | Cases, callbacks, status, duplicate guard. |
| **Network International (N-Genius) payment** | `NGENIUS_API_KEY`, `NGENIUS_OUTLET_REF`, `NGENIUS_BASE_URL` | Hosted order + status reconciliation. |
| **UAE PASS (OIDC)** | `UAEPASS_CLIENT_ID`, `UAEPASS_CLIENT_SECRET`, redirect URI | Note: session-token **passthrough** already works for embeds without this. |
| **PO Box Platform API (NXN)** | X-API-KEY (set) + UAE PASS for authed ops | **Live** against EP staging (`box-stg.emiratespost.ae`): guest renewal Details/Pricing + rental Bundle reads work key-only. Writes (Save/ConfirmPayment) blocked — see §1 #3; authed MOE/Renewal need UAE PASS — see §1 #4. |
| **Knowledge base embeddings** _(optional)_ | `VOYAGE_API_KEY` | Without it, KB falls back to full-text search (already working). |
| **EPGL Salesforce (License Issuance & Renewal)** | ✅ **FULLY LIVE 2026-07-08** | Salesforce fixed the trigger NPE and shipped an updated contract (v2, `apps/web/public/specs/epgl-license-requests.yaml`): `isAgentSource` flag, update-by-identifier mode, corrected Service/RecordType ids, renewal via `EPG_Finance_Summary__c` per quarter (no upsert key — never double-submit) with mandatory booleans + Accountant contact. **All five capabilities verified live** (`apps/web/scripts/test-epgl-salesforce.ts`): full issuance composite ✓ (account `001FW007TWiXHICYY4`, request `a11FW000Hq4BCOeYIO`), status ✓, document upload ✓ (201, linked), duplicate-check ✓ (returns LR number + recommended action), full renewal ✓ against the spec's licensed test account (request `a11FW000HqAwmxsYIB` + 4 finance summaries). "No License found" on unlicensed accounts is expected validation; agent relays it and offers a new-license journey. Journeys + apiFlow guidance updated to the v2 contract. |

### Collections Agent (separate initiative — NOT the EPGL license agent)
**Built 2026-07-07** as agent `collections-dialog` (internal Finance/AR tool, same tenant): integration "Collections Salesforce" on `epg--epuat.sandbox.my.salesforce.com` (OAuth2 client-credentials, token URL per spec) with both UAT ops — `retrieveAccountByNumber` (SOQL account + outstanding-balance lookup) and `submitCallResult` (atomic composite: Task upsert by Correlation ID + transcript ContentVersion + link). Journey `collection_call` collects outcome/commitment/notes/transcript and the apiFlow renders the exact composite recipe. Verified: agent serves, tools load, and credential-less calls fail gracefully with a callback offer. **Blocked on:** `COLLECTIONS_SF_CLIENT_ID`/`COLLECTIONS_SF_CLIENT_SECRET` — the emailed Postman environment arrived with EMPTY values (verified against the original Outlook attachment; Postman strips "current values" on export — sender asked to re-share). Also TBD by Finance per the solution summary: Call Outcome picklist values (assumed Commitment / No Commitment / Unreachable), email templates + communication rules, sender address, and the nightly balance-refresh integration. Re-run `apps/web/scripts/import-collections-salesforce.ts` once creds land.

### Production secrets (status as of 2026-07-09 e2e audit)
| Secret | Status |
|--------|--------|
| `PAYMENT_WEBHOOK_SECRET` | ✅ **Set (local + Railway)** — webhook now rejects unsigned calls (401); mock gateway signs its posts server-side; e2e suites sign when the env var is present. |
| `CRON_SECRET` | ✅ **Set (local + Railway)** — `/api/payments/reconcile` now requires `x-cron-secret`. Remaining: schedule the sweep (Railway cron service or external scheduler hitting the endpoint every ~15 min). |
| `ADMIN_PASSWORD` | ⚠️ **8 characters — weak.** Rotate to a long passphrase before real users; it's the only credential for password login. |
| `SECRETS_KEY` | Still derived from `ADMIN_SESSION_SECRET` (50 chars, strong). Acceptable; note that setting a dedicated `SECRETS_KEY` later requires RE-ENCRYPTING all stored integration secrets, and rotating `ADMIN_SESSION_SECRET` has the same effect. |
| `AZURE_AD_TENANT_ID/CLIENT_ID/CLIENT_SECRET` _(optional)_ | Not set — login page auto-shows "Continue with Microsoft" once configured. |

### Product / content confirmations (from EPGL / NXN PRDs)
- Exact **document matrix** per license/service type (mandatory vs conditional).
- Final **field validation rules** (formats for trade license, Emirates ID, phone).
- Confirmed **pricing** per journey (amounts are placeholders today).
- Approved **knowledge-base content** owner + review cadence.

---

## 2.5 Analytics accuracy (2026-07-09)
- **Agent filter** added to Analytics + Activity (`?agent=<slug>`) — previously every number blended all three agents into one aggregate (e.g. "unknown 148" was nxn 74 + epgl 84). Both dashboards now scope cleanly.
- **Conversations KPI** now counts real `conversations` rows (source of truth) instead of `conversation.started` events, which undercounted by ~5% (a conversation created at sign-in before the first message never emitted the event).
- **apiFlow completions** now tracked: a successful Salesforce `submitLicenseRequest` (or any journey `saveTool`) emits `journey.completed` just like the internal `submit_case`, so EPGL journey completion no longer reads 0% when licenses are actually being submitted. Detector judges the composite body (success marker present, no rollback), not HTTP status.

## 3. Engineering to-dos (not blocked, just not done)

- [ ] **Production deployment**: hosting, managed Postgres env, domain, CDN for `dialog.js` embed loader, env-var wiring.
- [ ] **CI/CD pipeline** + staged deploys.
- [ ] **Formal WCAG 2.1 AA audit** (UI uses semantic HTML + aria + non-color-only status, but no tooling/contrast pass has been certified).
- [ ] **PDPL / data-residency hardening** for production PII (retention windows, masking in logs, consent capture wording).
- [ ] **Load/perf pass** against the NFR targets (page load < 2s, API < 500ms).
- [ ] Re-run the **eval harness** to reconfirm quality numbers once credits are restored.

---

## 4. What's already done & verified (for context)

- Multi-tenant platform; two live agents (EPGL, NXN) with full branding (logos, colors, fonts where available).
- Conversational engine: intent + confidence governance, journeys, KB grounding/refusal, escalation, multilingual (EN/AR, RTL + Tajawal).
- Engine efficiency: prompt caching (verified engaging), skip-redundant-classification, transient-error retry.
- Security: RBAC (owner/admin/editor/viewer) + signed sessions, secret encryption at rest, payment webhook signing, reconciliation sweep.
- Analytics: full event taxonomy + 6 dashboards. Admin console (Overview, Agents, Inbox, Analytics, Activity, Users).
- Test harness: `e2e-test.mjs` (42 checks) + `packages/eval` (PRD success metrics). Both green when credits available.

**How to run locally:** `cd apps/web && PORT=4500 npx next start` → admin at `/admin` (password from your `.env` (`ADMIN_PASSWORD`)), widgets at `/embed/nxn-dialog` and `/embed/epgl-dialog`.
