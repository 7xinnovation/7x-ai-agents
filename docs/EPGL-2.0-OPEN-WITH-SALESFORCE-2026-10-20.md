# EPGL 2.0 — what is still open with Salesforce

*20 October 2026. After their answers to our six questions and the
pricing / status / document re-upload pack. Everything here has been checked
against the live NewLaw sandbox, not against the documents alone.*

---

## Settled — nothing needed

- **Outsourcing permits.** Clear and complete. `Principal_Licence_Number` is the
  *principal's* CEP licence, the operator hiring the applicant; `requiresCepLicence`
  is the applicant's own, checked from their trade licence. Both are required.
  Built.
- **Pricing, status and document re-upload.** All three tested live and working,
  including an open information request: `documentsToReupload` carries a reason
  per document and `documentsReuploaded` shows what has already been answered,
  which is exactly the RFI loop we needed.
  CEP30-GEN-DOM quoted 20,000 AED against the catalogue and the fee sheet. The
  status payload carries `applicantStatus` in both languages, which answers our
  earlier question about `Applicant_Status__c`. Registered as tools.
- **Combined licence and permit.** Separate requests per licence type or permit.
  Enough to build on; parked until a combined application is actually wanted.

## 1. `applicationId` — the one blocker

Your answer was that Salesforce creates it and nothing is needed from us. Three
things in your own material say the opposite:

- the catalogue describes it as *"Portal application id, unique per company; the
  key for updates"*;
- the composite example sends `applicationId__c: "APP-CEP30-UAE-SME-DOM-ONECALL-01"`;
- pricing, status and informationRequest are each keyed on that exact string and
  return 404 without it.

The field is also `string(255)` — not unique, not an external id — so nothing in
the database stops two applications sharing one.

**What we need:** who mints it; if it is us, the format you expect; and whether
the idempotency the spec describes is enforced in the Apex handler. Until this
is answered we cannot write the retry path for a submission — if a submit times
out we have no safe way to tell "it landed" from "it did not", and retrying
might create a second application.

Everything else below can be worked around. This cannot.

## 2. Agreed, waiting on delivery

| | what you said | why we are waiting |
|---|---|---|
| **Passport, Emirates ID and MOA document types** | will be added to all services and products | the journey collects all three and the PRD requires them on the record; there is no slot today, so they have nowhere to go |
| **`isAgentSource`** | you will have the team add it | every submission from the assistant is indistinguishable from the portal's in your reporting until it exists. Your pricing API already carries `entityId` ("EPG Portal") — if that is the intended marker, say so and we will send ours there instead |
| **Point 6** | ready, in testing; collection to follow | nothing from us until it arrives |

## 3. Document size and format

The live catalogue says **10 MB, PDF only**, base64 inside the composite. We have
committed to 25 MB for MOAs, and Emirates IDs and passports reach us as photos
far more often than as PDFs. You thought an API from a previous project might
cover this — could you confirm either way? If the limits cannot move and there
is no separate file endpoint, we will have to tell applicants to convert and
shrink their own documents, which is the sort of thing that ends an application.

## 4. One defect we found while testing

**The status endpoint reports a missing application as a success.**
`getApplicationStatus` with an unknown id returns **HTTP 200**, with `status: 404`
in the body and `desc.code: "RTA-S-0000"` — your *success* code. The pricing
endpoint returns a proper HTTP 404 for the same mistake. We read the body, so
this does not block us, but anything that trusts the HTTP status will treat
"no such application" as "all fine".

## 5. The status and decision endpoint

Specified in full in **`EPGL-STATUS-PUSH-2026-10-20.md`**, sent with this. The
short version: the body is the one `getApplicationStatus` already returns, plus a
four-field envelope, so it should be a small job at your end. We need **one
shared secret per environment** to start.

## 6. Please rotate the sandbox credentials

Your README says they will be rotated before production, which is right — and
worth doing sooner, because the client id and secret are also embedded in the
OpenAPI files that were emailed, so they exist in every mailbox that received
them. We have removed them from ours and read them from the environment instead.

## What we have built already

So you know where we are: the licence-choice and declarations steps are
generated from your catalogue (10 products, 21 application fields, 18 document
types), your five endpoints are registered as tools parsed from your own specs,
and the journey knows the new flow — product first, price only from your pricing
call, conditional issuance stated before payment, both-language statuses
relayed, never translated.

The one thing it is not allowed to do is invent an `applicationId`.
