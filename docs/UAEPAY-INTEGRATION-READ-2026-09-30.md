# UAEPay Sale API v1.4 — what it asks for, and what we already have

A read of *UAEPay Sale Integration Guide — Version 1.4* (20 February 2026, 80
pages) against the Dialog Platform as it stands on 30 September 2026.

**Nothing here has been built.** This is a survey: what the document specifies,
which parts our current payment layer already satisfies, which parts do not
exist at all, and what each agent would need on top. UAEPay may or may not
replace N-Genius; this is the material for deciding.

---

## 1. What UAEPay is, in one paragraph

UAEPay (the API is branded UAEPay, the platform underneath is **noqodi** — their
field names say so throughout: `noqodiOrderId`, `noqodiCharges`,
`noqodiReferenceId`) is a **payment aggregator with a hosted checkout**. You ask
it for a payment link, you send the customer to that link, and it tells you how
the payment went — by redirect, by webhook, and by an inquiry API you can call
yourself. One API covers card, wallet, netbanking, **Aani**, and **BNPL**
(Tabby/Tamara); you do not integrate each separately.

Two things distinguish it from a plain gateway, and both matter for us:

- **Split settlement.** A payment can be divided across several
  **beneficiaries** in one transaction — "Merchant 100, DHA 100" in their own
  example. Each beneficiary has an account number UAEPay issues.
- **Parent and child merchants.** A parent `merchantCode` owns the relationship;
  individual transactions can be attributed to a child `merchantCode`.

---

## 2. The five APIs

| | Endpoint | Purpose |
|---|---|---|
| **OAuth** | `POST /oauth/token/client-credentials` | Client-credentials token, Basic auth, ~299s life |
| **Create Payment Token & URL** | `POST /v3/payments/token/createLinks` | The main call: returns `paymentUrl` + `paymentRequestToken` |
| **Refund** | `POST /v3/payments/{customerReferenceId}/refunds` | Full or partial; to source, or to a bank account |
| **Transaction Inquiry** | `GET /v2/inquiry/merchant/{merchantCode}/txn/{merchantRequestId}` | Authoritative status of a payment or refund |
| **Reconciliation** | `POST /v2/payments/reconcile` (batch), `POST /v2/payments/transaction/reconcile` (single) | Match our records against theirs |

Environments: `https://uat-api.uaepay.ae` (staging), `https://api.uaepay.ae`
(production).

### How a payment actually runs

1. **Token** — Basic auth with key id + secret, `grant_type=client_credentials`.
   The token lives **299 seconds**, so it must be minted per burst, not cached
   for a session.
2. **Create link** — `serviceType: "CREATE_LINK"`, `source: "UAEPAY"`, the
   customer's details, one or more `transactions` with amounts and
   beneficiaries. Returns `paymentUrl`.
3. **Customer pays** on UAEPay's hosted page (`paymentInitiator.language`
   controls en/ar).
4. **Redirect** back to `merchantLandingURL`, **POST**, with results in the query
   string.
5. **Webhook** to our endpoint with the full outcome — fires **regardless of
   outcome**, success or failure.
6. **Inquiry** whenever we want the truth.

### `enableSecureRedirect` — the one design decision in the document

- `false` (their default): the **entire** payment result comes back in the
  redirect URL — card scheme, issuer, amounts, beneficiaries.
- `true`: the redirect carries only `merchantRequestId` and `status`, and we
  call the Inquiry API for the rest.

The document's own recommendation is **"Always set to true."** It is right, and
for us it is not optional: a redirect is a URL the customer's browser holds. We
already refuse to put a token in a query string for exactly this reason (see
`nativeBridge.ts` — "a token in the URL is written to the server's access log,
kept in the WebView's history and restored with its state"). Card details in a
redirect are the same mistake with worse contents.

**Consequence: with `enableSecureRedirect: true`, the Inquiry API is not
optional — it is how we learn what happened.**

---

## 3. Identifiers, and which of them we must generate

| Field | Who makes it | Shape | Notes |
|---|---|---|---|
| `merchantRequestId` | **us** | **UUID**, unique per request | Enforced: `MERCHANT_REQUEST_ID_INVALID_FORMAT` |
| `merchantOrderId` | **us** | any string, **once per payment cycle** | Stays the same across retries of one payment |
| `transactions.merchantReferenceId` | **us** | any string, per transaction line | |
| `customerReferenceId` | **UAEPay** | | **Path parameter for refunds** — must be stored |
| `noqodiOrderId` / `noqodiReferenceId` | UAEPay | | Needed for reconciliation |
| `paymentRequestToken` | UAEPay | | Identifies the payment session |

Two of these are worth flagging now because they are easy to get wrong later:

- **`merchantRequestId` must be a UUID and must be new on every attempt.**
  Reusing one returns `TRANSACTION_ALREADY_INITIATED` — "Oops... you have
  already initiated the payment process". Our current `reference` is our own
  case/payment id, which is not a UUID per attempt.
- **`customerReferenceId` is the refund key**, and it only ever arrives in the
  webhook or the inquiry. If we do not persist it, refunds are impossible.

---

## 4. What we have today

Our payment layer is built around **N-Genius (Network International)** with a
`PaymentAdapter` interface that has exactly two methods:

```ts
interface PaymentAdapter {
  initiate(ctx, input): Promise<{ reference; link?; status }>;
  getStatus(ctx, input): Promise<{ status }>;
}
```

Around it:

- **`payments` table** — `reference` (unique), `amount`, `currency`, `status`
  (`initiated | paid | failed`), `gatewayRef`, timestamps.
- **`/api/payments/webhook`** — HMAC-SHA256 over the raw body against
  `PAYMENT_WEBHOOK_SECRET`, idempotent, flips the case to paid, emits analytics,
  and calls `notifyEpglIfLicenceFee`.
- **`/api/payments/reconcile`** — a scheduled sweep that asks the gateway for the
  authoritative status of anything stuck at `initiated` past 15 minutes, flags
  SLA breaches, and handles journey abandonment. Runs on a GitHub Actions cron.
- **`/api/payments/return`, `/ext-return`, `/status`, `/mock-checkout`** — the
  return journey and a mock for testing.
- **`request_payment`** (core tool) — gated on `requiresPayment`, on terms
  acceptance, on a submission reference existing (EPGL) and on a hold existing
  (Emirates Post rentals).
- **`payFence`** — a streaming filter that refuses to let the model put any URL
  in a `pay` block except the one the backend actually issued.
- **Per-tenant N-Genius outlets** — EPGL on `b2bf0418-…` (live),
  Emirates Post rentals on Emirates Post's own outlet.

---

## 5. What maps across, and what does not

### Maps cleanly

| UAEPay | Ours |
|---|---|
| `POST /v3/payments/token/createLinks` → `paymentUrl` | `PaymentAdapter.initiate()` → `{ reference, link }` |
| `GET /v2/inquiry/...` | `PaymentAdapter.getStatus()` |
| Webhook for payment result | `/api/payments/webhook` |
| `statusInfo.status` SUCCESS/FAILURE | our `paid` / `failed` |
| Hosted checkout, no card data on our side | already how we work |
| `paymentInitiator.language` en/ar | we already pass `locale` into `initiate` |
| `merchantLandingURL` | our return route |

A UAEPay adapter implementing the existing two-method interface is genuinely
**a few hundred lines**. The interface was built for this shape.

### Does not map — gaps in our model

**1. No refund capability anywhere.** `grep -ril refund` across the API routes,
libs and core returns **nothing**. There is no adapter method, no route, no
table column, no admin action. UAEPay's refund API is one of its five, with
full/partial, refund-to-source vs refund-to-bank (`BKT` needs beneficiary name,
bank name, country, IBAN and — for non-UAE banks — SWIFT), and asynchronous
settlement for bank transfers. **This is the single biggest gap.**

**2. No reconciliation against the provider's ledger.** Ours reconciles *state*
(is this stuck payment actually paid?). UAEPay's reconciles *records* — we
submit our transactions and they tell us which match, with a `batchId`,
`reconciliationStatus`, `totalReconciledTxn` / `totalUnReconciledTxn`, and a
callback when the batch completes. Different thing entirely, and it is what
Finance would want.

Note: `paymentLinksInfo.serviceProvided` (default **true**) auto-reconciles.
Left at the default, most of the reconciliation API is not needed day to day —
but the flag is per-transaction, so it is a decision, not a default to ignore.

**3. No split settlement.** Our `payments` row is one amount to one place. UAEPay
models `transactions[]` each with `beneficiaries[]`. Today neither agent splits
a payment, so nothing is broken — but it is the reason to choose UAEPay, and
using it would need a schema change.

**4. Identifier shapes.** We do not generate a per-attempt UUID
(`merchantRequestId`), and we do not store `customerReferenceId`,
`noqodiOrderId` or `noqodiReferenceId`. All three are needed: the first to
create a payment at all, the second to refund, the third to reconcile.

**5. Webhook authentication is ours, not theirs.** Our webhook verifies an
HMAC we define via `PAYMENT_WEBHOOK_SECRET`. The document describes the webhook
payload in detail and **says nothing about how a merchant verifies it came from
UAEPay** — no signature header, no shared secret, no IP range. That is a
question for them before anything goes live, and it is a security question, not
a nicety: the webhook is what flips a payment to paid.

**6. Token lifetime.** 299 seconds. Our N-Genius adapter mints a token per call,
which happens to be the right pattern already — but any caching added later must
respect five minutes, not the ~20 we use for Salesforce.

**7. BNPL wants a shopping basket.** Tabby/Tamara need buyer name, phone, email,
a shipping address, and an itemised order (`title`, `quantity`, `unitPrice`,
`category`). We have none of that shape — a PO Box rental is not a basket of
goods. If BNPL is in scope, someone has to decide what a "line item" is for a
licence fee, and whether a shipping address is even meaningful.

---

## 6. What each agent would need

### Emirates Post (NXN)

The complication is that **Emirates Post's rental payment is not ours to move.**
`Rental/Save` opens a payment on *their* N-Genius outlet and returns a
`paymentUrl`; our checkout is a second path used elsewhere. Swapping in UAEPay
would mean either:

- **(a)** Emirates Post switch their own backend to UAEPay — nothing for us to
  do beyond following the `paymentUrl` they return; or
- **(b)** we take the payment on UAEPay and tell Emirates Post it happened —
  which is not what `Rental/Save` expects, and the reservation is created *by*
  that call. We already know what happens when the money and the record are
  opened by different systems: "the box is reserved against an unpaid order, and
  the agent told the customer it was confirmed" (8 September).

**This needs deciding with Emirates Post before any estimate is meaningful.**
It is a bigger question than the API.

Specific to this agent, if it went ahead:

- The rental total already has moving parts — the base, the agent extra, the key
  courier — computed server-side by `rentalTotal`. One `transactions[]` line
  with the total is the simplest mapping; per-service lines are possible and
  would be more legible on their side.
- `paymentInitiator.emiratesId` is **required** by UAEPay. We hold a verified
  Emirates ID for a signed-in customer — but **not for a guest**, and the rental
  journey allows guests. Either UAEPay accept its absence, or the journey needs
  an Emirates ID before payment. **Worth confirming early: it is marked YES.**
- Refunds would matter here more than for EPGL — a cancelled rental is a real
  scenario, and today there is no way to refund one through us at all.

### EPGL

Cleaner, because EPGL's payment is entirely ours: `request_payment` → our
checkout → N-Genius → `paymentNotification` to Salesforce.

- The fee is a flat AED 100,000 with a conditional AED 700 online-payment
  surcharge. That maps neatly to **two `transactions[]` lines**, or one line with
  the surcharge in `transactionRemarks`. Two lines would let EPGL see the
  surcharge separately, which is probably what Finance wants.
- **Split settlement is genuinely interesting here.** The licence fee and the
  penalties are already tracked separately (`EPG_Amount_Paid__c` vs
  `EPG_Penalty_Paid_Amount__c`); UAEPay could settle them to different accounts
  in one payment rather than our reconciling them afterwards.
- `paymentInitiator.emiratesId` is available — EPGL sign-in carries it and the
  whole licence lookup keys on it.
- The **Virtual IBAN** route stays outside UAEPay entirely: Finance raise it with
  the bank and confirm receipt by hand. Nothing changes there.
- `paymentNotification` to Salesforce would need remapping: it currently carries
  N-Genius's payment id, and would carry `noqodiOrderId` / `customerReferenceId`
  instead.

---

## 6b. The webhook — what it is for, and whether we need it

**Asked directly: which flow uses it, and do we need it for what we have?**

### What UAEPay use it for

One webhook per payment **result**, fired to our endpoint the moment a payment
settles — *"regardless of the outcome"*, success or failure. It carries the full
result: card scheme and issuer, amounts, charges and VAT, the beneficiary split,
`noqodiOrderId`, `customerReferenceId` and `statusInfo.status`. There is a second
webhook for reconciliation batches, which is not relevant unless we turn
auto-reconciliation off.

In their intended design it is the **push** half of a pair: the webhook tells
you, the Inquiry API lets you ask. It exists because a customer may pay and never
come back to your page — they close the tab, or they paid on a phone while the
chat is open on a laptop.

### What we actually do today

**We do not use a webhook at all in production.** The comment in
`/api/payments/status` says so outright:

> the gateway's signed webhook sets it. **A REAL gateway (N-Genius) does not
> call that webhook**, so while the row is still "initiated" we ask the gateway
> itself, exactly as the reconcile sweep does.

A payment becomes `paid` through three **pull** paths, all of them
`PaymentAdapter.getStatus()`:

| Path | When | Latency |
|---|---|---|
| `/api/payments/status` | the widget polls while the pay card is open | seconds |
| `/api/payments/return` | the customer lands back on our return page | immediate |
| `/api/payments/reconcile` | cron sweep over anything `initiated` > 15 min | up to 15 min |

The audit trail shows it plainly: EPGL's LR-37650 on 29 September settled via
`payment_paid_via_gateway_probe` — the poll, not a callback.

`/api/payments/webhook` exists, is HMAC-verified against
`PAYMENT_WEBHOOK_SECRET`, and is idempotent — but its body is **our own shape**
(`{ reference, outcome, gatewayRef }`). The mock checkout calls it. No real
gateway ever has.

### So: is it needed?

**No — not for the flow to work.** UAEPay's Inquiry API maps onto `getStatus()`,
and all three pull paths keep working unchanged. A UAEPay payment would settle
in the chat exactly as an N-Genius one does today.

**It is worth having anyway, for one case:** the customer who pays and never
returns to the conversation. Today that is caught by the 15-minute sweep. A
webhook makes it seconds. That is the whole of its value to us — not
correctness, latency.

**And if we do wire it, it should be a hint, not an instruction.** The document
describes the payload in detail and says nothing about how a merchant verifies
the call came from UAEPay — no signature header, no shared secret, no source IP
range. An unauthenticated callback that flips a payment to `paid` is exactly what
our existing webhook's HMAC exists to prevent. So: accept the notification, then
**confirm with Inquiry before trusting it**. That costs one call, needs no
secret from them, and is the right shape regardless of what they answer.

**Recommended order of work:** build against Inquiry first — it is what we
already have — and treat the webhook as a later latency improvement.

---

## 6c. Three payment options, and the one structural problem

The plan — EPGL offering **Card / Virtual IBAN / UAEPay**, and Emirates Post
offering UAEPay **alongside** its current payment — runs into one thing worth
knowing before estimating.

**Today an agent has exactly one payment gateway.** It is bound once, per agent:

```ts
bind("payment", agent.integrations.payment);   // registry.ts
…
adapters.payment.initiate(actx, { … })          // request_payment
```

`request_payment` reaches for `adapters.payment` and gets whatever that agent
was configured with. There is no way to say "this payment goes to UAEPay and
that one to N-Genius" — the choice is made at configuration time, not per
transaction.

So "UAEPay alongside the current payment" means **the payment adapter has to
become selectable per payment**, driven by the customer's choice. That is the
main structural change in this plan, and it is a bigger change than writing the
UAEPay adapter itself. It touches:

- the adapter registry and `AdapterBundle` (more than one payment binding);
- `request_payment` (choose a binding from the case's `payment_method`);
- the `payments` row (which provider took this money — needed for `getStatus`,
  the reconcile sweep and the return probe to ask the *right* gateway);
- `/api/payments/status`, `/return` and `/reconcile`, all of which currently
  resolve "the" payment adapter for an agent.

The good news is that everything downstream of that choice is provider-agnostic
already — the case state machine, the pay-block fence, the receipt, the sweep.

**For EPGL specifically**, the journey plumbing is already there: `payment_method`
is a real field with `gateway` and `viban`, and the AED 700 surcharge is a
conditional keyed on `payment_method == 'gateway'`. Adding a third value is a
config change. Two things to decide with EPGL, not for them:

- **does the AED 700 online-payment fee apply to UAEPay too?** The surcharge
  condition is literally `payment_method == 'gateway'`, so as written it would
  not — a customer picking UAEPay would pay 100,000, which may or may not be
  intended;
- **which beneficiary account** UAEPay settles to, since it is not the N-Genius
  outlet.

**For Emirates Post**, the same structural point applies and is complicated by
the rental payment being opened by *their* `Rental/Save` on *their* outlet — see
section 6. Offering UAEPay there is not adding an option to our checkout; it is
adding a path that bypasses the call that creates the reservation.

---

## 6d. Do we have the credentials? — **No. Nothing.**

Checked on 30 September against both environments and the repository.

| What UAEPay onboarding issues | Do we have it? |
|---|---|
| Access key ID (OAuth client id) | **No** |
| Access key secret (OAuth client secret) | **No** |
| Parent `merchantCode` | **No** |
| Child `merchantCode`(s), if the split is used | **No** |
| Beneficiary account numbers (`beneficiaryAcctNumber`) | **No** |
| UAT access / test cards | **No** |
| Merchant Portal login | **No** |

The only payment credentials on either environment are:

```
NGENIUS_API_KEY
PAYMENT_WEBHOOK_SECRET
```

and the repository contains no reference to UAEPay or noqodi outside this
document. **Nothing has been started, and nothing can be tested** — not even
whether the UAT sandbox behaves as the guide describes.

The document is explicit that this is their move first:

> *"UAEPay will onboard the merchant and share the details like client
> credentials, Merchant code, accounts etc in the email."*

**So the first action is commercial, not technical:** ask UAEPay to onboard
7X / Emirates Post Group and issue UAT credentials. Everything else in this
document waits on that, and the two open questions (webhook authentication,
whether `emiratesId` is truly mandatory) are best asked in the same conversation.

Worth asking for at the same time, since they cost nothing to request now and
block things later:

- **separate UAT and production credentials** — the guide lists two environments
  but describes one onboarding;
- **beneficiary account numbers per settlement destination** — for EPGL, that is
  potentially one for the licence fee and one for penalties;
- **the child `merchantCode` scheme**, if transactions are to be attributed per
  entity.

---

## 6e. Guest vs signed-in — resolved

`paymentInitiator.emiratesId` is marked **required**, and a guest renting a PO
Box has never had to give us one.

**Decision (30 September): UAEPay is offered only to signed-in customers.** A
guest sees the payment options as they are today; UAEPay appears once the
customer has signed in.

That is a clean resolution and it costs nothing to implement — both agents
already know, server-side, whether the customer is authenticated, and a verified
Emirates ID is exactly what a UAE PASS sign-in leaves behind:

- Emirates Post holds it as `VERIFIED_EID_KEY` on the case, from UAE PASS;
- EPGL keys its entire licence lookup on it, so it is always present there.

Two consequences worth stating, neither of them blocking:

- **It must be enforced server-side, not by the prompt.** Offering a payment
  method is the model's job; *accepting* one is not. `request_payment` should
  refuse UAEPay when the session is not authenticated, the same way it already
  refuses payment before a submission reference exists. A method the customer
  can talk their way into is not gated.
- **The Emirates ID we send must be the verified one**, never one the customer
  typed. That rule already exists for the rest of the platform and would simply
  extend here.

For EPGL this restriction is close to theoretical — a licence application is a
signed-in journey anyway. For Emirates Post it genuinely narrows who sees the
option, which is the intended outcome.

---

## 7. What is missing to make it work at all

In order of what blocks what:

0. **Per-payment adapter selection** — see 6c. Nothing about "three options"
   works until a payment can choose its own gateway.
1. **Credentials and onboarding — we have none at all (see 6d).** UAEPay
   onboard the merchant and issue client id, client secret, `merchantCode` and
   beneficiary account numbers. Nothing can be tested without them, including
   reading whether the sandbox behaves as documented. **This is the first
   action, and it is commercial rather than technical.**
2. **A decision on Emirates Post.** Whose gateway takes the rental money. The
   answer changes whether this is a small piece of work or a joint project.
3. **Webhook authentication.** Ask them how a merchant verifies a webhook.
   Unanswered, the webhook cannot be trusted to flip a payment to paid, and we
   would have to treat every notification as a hint and confirm by Inquiry.
4. ~~`paymentInitiator.emiratesId` for guests~~ — **resolved 30 September:**
   UAEPay is offered to signed-in customers only (see 6e). Enforce it in
   `request_payment`, not in the prompt.
5. **Schema additions** — `customerReferenceId`, `noqodiOrderId`,
   `noqodiReferenceId`, and a per-attempt `merchantRequestId` UUID on the
   `payments` row. Small, but nothing else works without them.
6. ~~A refund path~~ — **out of scope for now, by decision (30 September).**
   Worth keeping in view: `customerReferenceId` is the refund key and only ever
   arrives in the webhook or the inquiry response, so it is cheap to store now
   and impossible to recover later.
7. **Reconciliation** — only if `serviceProvided` is set to false, or if Finance
   want batch reconciliation reports.
8. **BNPL scope** — in or out. If in, someone decides what a line item is.

---

## 8. Honest assessment

The **core payment flow is a small piece of work**, and smaller than it looks:
our `PaymentAdapter` interface is `initiate` + `getStatus`, which is exactly the
shape of `createLinks` + `inquiry`. The webhook, the return route, the case
state machine, the stuck-payment sweep, the receipt and the pay-block fence all
stay as they are. A UAEPay adapter, the identifier columns, and per-tenant
settings would get a payment working end to end on staging.

What is **not** small:

- **Refunds** are a new capability, not a port. Everything about them — who may
  issue one, how it is audited, what the customer is told, refund-to-bank
  collecting IBANs — is unbuilt.
- **Emirates Post's rental gateway** is a commercial and architectural question
  between two parties, not an integration task.
- **Split settlement**, the feature that most justifies the move, needs a data
  model we do not have.

And the two questions to put to UAEPay before committing:

- **How is a webhook authenticated?** The document does not say, and it is the
  call that moves money in our records.
- **Is `paymentInitiator.emiratesId` genuinely mandatory?** A guest renting a PO
  Box does not have to give us one today.

---

*Read on 30 September 2026 against Dialog Platform at commit `f5032eb`. No code
was changed.*
