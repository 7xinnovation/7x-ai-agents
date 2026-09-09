# Reply to EPGL's review of LR-37214

**To:** Fuad Alnsour, EPGL Salesforce
**Date:** 8 September 2026
**Re:** your review of `docs/EPGL-SUBMISSION-TRACE-LR-37214.md`

Thank you — that was exactly the level of detail we needed. Every rename in
sections 1–3 is applied and live on our staging environment. Below: what we
changed, what we need from you, and three things in your reply we would like to
settle before they reach production.

---

## BLOCKER — no agent-sourced submission can pass your Contact validation

Every submission we make is rejected with:

> `Rolled back due to allOrNone=true: Either of Is Primary Contact or  Is Secondary Contact should be selected`

We cannot satisfy this rule, and we do not think anyone calling the API can.

**What we tried.** Your spec documents `Secondary_Contact` (enum `'True'|'False'`)
on Contact, so we sent it. No change. We then described the object with our own
integration credentials:

| Field | Exists | createable | updateable |
|---|---|---|---|
| `Secondary_Contact` | **no** | — | — |
| `Is_Primary_Contact__c` | yes | **false** | **false** |
| `Is_Secondary_Contact__c` | yes | **false** | **false** |
| `EPG_Designation__c` | yes | **false** | **false** |

So: the field your published spec names does not exist on the object, and the two
fields the validation actually reads cannot be written by our user. We send
`Is_Primary_Contact__c: true` regardless — Salesforce ignores a field the caller
cannot write, and the payload will be correct the moment access is granted.

**What we think is needed, in order of likelihood:**

1. **Field-level security.** `createable:false` is reported per profile, so this
   may simply be that the integration user's profile has no write access to those
   two fields. Granting it would fix this outright.
2. **Or the validation rule should not apply to agent-sourced requests.** The
   composite already carries `isAgentSource: true`; if the rule is meant for
   records created by hand in the UI, that flag is the natural exemption.
3. **Or your CompositeHandler should set the designation itself**, from something
   we *can* send.

`EPG_Designation__c` is the same problem waiting to happen: your renewal notes
require at least one Contact whose designation contains "Accountant", and that
field is equally read-only to us.

Please also correct the spec — it documents a Contact field that does not exist
and omits the two that a validation rule requires.

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

### One thing in v1.2.0 still disagrees with your review

Thank you for the updated spec — v1.2.0 confirms `EPG_Company__c`,
`AccountId__c`, `EPG_Emirates_ID__c`, `serviceId__c`, `serviceNameEN__c` and
`Activity_Codes__c` exactly as you described them, and `Members__c` now carries
only `AccountId__c` and `Name`.

Two points where we have followed your review over the document, so you know
what we are sending:

- **Terms.** The spec disagrees with itself: the renewal example sets
  `EPG_Terms_and_Conditions__c` on the licence request, while the
  `EPGLicenseRequest` schema still lists `Terms_Conditions_Accepted__c`. Your
  review says rename it, so we send **`EPG_Terms_and_Conditions__c`**. Worth
  correcting the schema before someone builds to it.
- **Emirate and region.** Still absent from v1.2.0, as you noted. We send
  `EPG_Current_Emirate__c` and `EPG_Current_Region__c` on the licence request and
  leave `EPG_Emirates__c` / `EPG_Region__c` on the Account, where the spec does
  document them.

We also noted the new `/services/data/v62.0/query` endpoint (APIs 7 & 8) for
company profile and IDEP quarterly figures, and the field notes attached to it.
We are not using it yet — we will come back to you separately about that.

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

## 7. Payment — your process map and this rule disagree

We are working to **Payment Process with Agentic — Process Map**, which is your
document. In it, the customer **submits the application and pays in the same
step**, and verification comes afterwards:

```
submit + pay  ->  payment processed  ->  receipt issued
              ->  request verified  ->  licence copy generated
```

So payment precedes verification by design. A rule that rejects payment
notifications until the licence is approved would reject every notification the
Online Payment branch produces, because in your own flow the money always
settles first.

**Please confirm which is authoritative** — the process map, or the approval
gate. We have built to the map and would rather not change it on our reading of
a Teams message.

If the map stands, our request is simply that the notification is accepted at
submission-time status, and that approval governs when the licence is issued
rather than whether the payment is recorded.

### The second payment option is not built yet

The map offers the customer a choice we do not currently present:

- **Online Payment (Payment Gateway)** — built and working. This is what
  LR-37214 used.
- **Current System (VIBAN)** — **not built.** The map has the assistant create
  the Salesforce account and then notify Finance to request a Virtual IBAN, after
  which your Finance Officer issues the VIBAN, pastes it into the application,
  and the customer receives it by email and pays by transfer. Finance then
  confirms receipt and issues the receipt manually.

We would like to build it, and we need two things from you:

1. **How should the assistant notify Finance of a VIBAN request?** A Salesforce
   field or status we set on the application, a queue record we create, an email
   address — whichever fits your process. Right now we have no mechanism at all.
2. **Who tells the licence request the payment arrived?** In this branch the
   money never touches our gateway, so we cannot send the payment notification.
   We assume your Finance Officer confirming receipt is what marks it paid, and
   that we should send nothing. Please confirm.

Note that in the VIBAN branch the approval gate is moot from our side — we never
send a payment notification for it.

### Still open from our point 1

Your reply did not say **which fields drive License Amount, Amount (Paid) and
Payment Status** on the licence request. `EPG_Amount_Paid__c: 1010` was accepted
and the notification carrying the same 1,010 moved Request Status to Payment
Verified, yet all three still displayed as `AED 0.00` / blank. Please tell us
what populates them — and whether we should be sending `EPG_Amount_Paid__c` at
all, or whether the notification alone is meant to.

### One thing on our side, either way

The fee amount is configured on our side — a flat AED 1,000 on staging and AED
150,000 on production — and neither matches the AED 100,000 annual licensing fee
in your clarification of 14 August. **What is the correct figure for a new
licence, and is it fixed or per-application?** If it varies, we need a field or
endpoint to read it from rather than a number configured by us.

---

## Summary of what we need back

1. `EPG_Payment_Reference__c` — do you already store `notifyPayment.payment.paymentId`? (If yes, we drop the field.)
2. `EPG_Contact__c` — create the lookup, or shall we drop it?
3. Are `5320002` / `5320007` / `5320009` the complete activity set, and can an application carry several?
4. Confirm `Name` (the LR number) as the update key for `EPG_License_Request__c`.
5. What would a document download endpoint give you that the base64 upload does not?
6. Should we keep sending `EPG_Document__c` placeholder rows at all?
7. **Which is authoritative — the process map (pay at submission), or the approval gate?** We have built to the map.
8. How should the assistant notify Finance to request a Virtual IBAN, and who marks that branch paid?
9. Which fields drive License Amount, Amount (Paid) and Payment Status — and should we be sending `EPG_Amount_Paid__c` at all?
10. What is the correct new-licence fee, and is it fixed or per-application?
