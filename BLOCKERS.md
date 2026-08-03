# Dialog Platform — Blockers & Outstanding Items

_Last updated: 2026-07-31_

A simple running list of what's blocking progress and what's still needed.
Items are grouped by whether they stop things working **now**, need **assets/credentials
from the client**, or are **engineering to-dos** that aren't blocked.

---

## 0. 2026-07-31 feedback round (NXN 39 items + EPGL 38 items)

Both exports were walked item by item. Code changes are in the repo; the
agent-definition (data) changes are in `apps/web/scripts/apply-feedback-2026-07-31.ts`
and are verified by `verify-feedback-2026-07-31.ts` (38 checks) and
`test-feedback-suite-2026-07-31.ts` (21 checks).

**Coverage is proven, not asserted.** `apps/web/scripts/audit-feedback-2026-07-31.ts`
reads the two JSON exports as its source of truth, enumerates all 77 comments, and
requires each one to carry a disposition backed by an evidence check that reads the
real artefact (stored agent definition, rendered system prompt, or the source file
that implements it). It fails if any item has no disposition, if any evidence check
does not hold, or if a disposition refers to an item not in the exports. Current
result: **77/77 with passing evidence** — 10 fixed this round, 56 already in place
and re-proven, 5 partial, 5 blocked upstream, 1 too vague to verify. Re-run it after
any change to this round:

```
cd apps/web && npx tsx scripts/audit-feedback-2026-07-31.ts
```

> **Not yet applied to production.** The apply script has been run and re-run
> (idempotent, 0 warnings) against a LOCAL copy of the Railway database only. Run
> it with the Railway `DATABASE_URL` when the round is ready to go live.

### Re-opened items the client said were still wrong

| # | Item | What was actually wrong | Now |
|---|------|------------------------|-----|
| FB-1439 | Date format | The rule said "15 Aug 2026"; the client wants day-first numeric. | Platform prompt now mandates **DD-MM-YYYY** ("14-02-2027") in both languages; the application panel formats stored ISO values on display; the receipt renders the same way; guidance examples rewritten. |
| FB-1445 | Arabic still shows English | The prompt rules were fine, but four **surfaces** had no Arabic at all: the receipt page, the mock checkout page, the embed error card, and the `manage_po_box` action labels + `manage_pobox` intent description. | All four localised (receipt and checkout also flip `dir`); a verification check now fails the build if *any* label in *any* agent definition is missing `ar`. |
| FB-1430 | Delivery fee still not disclosed before payment | It was only ever prose in the guidance — nothing showed it on the option and **nothing added it to the amount charged**. | Fee now lives on the option label itself, and journeys declare a `submission.surcharges` entry; `request_payment` adds every applicable surcharge to the total server-side and names the breakdown back to the model. Verified it stacks on a backend-priced renewal too (695 → 720). |
| FB-1426 / FB-1407 | Confirmation emails never arrive | The code is correct and already refuses to claim a send it did not make. **`RESEND_API_KEY` is not set on Railway.** See §2. | Blocked on the key — no code change needed. |

### Bugs found and fixed

| # | Item | Root cause |
|---|------|-----------|
| FB-1485 | Signed-in with UAE PASS, then asked to sign in again mid-conversation | **Four separate defects.** (1) The UAE PASS OIDC access token was being stored as the conversation's backend session token and sent as the bearer to Emirates Post, which 401s it — so every backend call failed for signed-in customers and the 401 handler told them to sign in again. Identity tokens are now tagged and only sent to integrations declaring `uaepass_live`; an integration holding its own service token keeps using it. (2) That 401 message now says the backend is unavailable instead of asking a verified customer to re-authenticate. (3) `request_authentication` is refused server-side when the conversation is already authenticated. (4) The header "signed in" chip was a toggle — one tap silently set the client back to guest while the server stayed authenticated, which presents exactly as being disconnected; it is now a status indicator. |
| FB-1393 / FB-1435 | Noticeable delay, "hanging", inconsistent response time | The chat spinner only stops when the SSE stream closes, and the route was holding the stream open after the reply was complete to send ops emails and push each uploaded document to Salesforce as base64. Those are invisible to the customer, so they now run **after** the response is delivered. Work the next turn depends on (persisted message, case state) still completes inline. |

### Delivered as far as the upstream contract allows

- **FB-1327** (EPGL payment gateway + issued license in chat): the issued
  `licenseNumber` is now surfaced in chat as soon as Salesforce has one, and the
  agent no longer implies it can take payment. The **gateway itself cannot be
  built** — see §1 #5.
- **FB-1405** (GSB link not integrated): there is no GSB tool, but the corporate
  journey's guidance claimed it would "GSB-check whether the customer's EID
  matches an owner ID". That is now removed — the agent must not claim a check it
  cannot perform, and ownership is validated from the uploaded trade license.
- **FB-1404** (save card / auto-renewal not active): the EP `UpdateAutoRenewConfig`
  write operations are disabled (guest writes are blocked, see §1 #3), so consent
  is recorded and passed on, and the agent is now forbidden from telling the
  customer auto-renewal is active or their card is stored.
- **FB-1403** (bundle features incorrect): the live tool is authoritative for
  bundle names and prices only. Features must now come from the knowledge base via
  `search_knowledge`, and the agent may not describe a feature it was not given.
  **The correct feature list per bundle is still needed from NXN** — see §2.
- **FB-1508** (import documents into the KB from admin): implemented. PDFs,
  images, text and markdown are transcribed server-side (via the existing Claude
  document blocks — no new dependency, so scans and Arabic pages work) then
  chunked and embedded like pasted text. Word files are rejected with a message
  asking for a PDF export.

### Already in place from earlier rounds (re-verified this round)

FB-1168/1169/1190-1193/1267/1270/1271/1272/1323/1324/1325/1326/1328/1374/1375/1376/
1384/1391/1392/1394/1396/1397/1398/1401/1402/1406/1421/1422/1423/1424/1425/1427/
1428/1429/1431/1432/1433/1434/1436/1437/1438/1440-1444/1446/1447/1448/1449/1450/
1451-1455 — all still assert green across the four verification suites. FB-1323's
masking was tightened to the exact shape the client asked for
(`M*********** A**** *****B`, asterisks not bullets).

### Still needs a product decision, not engineering

- **FB-1408 / FB-1409** (proactive reminders, predicting customer needs): the
  agent now raises expiring/lapsed boxes and unfinished payments unprompted and
  offers a single next-best action. Genuinely proactive *outbound* reminders (an
  email or SMS days before expiry) need a scheduled job and a decision on channel
  + consent — not built.
- **FB-1375** ("the wording layout update") is too vague to verify; treated as
  covered by the cards/summary/buttons work and left for the client to confirm.

---

## 1. Active blockers (stopping things working right now)

| # | Blocker | Impact | What's needed |
|---|---------|--------|---------------|
| 1 | **Anthropic API credits** (resolved via Azure) | Previously live chat/eval failed with `credit balance too low`. | Resolved: all Claude traffic now routes through **Azure AI Foundry (Sonnet 4.6)**. |
| 2 | ~~No hosted deployment~~ **Deployed to Railway 2026-07-08** | Live at `https://app-production-207e.up.railway.app` (project `7x-ai-agents`, service `app` **connected to the GitHub repo — auto-deploys on push to main**; **Railway Postgres + pgvector** with all Neon data migrated; DB layer is now driver-agnostic). All agents + a live Salesforce chat turn verified on the deployment. **Remaining:** register the Railway callback URL (`…up.railway.app/api/uaepass/callback`) with UAE PASS — until then sign-in on the hosted app fails with `callback.not.match` (local testing on :4500 unaffected). Custom domain TBD. |
| 3 | **NXN guest renewal `Save` blocked on EP staging** | The real guest renewal **read + pricing** work live (`Guest/Renewal/Details`, `Guest/Renewal/Pricing` → real box + real fee, e.g. box 50500 = AED 695). But `POST /api/Guest/Renewal/Save` returns an opaque `400 {"payload":null}` even with a fully correct payload (validated: `requestSource:"Web"`, future target `expiryDate`, `totalAmount` matching Pricing, full `customerKYC`/billing). The order-creation / payment-gateway step fails server-side with no diagnostic. | **Emirates Post / NXN** to either provision the guest renewal payment gateway (Network International) in staging, confirm the exact required `Save` payload (swagger marks only 3 fields required but the backend needs more), or supply a renewable test box with the gateway enabled. **Until then:** the chatbot completes renewals with real data + real pricing through the internal secure checkout (`request_payment` → webhook → `submit_case`); the NXN write ops are disabled so the agent can't call the blocked endpoints. Re-enable `saveTool`/`confirmTool` on the renewal `apiFlow` and the `Save`/`ConfirmPayment` ops to switch to the fully-real flow once unblocked. |
| 4 | **NXN `/api/MOE/*` and non-guest `/api/Renewal/*` need UAE PASS** | These return `401` with the X-API-KEY alone (guest auth insufficient). | Wire UAE PASS sign-in for the authenticated PO Box flows (renewal-by-account, MOE entity lookups). Guest renewal + rental bundle reads work key-only today. These ops are currently disabled for the agent. **Note (2026-07-31):** a UAE PASS access token is an *identity* token — it is not an Emirates Post API session, so signing in does not unlock these endpoints. Sending it as the bearer is what broke FB-1485. EP must expose a way to exchange a verified UAE PASS identity for a PO Box platform session. |
| 5 | **EPGL has no payment operation** (FB-1327) | The client asked for the EPGL payment gateway in chat, with the issued license returned once payment is confirmed. The Salesforce contract (`apps/web/public/specs/epgl-license-requests.yaml`) exposes only submit / status / duplicate-check / document-upload — **no payment endpoint, no fee, and no license certificate URL** (`licenseNumber` is documented as "null until issued"). | **EPGL** to supply the payment-gateway contract (or confirm payment stays outside the chat) and, if the issued license PDF should be delivered in chat, an endpoint that returns it. Until then the agent surfaces the issued license *number* from the status call and explains that EPGL issues the payment request after review — it does not offer to take payment. |
| 6 | **No live company-profile / IDEP read for EPGL** (FB-1268 / FB-1269) | The client asked for the signed-in customer's account and company details + Emirates ID to come from their Salesforce customer profile, and the quarterly leviable-income figures from IDEP company data. The Salesforce contract exposes no company-profile or IDEP read endpoint, so `knownEpglProfile()` **reconstructs the profile from that customer's own previous applications** and the agent asks them to confirm it. This works for a returning customer and does nothing for a first-time one. | **EPGL** to expose a read endpoint for the customer/company profile and for the IDEP quarterly figures. Swap it in at `apps/web/lib/conversation.ts` (`knownEpglProfile`) — the prefill/confirm behaviour around it already works. |
| 7 | ~~UAE PASS redirect URI points at the wrong host~~ **Not a blocker — verified 2026-08-03** | `UAEPASS_REDIRECT_URI` on Railway is still the old `app-production-207e.up.railway.app` URL, but it is **dead config**: `resolveRedirectUri()` builds the callback from the origin the customer reached, and `requestOrigin()` pins that to `PUBLIC_APP_URL` (`https://7xagents.7x-lab.com`). Verified against production — `/api/uaepass/login` sends `redirect_uri=https://7xagents.7x-lab.com/api/uaepass/callback`, and the UAE PASS staging authorize endpoint accepts it and serves the login page (no `callback.not.match`). Staging sign-in works on the custom domain today. | Housekeeping only: set `UAEPASS_REDIRECT_URI` to `https://7xagents.7x-lab.com/api/uaepass/callback` (or delete it) so the fallback stops contradicting live behaviour. **Real action for production:** the current client is `sandbox_stage`, the shared UAE PASS staging sandbox, which is permissive about redirect URIs. A production client on `id.uaepass.ae` enforces an exact registered list — so the live callback URL must be registered with UAE PASS as part of the production cutover, along with the production `UAEPASS_CLIENT_ID`/`SECRET` and `UAEPASS_BASE`. |

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

### Production secrets (status re-checked against Railway on 2026-07-31)
| Secret | Status |
|--------|--------|
| `RESEND_API_KEY` | ❌ **NOT SET — this is why confirmation emails never arrive (FB-1426 / FB-1407).** The sending code is correct and reports failure honestly, so the agent currently tells the customer email is unavailable and offers the receipt download instead. Two things are needed: (1) a Resend API key; (2) a **verified sender domain** — `EMAIL_FROM` is currently `Dialog <onboarding@resend.dev>`, Resend's sandbox sender, which can only deliver to the Resend account owner's own address, so customer emails would still fail even once a key is added. Alternative: set `EMAIL_WEBHOOK_URL` to an internal SMTP/Power Automate relay instead. |
| `NXN_BRANCH_OPS_EMAIL` / `NXN_EMX_TEAM_EMAIL` | ⚠️ Set, but both point at `moatoum@gmail.com` (a personal test inbox) and they depend on the missing email provider above. Replace with the real branch-ops and EMX distribution lists before go-live. |
| `VOYAGE_API_KEY` | Not set — the knowledge base runs on Postgres full-text search. Fine functionally; set it to switch KB retrieval to pgvector semantic search (the column and code path are ready). |
| `PAYMENT_WEBHOOK_SECRET` | ✅ **Set (local + Railway)** — webhook now rejects unsigned calls (401); mock gateway signs its posts server-side; e2e suites sign when the env var is present. |
| `CRON_SECRET` | ✅ **Set (local + Railway)** — `/api/payments/reconcile` now requires `x-cron-secret`. Remaining: schedule the sweep (Railway cron service or external scheduler hitting the endpoint every ~15 min). |
| `ADMIN_PASSWORD` | ⚠️ **8 characters — weak.** Rotate to a long passphrase before real users; it's the only credential for password login. |
| `SECRETS_KEY` | Still derived from `ADMIN_SESSION_SECRET` (50 chars, strong). Acceptable; note that setting a dedicated `SECRETS_KEY` later requires RE-ENCRYPTING all stored integration secrets, and rotating `ADMIN_SESSION_SECRET` has the same effect. |
| `AZURE_AD_TENANT_ID/CLIENT_ID/CLIENT_SECRET` _(optional)_ | Not set — login page auto-shows "Continue with Microsoft" once configured. |

### Product / content confirmations (from EPGL / NXN PRDs)
- **PO Box bundle features per bundle** (FB-1403 — the client says the current
  feature lists are wrong). The live tool gives names and prices only; the agent
  is now barred from describing a feature that is not in the knowledge base, so
  the correct list must come from NXN before it can answer "what's included".
- **Key-delivery courier fee** — implemented as AED 25 (`KEY_DELIVERY_FEE` in
  `apply-feedback-2026-07-31.ts`, and the `key_delivery_fee` surcharge on both
  rental journeys). Confirm against the official Emirates Post tariff.
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
