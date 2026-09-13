# EPGL — reply to your answers on the payload review

**13 September 2026** · Environment: `epro--preprod2.sandbox`
**Answers to:** `EPGL-PAYLOAD-REVIEW-2026-09-10.md`

Thank you — five of the six open items are closed, and everything you confirmed
is applied. One item below is a **correction from us**: we were wrong about
`EPG_Designation__c`, and we can show why we were wrong.

---

## 1. A correction from us — `EPG_Designation__c` is NOT blocked

**You are right and we were wrong. The blocker is withdrawn.**

We reported it read-only on the strength of a `describe`, and a describe answers
the wrong question. It reports what **our OAuth user can do through the plain
sObject API**, and our submissions do not go through the plain sObject API —
they go through your Apex REST composite, which runs in your context, not ours.

Two measurements on your PreProd org today make that concrete:

```
POST /services/data/v62.0/sobjects/Contact      (as our integration user)
  → 400 CANNOT_INSERT_UPDATE_ACTIVATE_ENTITY
        "entity type cannot be inserted: Contact"
```

Our user cannot create a Contact **at all** through the direct API — not the
field, the whole object. And yet:

```
SELECT Name, EPG_Designation__c, CreatedBy.Name FROM Contact
  WHERE CreatedDate = LAST_N_DAYS:14
  → testuat testuat  |  EPG_Designation__c = "Accountant"  |  AI Agent  |  2026-09-09
```

A Contact **created by the AI Agent user, through your composite, with the
designation set.** Your handler can write it and has. The renewal already sends
`EPG_Designation__c: 'Accountant'` on the accountant Contact and will continue
to.

For the record, the user our submissions run as is `ai.agent@epg.ae.preprod`
(`005FW001VFcQ57wYYC`, "AI Agent") — so if anything ever does need a grant, that
is the user to grant it to.

---

## 2. Your question: why documents in two places?

> *Why are you sending documents under the composite
> `apexrest/EPGL/LicenseRequest` API **and** under the `apexrest/EPGL/Document`
> API?*

Because your specification asks for both, and neither call can do the other's
job.

| | `EPG_Document__c` in the composite | `POST /EPGL/Document` (API 5) |
|---|---|---|
| carries | the **metadata** | the **bytes** |
| fields | `EPG_Company__c`, `EPG_File_Id__c`, `EPG_File_Name__c`, `docType__c`, `fileType__c`, `fileSize__c`, `location__c` | `licenseRequestId`, `fileName`, `fileType`, `versionData` (base64) |
| becomes | an `EPG_Document__c` record, upserted on `EPG_File_Id__c` | a `ContentVersion` + `ContentDocumentLink` on the request |

- The composite has **no field for file content** — your `EPGDocument` schema
  defines none — so the file itself cannot go that way.
- `/EPGL/Document` has **no `fileSize__c`, `docType__c`, `location__c` or company
  link**, and it requires a `licenseRequestId` that does not exist until the
  composite has already run.

We follow your own `issuanceSuccess` example, which includes a `NewDocument`
item pointing at `EPG_Document__c`, and your note that *"`EPG_Document__c` items
sent as an array are processed internally and OMITTED from the response."* So
the composite registers what the files **are**, and API 5 delivers what they
**contain**.

**If your handler now derives the `EPG_Document__c` rows from the uploads
itself, say so and we will drop them from the composite** — it is one item to
remove. We kept them because the upsert key and the metadata fields are yours,
and dropping them unilaterally would lose whatever your process reads them for.

---

## 3. What we have applied from your answers

**The request number.** Confirmed working — measured on four consecutive records:

```
LR-37337 → {"requestIdentifier":"LR-37337", "requestStatus":"Draft", ...}
LR-37336 → {"requestIdentifier":"LR-37336", "requestStatus":"Under document review", ...}
LR-37335 → {"requestIdentifier":"LR-37335", "requestStatus":"Payment Verified", ...}
LR-37333 → {"requestIdentifier":"LR-37333", "requestStatus":"Draft", ...}
```

A week ago that field was null on everything. We now read the reference from
`getRequestStatus` instead of resolving it with our own SOQL query; the SOQL
path stays behind it as a fallback only.

**The status API.** `id` required — your updated swagger matches what we
measured, and we have always sent it.

**`EPG_Payment_Reference__c`.** No longer sent. Your answer and your schema agree:
you store `notifyPayment.payment.paymentId` yourselves, and a describe of
`EPG_License_Request__c` reports no such field at all.

**The matching key.** `EPG_License_Request__c` matched on `Name` for an update —
recorded as your confirmed answer rather than our proposal.

**The Virtual IBAN status.** We have **stopped setting `EPG_Request_Status__c`
altogether.** Your progression is

> Under document review → Documents approved → Virtual Iban Approved →
> Payment Verified → Closed

and every step of it is yours. We had been stamping **"Pending Payment"**, which
appears nowhere in that list — a request in a status your process never assigns
is one your process cannot move. The setting still exists on our side, so if you
do want a value at submission it is a configuration change rather than a
release.

**The statuses, in the applicant's words.** The assistant now knows what each
status on your path means and reports that rather than inventing a reading. Two
are easy to get wrong and now cannot be:

- **"Documents approved"** is not the licence being issued — it is the moment the
  fee falls due.
- **"Payment Verified"** is not the licence being issued either — it is the money
  confirmed, with the licence still to come.

A status outside the path you gave us is relayed exactly as you wrote it, with no
gloss. There are thirty-nine values on that picklist, and a reassuring guess at
an unfamiliar one is how an applicant gets told an application is fine when it is
not.

---

## 4. Still open — the payment, and only the payment

You answered **(a)**: submit, review, `"Documents approved"`, then pay — and told
us to watch the status API for that value before sending the payment
notification. That is a clear answer and we can build to it.

**We have held it deliberately, because EPGL's own side has not settled it.**
Whether the fee is offered *with* the submission or *after* approval is being
confirmed within EPGL, and the two answers are not compatible: the licence fee is
presently offered at submission, while the Virtual IBAN branch already behaves as
"submitted for review, IBAN within one working day".

Reversing the order of a submission and a payment while the two sides of that
conversation disagree is how money is taken against a request that cannot receive
it — the exact symptom this review opened with (`Amount (Paid)` reading 0.00).

So we have built **the half that is safe either way**: the assistant reads the
status, knows `"Documents approved"` is the payable moment, and can tell the
applicant where their application has got to. **The moment EPGL confirm the
order, switching to it is a small change and we will make it.**

---

## 5. Everything else from 9 September, closed

| Item | Your answer | State |
|---|---|---|
| Virtual IBAN status value | the full progression | applied — we set nothing |
| `EPG_Designation__c` read-only | not read-only | **our error, withdrawn** |
| matching key on update | `Name` | confirmed |
| `EPG_Payment_Reference__c` | you store the paymentId | no longer sent |
| `requestIdentifier` null | fixed your side | verified on four records |
| `getRequestStatus` `id` optional | now required in the swagger | matches |
| document download endpoint | — | answered in §2; over to you |
