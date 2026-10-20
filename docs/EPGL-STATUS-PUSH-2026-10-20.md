# EPGL 2.0 — the status and decision endpoint, for Salesforce

*20 October 2026. The endpoint 7X exposes for Salesforce to push an
application's progress to. Asked for twice; this is the spec. Nothing in it
needs a change to the three APIs already delivered — the body is deliberately
the one `getApplicationStatus` already returns.*

---

## 1. Why a push at all

The applicant holds the conversation with the assistant, not with the portal.
When a licence is approved, or more information is requested, or an inspection
is scheduled, the applicant should be told in the thread they are already in —
not on their next visit.

We can poll `getApplicationStatus`, and we will as a backstop. But polling every
open application every few minutes to catch an event that happens once is waste
on both sides, and it makes "you have been approved" arrive up to a poll
interval late. A push makes it immediate and lets the poll drop to an hourly
reconciliation.

## 2. Endpoint

| | |
|---|---|
| Staging | `POST https://7xagents.7x-lab.com/api/epgl/status` |
| Production | `POST https://agent.7x.ae/api/epgl/status` |
| Content type | `application/json; charset=utf-8` |
| Timeout to allow | 10 s |

Build against staging. Production is the same contract with a different secret.

## 3. Authentication — HMAC over the raw body

Every request carries a signature header:

```
X-EPGL-Signature: sha256=<hex>
```

`<hex>` is HMAC-SHA256 of the **exact bytes of the request body**, keyed with a
shared secret we exchange out of band. Not a re-serialisation of the parsed
JSON — the bytes as sent, or the signatures will not match.

```
signature = hex( HMAC_SHA256( secret, raw_request_body ) )
```

We compare in constant time and reject a mismatch with 401. This is the same
mechanism already running on our payment webhook, so it is proven rather than
invented for this.

Two more headers, both required:

```
X-EPGL-Event-Id: <string, unique per event, stable across retries>
X-EPGL-Timestamp: <ISO 8601 UTC, when the event was generated>
```

We reject a timestamp more than 15 minutes from our clock, which is what stops a
captured request being replayed later.

**Why not an API key:** a key in a header is a bearer token — anything that sees
one request can forge every later one. The HMAC proves the body came from
whoever holds the secret and that it was not altered on the way. If a key is
genuinely easier at your end, say so and we will take it over TLS with an IP
allow-list, but the HMAC is better and is not more work.

## 4. The body

**It is the body `getApplicationStatus` already returns.** Send that object,
unchanged, plus a short envelope saying what happened. You have already built
and tested the hard part; this adds four fields.

```jsonc
{
  "eventId": "EVT-00912345",            // same as X-EPGL-Event-Id
  "eventType": "status.changed",        // see 4.1
  "occurredOn": "2026-10-20T09:28:55Z", // when it happened in Salesforce
  "applicationId": "APP-CEP30-GEN-DOM-ONECALL-01",

  // Everything below is exactly what getApplicationStatus returns today.
  "status": 200,
  "desc":     { "en": "Success", "ar": "نجاح", "code": "RTA-S-0000" },
  "decision": { "status": { "en": "Approved", "ar": "تمت الموافقة" },
                "code": "1", "remarks": [] },
  "application": {
    "applicationId": "APP-CEP30-GEN-DOM-ONECALL-01",
    "applicantStatus": { "en": "Approved", "ar": "تمت الموافقة" },
    "requestStatus": "License generated",
    "currentStep": "CEP30-GEN-DOM - Licence issuance",
    "reference": "LR-52586",
    "productCode": "CEP30-GEN-DOM",
    "productName": "CEP Licence (≤30 kg) — General — Domestic",
    "decision": { "outcome": "Approve", "grounds": "Eligible - all checks passed",
                  "decisionType": "Manual", "decidedOn": "2026-10-19T09:28:55Z" },
    "licence": { "licenceNumber": "4", "status": "Active", "conditional": false,
                 "validFrom": "2026-10-19", "validTo": "2027-10-18",
                 "documentEnId": null, "documentArId": null },
    "informationRequest": { "open": false, "requestedOn": null, "details": null },
    "fees": { "quoteTotal": 20000.00, "currencyCode": "AED", "adviceStatus": "Paid",
              "adviceNumber": "P14215", "paymentReference": "P14215",
              "paidOn": "2026-10-19T09:26:54Z" },
    "documents": [ { "documentType": "Trade Licence / Initial Name Approval",
                     "required": true, "uploaded": true,
                     "validationStatus": "Passed", "validTo": "2027-12-31",
                     "reviewStatus": null, "reviewComment": null } ],
    "precheckResult": "Passed with manual-review triggers",
    "handledBy": "Licence Intake Officer",
    "submittedOn": "2026-10-19T09:26:56Z",
    "lastUpdatedOn": "2026-10-19T09:28:56Z",
    "statutorySlaDue": "2026-11-16T09:26:00Z",
    "operationalSlaDue": "2026-10-20T05:26:00Z",
    "paymentStatus": { "en": "Paid", "ar": "مدفوع" }
  }
}
```

Both languages on anything the applicant reads, please — the conversation may be
held in either, and translating your decision wording ourselves would put words
in the regulator's mouth.

### 4.1 `eventType`

| value | when |
|---|---|
| `status.changed` | `applicantStatus` moved — the general case |
| `information.requested` | an RFI was raised; `informationRequest.open` is true and `details` is populated |
| `information.resolved` | the RFI was closed |
| `decision.made` | approved, rejected or conditionally issued; `decision` is populated |
| `licence.issued` | `licence` is populated with a number and validity |
| `inspection.scheduled` / `inspection.completed` | for FOODMED, INTERMED and LOCKERS |
| `payment.updated` | `fees.adviceStatus` changed |

If an event does not fit, send `status.changed` — we key the applicant's message
off `applicantStatus` and `decision`, and treat `eventType` as a hint.

**For `information.requested` we need `informationRequest.details` populated** —
which documents and why. `getApplicationStatus` returns `null` there today and
the detail lives in `/licensing/informationRequest`. Either inline it here or we
will call that endpoint on receipt; inlining saves a round trip and a race.

## 5. What we answer

| code | meaning | what you should do |
|---|---|---|
| `200` | accepted, or a duplicate `eventId` we already have | nothing |
| `400` | unparseable or missing `applicationId` / `eventId` | do not retry unchanged; it will fail again |
| `401` | signature missing, malformed or wrong | check the secret and that you signed the raw bytes |
| `404` | no conversation for that `applicationId` | safe to drop |
| `5xx` | our fault | retry |

Body on success: `{"received": true, "eventId": "EVT-00912345"}`.

**Idempotency is ours to enforce.** Send the same `eventId` as often as you
like; the second and later deliveries are acknowledged and discarded. So prefer
retrying over dropping.

**Please retry on `5xx` and on a timeout** — exponential backoff, a few minutes
between attempts, give up after 24 hours. Delivery order is not guaranteed, so
each event carries `occurredOn` and we ignore one older than what we already
hold for that application.

## 6. What we do with it

The applicant gets a message in their thread in the language they were using,
and the case panel updates. An RFI becomes a document request they can satisfy
in the conversation, re-uploaded through `CompositeHandler` as you specified. An
approval shows the licence number and validity. Nothing is shown that is not in
your payload — we do not infer a decision from a status, or a status from a
document.

## 7. What we still need from you

1. **The shared secret**, one per environment, by whatever channel you prefer.
2. **Your source IPs**, if you want us to allow-list as well. Optional.
3. **Confirmation of `applicationId`.** This is the one blocker. Every endpoint
   you have shipped is keyed on it, and your catalogue calls it "Portal
   application id, unique per company", and your composite example sends
   `applicationId__c: "APP-CEP30-UAE-SME-DOM-ONECALL-01"` — all of which reads
   as the caller supplying it. The written answer we had was that Salesforce
   creates it and nothing is needed from us. We need the one that is true,
   because it decides what we key this endpoint on and how a retried submission
   avoids creating a second application. If it is ours to mint, please also tell
   us the format you expect and make the field unique or an external id, since
   it is neither today.

## 8. Timeline

We can have the endpoint running on staging within a few days of the secret
arriving. It is not blocked on anything else in section 7 — only the
`applicationId` answer blocks us from finishing the matching logic, and that
same question blocks the submission path regardless of this endpoint.
