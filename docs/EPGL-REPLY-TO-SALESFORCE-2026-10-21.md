# Reply to Hussein — 21 October 2026

*Draft. Everything below was checked first-hand against the NewLaw sandbox on
21 October before it was written down.*

---

Hi Hussein,

Thank you — we have been through the pack and tested against the sandbox. Four
of the seven points we could verify end to end, and they all behave as you
describe:

- **Document slots (2).** Copy of Passport, Copy of Emirates ID and Memorandum
  of Association are present on all ten products, with the formats, the 10 MB /
  25 MB limits and the expiry requirement exactly as stated.
- **Agent channel (4).** `LR-53330` returns `agentRequest: true`.
- **Status (5).** An unknown application id now returns a real HTTP 404, and
  `informationRequest.documentsToReupload` is there. Thank you for turning the
  404 around — that was the one that would have had us reading the body to
  find out whether the call had worked.
- **Licence retrieval (7).** Returns the licence, and `includeDocument=true`
  returns the PDF.

**Application id (1).** This settles the question we raised, and we are glad it
went your way — the create request carries no `applicationId__c` and the
response hands back `LR-53330`. One thing to tidy, though, because it still
says the opposite in the one place our build reads:

> The catalogue response — live, this morning — still lists in
> `applicationFields`:
>
> ```
> name:        applicationId__c
> required:    yes
> description: "Portal application id, unique per company; the key for
>               updates, documents, pricing and status"
> ```

We generate the application form from the catalogue, exactly as the catalogue
is designed to be used, so as it stands our form would ask the applicant to
type in a "Portal application id". Should we ignore that entry, or will it come
out of `applicationFields`? If it is there for updates rather than creates, a
note to that effect in the description would be enough for us.

**Two small things while we are here.**

A failed status lookup carries your success code. Both of these are live
responses from this morning:

```
HTTP 200   "desc": { "code": "RTA-S-0000", "en": "Success" }
HTTP 404   "desc": { "code": "RTA-S-0000", "en": "Failure: No License Request found" }
```

The HTTP status is right, so nothing is blocked — but anything keying off
`desc.code` reads a failure as a success.

And the Postman collections and environment in this pack again carry the live
client id and client secret for the New_law app, in seven files. We have kept
them out of our repository. The credentials from the previous pack still
authenticate, so we do not think they have been rotated — could you rotate
them, and send credentials separately from the specs in future?

**Status push (6).** Both of your conditions are met:

1. **The endpoint is live.** `POST https://7xagents.7x-lab.com/api/epgl/status`
2. **The secret** is generated and configured our side. We will send it to you
   through a one-time-view link rather than email, to whichever address you
   prefer — tell us where to send it.

It is built to `EPGL-STATUS-PUSH-2026-10-20.md`, so to confirm the details you
will be verifying against:

| | |
|---|---|
| Signature | `X-EPGL-Signature: sha256=<hex>` — HMAC-SHA256 over the **raw request body** |
| Also read | `X-EPGL-Event-Id`, `X-EPGL-Timestamp` |
| Timestamp tolerance | 15 minutes either way |
| Unsigned or wrongly signed | **401, always.** It carries a regulator's decision, so there is no environment where we accept an unverified one |
| Unknown application | 404 — please do not retry those |
| Our fault | 5xx — please do retry |
| Duplicate `eventId` | Accepted and ignored, so a retry is safe |

Send the test event whenever you are ready and we will verify the signature
together.

**Large files (3) and the retry (1) — both confirmed.** We ran these against a
company named `7X TEST - DO NOT PROCESS - 20261021A`, which you may want to
clear down:

- A create re-sent with an identical body returned **the same application**,
  `LR-54039`, and the same record id — not a second one. Exactly as you said.
- A **6.27 MB** PDF went up through `ContentVersion` and attached to its
  Memorandum of Association slot via `EPG_File_Id__c`. The status call shows it
  as `uploaded: true, validationStatus: "Passed"`.

One note from that, in case it saves somebody a morning. Posting the multipart
with a standard `FormData` is rejected:

```
400 INVALID_MULTIPART_REQUEST
"Cannot include more than one binary part"
```

The `entity_content` part must carry **no filename**, and most HTTP clients add
one automatically when the part is a file or blob object. Building the body by
hand with `Content-Disposition: form-data; name="entity_content"` and nothing
else on that line works. Worth a line in the Documents collection's
description — the Postman request itself is fine, it is only hand-written
clients that trip.

Thanks again — this moves us a long way forward.

Best regards,
