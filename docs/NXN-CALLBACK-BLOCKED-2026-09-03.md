# `/nextApi/case` — callback request blocked by CAPTCHA

**Asking for:** a server-to-server way to raise a case, or an exemption for our
service. Everything below was tested against staging on 2 September 2026.

## What we are trying to do

When a customer in the assistant asks for a callback, we want to raise it in the
same queue your contact form feeds, so your team sees it where they already work
and the customer gets a case number they can quote. Today we cannot, so those
callbacks go to an ops mailbox instead — outside your system entirely.

## The request

```http
POST https://www-stg.emiratespost.ae/nextApi/case
Content-Type: application/json
x-turnstile-token: <a Cloudflare Turnstile token>
```

```json
{
  "origin": "Web-EP",
  "caseType": "Inquiry",
  "firstName": "Ahmed",
  "lastName": "Al Mansoori",
  "mobilePhone": "00971553708434",
  "email": "ahmed@example.com",
  "message": "Requesting a callback about PO Box renewal.",
  "emirateCode": "DXB",
  "poBoxNumber": "50500",
  "trackingNumber": "",
  "attachments": []
}
```

The shape is taken from your own contact form's production bundle, including
`origin: "Web-EP"` and the mobile as `00` + digits, no `+` and no spaces — your
form validates against `^971\d{9,}$` before it will submit.

## The response

```
HTTP 403
{"message":"Invalid CAPTCHA token"}
```

Every request without a valid `x-turnstile-token` returns this. We also tried it
with the token in the body rather than the header, and under other header
spellings — same 403 each time.

## Why we cannot solve this ourselves

Cloudflare Turnstile issues its token to a **browser** that has completed a
challenge. Our assistant raises the case from a **server**, on behalf of a
customer who is talking to us in chat, so there is no browser in the loop to
issue one. It is not a matter of us obtaining a key: the mechanism assumes a
front-end, and there isn't one at that moment.

## Update, 21 October 2026 — they sent the site key

Emirates Post supplied the Turnstile **site key** `0x4AAAAAAA7Tyw1honiP4a4B`
and the snippet their own form uses. That is route 4 below, and it is the one
we have now built: the widget runs in the customer's browser inside our chat,
mints a token, and the token travels with the chat request to our server, which
forwards it as `x-turnstile-token`. See `apps/web/lib/turnstile.ts` and
`apps/web/app/embed/[agent]/useTurnstile.ts`.

Two things we established the same day:

**The 403 is their application's, not Cloudflare's edge.** The response carries
`content-type: application/json` and no `cf-mitigated` header — we reach their
app and their `/nextApi/case` handler rejects us. So route 2, an allow-list for
our egress IPs, would not have worked: we were never being stopped at the edge.

**The site key already has a configured hostname list.** Cloudflare's own
documentation says a production site key does not permit `localhost` unless it
has been added explicitly — and a token minted from `localhost` with this key
was issued without complaint. So somebody has set that list up.

## The one thing still outstanding

A Turnstile token is bound to the **hostname that rendered the widget**. That is
ours — `agent.7x.ae` — and not the page embedding us, even though the chat runs
inside `www.emiratespost.ae`. So these have to be on the site key's allowed
hostname list, under Hostname Management:

- `agent.7x.ae` — production
- `7xagents.7x-lab.com` — staging, so this can be tested before it is live

Without them, Cloudflare refuses to issue a token at all and the widget reports
error **110200**. Nothing reaches their endpoint to be judged.

**Tested on 21 October, and this is exactly what happens.** With the site key
configured on our staging app, the widget loaded on `7xagents.7x-lab.com` in a
real browser and Cloudflare refused:

```
turnstile error 110200
```

Cloudflare's own table gives 110200 as *"Domain not authorized"*, with the fix
*"Add current domain in Hostname Management."* The same key mints a token
without complaint from `localhost`, so the key is live and working — our
domains are simply not on its list. This is now the single thing standing
between the customer and a real case number.

The second unknown, which only a live attempt answers: whether their
`/nextApi/case` handler passes the token to `siteverify` with an expected
hostname of its own. If it does, our domain has to be acceptable there too.

## RESOLVED, 22 October 2026 — they gave us the direct CRM endpoint

Michael's call, relayed by Hussein: rather than whitelisting our hostnames on
the Turnstile key, Emirates Post shared a **CRM case-create API** keyed with an
`X-API-KEY`. That is **route 1/3 below — the one we asked for in September** —
and it removes the CAPTCHA from the path entirely, because a server can call it.

```http
POST https://crm-stg.epservices.ae/api/CRM/Case?X-API-KEY=<key>
Content-Type: application/json
```

| | base URL |
|---|---|
| staging | `https://crm-stg.epservices.ae/api/CRM` |
| production | `https://crm.epservices.ae/api/CRM` |

**The body is the one we already send** — the same flat payload taken from their
contact form in September, `origin: "Web-EP"` and the `00971…` mobile included.
Nothing about the request shape changed. `caseType` is
`Inquiry | Complaint | Feedback | Compliment`, and attachments keep the
`{ body, name, contentType }` shape.

**Two things to know about the key.** It is **one key for both environments**,
and it travels as a **query parameter**, which is their design. Every one of our
outbound calls is written to the API log the admin console shows, so the key is
masked there by name (`maskUrl` in `lib/apiCallLog`) and asserted to stay masked
in `scripts/test-ep-crm-2026-10-22.ts`. It must never move into the path, where
it would not be.

**The Turnstile work is now the fallback, not the plan.** `raiseEpCase` takes
the keyed route whenever `NXN_CRM_BASE_URL` and `NXN_CRM_API_KEY` are both set,
and leaves the customer's browser token unspent. Without them it behaves exactly
as before. So the hostname-whitelist request below (`agent.7x.ae`,
`7xagents.7x-lab.com`) is **no longer blocking** — worth leaving with them only
if they would rather the public form's route be the one we use.

### Tested end to end, 22 October

One case raised against their **staging** CRM through our own `raiseEpCase`,
with Emre's go-ahead:

```
POST https://crm-stg.epservices.ae/api/CRM/Case?X-API-KEY=***
→ { ok: true, caseNumber: "01246847" }   in 6.3s
```

**The key works, the route works, and we get a case number back** — eight
digits, the same shape their contact form returns. That is the whole thing the
September document asked for.

**Their response time varies a lot, and that matters.** A wrong key is refused
in under a second, but an accepted create took **more than 15 seconds on the
first attempt and 6.3 on the second**. Fifteen seconds was our limit, set in
September for an endpoint that only ever returned 403 instantly, so the first
attempt aborted our side having most likely been created on theirs. The keyed
route now allows 45s (`NXN_CRM_TIMEOUT_MS` overrides) and an abort is reported
as `timeout`, not `unreachable` — "we do not know" rather than "it did not
happen", so nobody retries it into a duplicate.

**Two test cases to clear down**, not one: `01246847`, and whatever the first
timed-out attempt created a few minutes earlier (both named
`7X TEST / DO NOT PROCESS`).

The exact field name their response carries was not captured — the reader in
`caseNumberFrom` accepts every plausible spelling rather than pinning one, so
it does not need to be. Do not narrow it without a sample response from them.

Still to do: set the two variables on staging, then production.

## What would unblock it — any one of these

1. **An API key or service credential** that bypasses Turnstile for our
   registered service.
2. **An allow-list** for our egress IPs on that endpoint.
3. **A separate server-to-server endpoint** that creates the same case type,
   without the CAPTCHA. This was our preference in September — it keeps the
   public form's protection exactly as it is.
4. **Our domains on the site key's allowed hostname list**, so the challenge can
   be answered in the customer's browser inside our chat. ← *this is the route
   taken; see the update above for what is still needed to finish it.*

We do not need the public endpoint changed or its protection relaxed.

## Until then

The assistant still takes the callback and still tells the customer it is
raised — it is emailed to the ops mailbox rather than lost. But it does not
reach your case queue, and the customer gets no case number.

## Where this lives our side

`apps/web/lib/epCase.ts`, with the browser half in
`apps/web/app/embed/[agent]/useTurnstile.ts`. It is written against the contract
above and returns `not_configured` rather than calling when no token reached it,
because a call without one can only ever 403.

Configuration, as it stands on 21 October:

| | `NXN_CRM_BASE_URL` | `NXN_CRM_API_KEY` | `NXN_CASE_API_BASE_URL` | `NXN_CASE_TURNSTILE_SITE_KEY` |
|---|---|---|---|---|
| staging | *to set* | *to set* | `https://www-stg.emiratespost.ae` | set |
| production | *to set* | *to set* | *unset* | *unset* |

The first two take precedence; the last two are the fallback described above.

Staging points at **their** staging site, which is why it is the right place to
try this: a case filed there lands in their test environment, not in the queue
their officers work. Production stays unset deliberately — the moment it is set,
a customer asking for a callback files a real case — so it waits until staging
has proved the whole path.
