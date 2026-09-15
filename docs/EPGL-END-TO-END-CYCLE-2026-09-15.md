# EPGL — the end-to-end cycle, and the part of it nobody has run

**FB-1730** · 15 September 2026 · measured against `epro--preprod2.sandbox`

> *"We need to see the complete end to end cycle including how the application
> will be reviewed and approved by the licensing team and how the issued license
> will be made available to the customer."*

Our half is built and can be demonstrated today. **The half you are asking to
see has never run once** — and that is the finding, not a figure of speech.

---

## What the ten most recent licence requests actually say

Read off your own org this morning, through your own status API:

| Request | Status | `licenseNumber` |
|---|---|---|
| LR-37345 | **null** | 0 |
| LR-37342 | Under document review | 0 |
| LR-37341 | Under document review | 0 |
| LR-37340 | Under document review | 0 |
| LR-37337 | Draft | **12712** |
| LR-37336 | Under document review | 0 |
| LR-37335 | Payment Verified | 0 |
| LR-37333 | Draft | **12712** |
| LR-37332 | Draft | null |
| LR-37329 | Draft | **365** |

**Nothing has ever reached "Documents approved".** Nothing has reached "License
generated" or "Closed". Every submitted application stops at *Under document
review*, because that is where it waits for your licensing team — and no
application in this sandbox has been picked up and reviewed.

The one exception is LR-37335 at *Payment Verified*, and that is ours: our
payment notification put it there. It did not get there by being approved.

So the cycle cannot be *seen* end to end until **someone at EPGL walks one
request through review and approval in Salesforce.** Take any of the four
sitting at *Under document review* and move it: approve the documents, raise the
payment advice, issue the licence. We will then show you exactly what the
customer sees at each step, in both languages, and this document becomes a
walkthrough instead of a diagnosis.

---

## What is built, and works today

**Submission.** The composite lands, every item returns `success: true`, and the
customer is given **LR-xxxxx** — read from `requestIdentifier` on your status
API, which you fixed on 11 September. Verified on ten consecutive records.

**Status, at any point.** The assistant can read the request's status and
explain it in the applicant's own terms rather than repeating a picklist value.
The two that are easiest to report wrongly are handled explicitly:

| Status | What the customer is told |
|---|---|
| Under document review | EPGL are checking the documents. Nothing is needed from you. |
| Request for more documents | EPGL need something further — check the email they sent. |
| **Documents approved** | **The documents are approved and the fee is now due.** Not the licence being issued. |
| Virtual Iban Approved | Finance have issued the IBAN; transfer the fee and the licence follows. |
| Payment under review | Finance are confirming the payment. Nothing is needed from you. |
| **Payment Verified** | The payment is confirmed. The licence is being issued. Not issued yet. |
| License generated | The licence is issued and is in the EPGL portal. |
| Closed | The application is complete. |

A status outside that list is relayed exactly as you wrote it. There are
thirty-nine values on the picklist and a reassuring guess at an unfamiliar one
is how somebody gets told an application is fine when it is not.

**Payment.** Card, or Virtual IBAN, chosen before submission. The notification
reaches the request and moves it to *Payment Verified* — measured.

**How the licence reaches the customer.** Through the EPGL portal, with an email
notification that it is there. The assistant says exactly that and does not
promise the licence in the chat or as an attachment, because it is neither.

---

## Three things on your side before this can be demonstrated

**1. Walk one request through review and approval.** The four at *Under document
review* are real submissions with real documents attached. Any of them will do.

**2. `licenseNumber` cannot be used.** It reads `0` on most requests, `null` on
one, and **`12712` on two applications that are still Drafts** — and `365` on a
third. Whatever it is, it is not the issued licence number, and we will not show
it to a customer while a Draft can carry one. If there is a field that does
carry the issued number, please name it; otherwise we will report issuance from
the status alone.

**3. LR-37345 has no status at all.** `requestStatus` comes back `null` on a
request that was created through the composite. Every other one has a value. A
request with no status cannot be reported to the applicant and cannot be picked
up by a queue — worth knowing why that one differs.

---

## The one thing still open on our side

The **payment order**. You answered that payment follows *Documents approved*,
and told us to watch the status API for it. We have built the reading half and
held the switch, because EPGL's own side has not confirmed whether the fee is
offered with the submission or after approval — and reversing a submission and a
payment while the two answers disagree is how money is taken against a request
that cannot receive it.

That is also why `Amount (Paid)` reads 0.00 on LR-37335: the notification
arrives before there is an advice to attach it to. **It resolves the moment the
order is agreed**, and the change on our side is small.
