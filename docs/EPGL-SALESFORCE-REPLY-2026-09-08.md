# Reply to EPGL's review of LR-37214

**To:** Fuad Alnsour, EPGL Salesforce
**Date:** 8 September 2026
**Re:** your review of `docs/EPGL-SUBMISSION-TRACE-LR-37214.md`

Thank you — that was exactly the level of detail we needed. Every rename in
sections 1–3 is applied and live on our staging environment. Below: what we
changed, what we need from you, and three things in your reply we would like to
settle before they reach production.

---

## 1–3. Field renames — done

Applied, and applied in code rather than in the assistant's instructions. The
composite is composed by a language model, so a field name held only in a prompt
is a field name that varies between submissions; these now go through a
normalisation step on every payload, so the spelling cannot drift.

| Object | Was | Now |
|---|---|---|
| `EPG_Partner__c` | `EPG_Account__c` | `EPG_Company__c` |
| `EPG_Partner__c` | `EPG_Emirates_Id__c` | `EPG_Emirates_ID__c` |
| `Members__c` | `EPG_Account__c` | `AccountId__c` |
| `Members__c` | `EPG_Contact__c` | *removed* |
| `Members__c` | `EPG_Designation__c` | *removed* |
| `EPG_License_Request__c` | `serviceId` | `serviceId__c` |
| `EPG_License_Request__c` | `serviceNameEN` | `serviceNameEN__c` |
| `EPG_License_Request__c` | `EPG_Activity_Codes__c` | `Activity_Codes__c` |
| `EPG_License_Request__c` | `Terms_Conditions_Accepted__c` | `EPG_Terms_and_Conditions__c` |
| `EPG_License_Request__c` | `EPG_Emirates__c` | `EPG_Current_Emirate__c` |
| `EPG_License_Request__c` | `EPG_Region__c` | `EPG_Current_Region__c` |

Three notes on the details:

- **The partner casing is enforced, not requested.** `EPG_Emirates_ID__c` on
  `EPG_Partner__c` and `EPG_Emirates_Id__c` on `User` differ by one character and
  are each correct on their own object, which is precisely the kind of thing that
  survives review and fails in production. The rename is scoped per object, so
  the `User` spelling is never "corrected" into the partner one, and vice versa.
- **`Members__c` now always carries `Name`.** Where we have no name for a member,
  we omit the `Members__c` item entirely rather than send a row that would be
  filed as "Unknown Member". LR-37214's member row had no name at all, so under
  the new behaviour it would not have been sent.
- **`EPG_Account__c` on `EPG_License_Request__c` is untouched** — your list did
  not flag it and the swagger confirms it, so we left it exactly as it was.

### `EPG_Payment_Reference__c` and `EPG_Contact__c` — please confirm

You asked whether we need these persisted. Our reading:

- **`EPG_Payment_Reference__c` — probably not needed.** The same value already
  reaches you as `notifyPayment.payment.paymentId` in the payment notification
  (`d12ddb6c-0da4-440a-a0d5-f9b637e94c29` on this request). If you store that,
  the field is redundant and we will drop it. **Do you store it, and is it
  reportable against the licence request?**
- **`EPG_Contact__c` — we would like it.** The Contact is linked to the Account,
  but an account with several contacts gives no way to tell which person actually
  submitted this request. If creating the lookup is cheap, please do; if not, we
  will drop it and live without it.

We are still sending both until you decide, since dropping them now would lose
the link with nothing to replace it. They appear to be ignored silently on your
side — every item in LR-37214 returned `success: true`.

---

## 4. Activity codes — done, and we found why they were wrong

Now sent as numeric codes, comma-separated, e.g. `"5320002,5320009"`.

The cause is worth flagging because it was ours and it was not a naming problem.
The field feeding `Activity_Codes__c` was auto-filled from the company's **trade
licence** and locked against editing — so a postal licence application went out
carrying the company's DED activities, which is how `"Coffee Shop, Restaurant"`
reached you. Those were never postal activities and no rename would have helped.

The assistant now **asks** the applicant which postal services they will provide
and maps the answer to your codes. Anything unrecognised is omitted rather than
sent as prose, so you will not receive descriptive text in that field again.

**Please confirm:** are `5320002`, `5320007` and `5320009` the complete set, and
may an application carry more than one?

---

## 5. Update matching — agreed, with one thing to confirm

Understood, and the trade-licence trigger is now written into the assistant's
instructions along with your full list of matching keys.

**For `EPG_License_Request__c` we propose its `Name`** — the licence request
number, e.g. `LR-37214`. We already receive it from you in two places, so no new
identifier has to be invented or agreed:

- `duplicate-check` returns it as `matchedRequestNumber`
- `getRequestStatus` returns it for a known id

This also matches your swagger, which documents `Name` as "License Request Name
used to match the existing record". Unless you would rather we generate our own
key, we will send `Name` on every update. **Please confirm.**

---

## 6. Documents — what we need to understand before building an endpoint

You asked for a base endpoint to download documents from. Before we build one,
we would like to check it is actually needed, because **you already receive the
file contents**, not just references.

Call 4 of the trace sends every file to `POST /services/apexrest/EPGL/Document`
with the bytes inline as base64 `versionData`. All nine returned `201 Created`
with a `contentVersionId` and a `contentDocumentId`, and your reply confirms they
are attached under the Files section of the licence request.

So: **what would the download endpoint give you that the upload does not?** If
the answer is that you want to re-fetch a file later without storing it, we can
build it — but it would serve customer identity documents (Emirates IDs and
passports), so it needs authentication, per-file authorisation and a short-lived
signed URL rather than a guessable path. We would rather scope that properly with
you than expose a base path.

Related, from your answer to our point 3: `NewDocument` is the one composite item
that returns no id, and the Documents panel on the request still showed only a
system-generated "Lease Contract" while the files were under Files. **Are the
`EPG_Document__c` placeholder rows serving any purpose for you?** If the Files
section is the intended home for agent-sourced documents, we will stop sending
them; if the Documents panel is meant to list them, something between the
placeholder and the panel is not connecting.

---

## 7. Payment — this one needs a decision before go-live

> *The application should get approval by the business team before sending the
> payment notification; this validation should be added from our side to restrict
> payment notification unless the license approved.*

**This would break every submission the assistant makes.** Our flow takes the
money before the business team has seen anything:

```
duplicate check  ->  submit licence request  ->  customer pays (N-Genius)  ->  we notify you
```

The notification fires seconds after the customer's card settles, which is
minutes after submission and long before any approval. If notifications are
rejected until the licence is approved, every payment we take becomes money
received with no record of it on your side.

We cannot pay after approval, either: the customer is in a chat session and will
not return days later to complete a payment.

Two ways forward, and we would like your view on which:

1. **Accept the notification at any status**, and let approval govern what the
   licence costs and when it is issued — not whether the payment is recorded.
2. **We hold the notification** and re-send it once `getRequestStatus` reports
   approval. This works, but it means a settled payment sits unreported on your
   side for as long as approval takes, and it needs a retry window we would have
   to agree.

Our preference is (1): the payment is a fact whether or not the licence is
approved, and refunds are a separate decision.

### Still open from our point 1

Your reply did not say **which fields drive License Amount, Amount (Paid) and
Payment Status** on the licence request. `EPG_Amount_Paid__c: 1010` was accepted
and the notification carrying the same 1,010 moved Request Status to Payment
Verified, yet all three still displayed as `AED 0.00` / blank. If those are
formula or roll-up fields fed by a Payment record we are not creating, please
tell us what to create.

---

## Summary of what we need back

1. `EPG_Payment_Reference__c` — do you already store `notifyPayment.payment.paymentId`? (If yes, we drop the field.)
2. `EPG_Contact__c` — create the lookup, or shall we drop it?
3. Are `5320002` / `5320007` / `5320009` the complete activity set, and can an application carry several?
4. Confirm `Name` (the LR number) as the update key for `EPG_License_Request__c`.
5. What would a document download endpoint give you that the base64 upload does not?
6. Should we keep sending `EPG_Document__c` placeholder rows at all?
7. Payment notification before approval — option 1 or option 2?
8. Which fields drive License Amount, Amount (Paid) and Payment Status?
