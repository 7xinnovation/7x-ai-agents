# PO Box Rental API — one open question

| | |
|---|---|
| **To** | Emirates Post PO Box API team |
| **From** | 7X — NXN conversational assistant |
| **Environment** | `https://box-stg.emiratespost.ae/services/pobox` (staging) |
| **Date** | 30 August 2026 |

The rental flow works end to end against staging — availability, hold, order
creation. One design question remains, and there are a few behaviours we found
only by trial that we would like confirmed.

Everything below is from live calls on staging, with the customer's own UAE PASS
session token as the bearer.

---

## The sequence works

For completeness, since we raised `157 ERROR_GETTING_HOLD_DETAILS` with you
earlier: that was ours, not yours. Every occurrence traced back to something wrong
on our side — an invented reference, a hold belonging to a different box, and an
incomplete `billingDetail`. With a correct payload the sequence is reliable:

```jsonc
POST /api/v1/Rental/Select   { "bundleId": "IN", "uniqueBoxID": "2450063",
                               "poBoxExpiryDate": "2027-08-29T00:00:00+00:00" }
200 OK   subscriptionReferenceNumber: 260611703, minimumAmount: 370.0

POST /api/v1/Rental/Save     { "subscriptionReferenceNumber": "260611703",
                               "totalAmount": 370, "userProfile": {…},
                               "paymentProperties": { "billingDetail": {…all six fields…} } }
200 OK   orderNo: 260961740
```

No changes needed from you for this. It is recorded here only because we asked
about it before we understood it.

---

## The open question: `Save` opens its own payment

On success, `Save` returns a hosted payment page and an N-Genius order on **your**
outlet:

```jsonc
200 OK
{ "payload": {
    "orderNo": "260961739",
    "custProfID": "6542907",
    "paymentGateWayResponse": {
      "paymentUrl": "https://paypage.sandbox.ngenius-payments.com/v2?code=…",
      "referenceNumber": "4d1e9cc3-670c-45ca-9084-6496100afdf0",
      "niOrderResult": { "outletId": "b78ef8c7-ce2a-41d6-84c9-e6219557a991", "…": "…" }
    }
} }
```

We take payment on **our own** N-Genius outlet, so yours is never settled:

```jsonc
POST /api/v1/Rental/UpdatePayment/4d1e9cc3-670c-45ca-9084-6496100afdf0
200 OK
{ "payload": { "orderNumber": "260961735",
               "isPaymentSuccess": false,
               "paymentDetails": { "amountPaid": 0.0 } } }
```

The N-Genius order stays at state `STARTED`, and **the box does not appear in the
customer's portal** even though the rental record exists.

### What we'd like to know

1. Is there a way to record a rental as **already paid** — a flag, a different
   endpoint, or a payment reference we can pass in?
2. If not, is the intended flow for the customer to pay on the `paymentUrl` you
   return, and for us to poll `UpdatePayment/{referenceNumber}` until
   `isPaymentSuccess` is `true`?
3. Roughly how long after payment does `isPaymentSuccess` flip? We need to know how
   long to wait before telling a customer anything.

---

## Three things we found by trial — please confirm they're intended

| # | Finding | Why it matters |
|---|---------|----------------|
| 1 | `Select` needs **`uniqueBoxId`** from `FreeBoxes` (e.g. `2450364`), **not** `boxId` (`450364`). Sending `boxId` returns `108 BOX_NOT_FREE`. | `BOX_NOT_FREE` reads as "someone else took it". We were telling customers boxes were unavailable when they were free and we'd sent the wrong identifier. |
| 2 | `paymentProperties.billingDetail` is **optional in the spec but required in practice**, and all six fields are needed. Omitting the block returns `400 {"Error":"Error from payment gateway"}`; sending it with only `firstName`, `lastName`, `emailAddress` returns `400 … 157 ERROR_GETTING_HOLD_DETAILS`. | Neither error names the missing field, and the second one points at the hold, which is not the problem. This cost us most of a day. |
| 3 | `UpdatePayment` takes **`paymentGateWayResponse.referenceNumber`**. Passing `niOrderResult.reference` — also a UUID, in the same response — returns `500 Internal system error`. | Two UUIDs side by side with nothing to distinguish them. |

---

## Other observations

- **`Rental/Save` takes ~17 seconds** (measured: 16.95s). `Select` returns in under
  a second. Is that expected? We've raised our client timeout to 60s.
- **`Rental/Bundle`** takes `request=P` (personal) / `request=C` (corporate), not
  `EmirateCode`. With `EmirateCode` it returns 400.
- **`FreeBoxes` needs a customer session** — 401 with the API key alone.
- **`LocationId` must be the branch's own `officeId`**, not `mainOfficeId`. Naif is
  `officeId 214` / `mainOfficeId 209`; `209` returns an empty list rather than an
  error, which reads as "no boxes available".
- **Availability varies sharply by branch** (Dubai, bundle `IN`, 30 Aug):
  Dubai Central `201` → 0 · Naif `214` → 5 · Al Badaa `233` → 81 ·
  Umm Suqeim `241` → 38 · Al Barsha `244` → 318 · Al Warqa `283` → 9

---

## Reservations we've left stranded

Testing created holds and orders that were never completed. If they don't expire
on their own, could they be released?

| Box | Branch | State |
|-----|--------|-------|
| 378781, 378785, 378790 | Naif (214) | held, no order |
| 449691, 449949, 449989, 450000 | Al Barsha (244) | held, no order |
| 450152 | Al Barsha (244) | order `260961736`, unpaid |
| 449922, 449997 | Al Barsha (244) | orders `260961732`, `260961735`, unpaid |
| 450364 | Al Barsha (244) | order `260961739`, unpaid |

---

## The call sequence we're using

```
Rental/Bundle          request=P
Rental/BoxLocations    BundleId=IN, EmirateCode=DXB          → officeId per branch
Rental/FreeBoxes       BundleId=IN, LocationId=<officeId>    → { uniqueBoxId, boxId }
Rental/ExpiryDates     BundleId=IN                           → exact date strings
Rental/Select          bundleId, uniqueBoxID, poBoxExpiryDate → subscriptionReferenceNumber
Rental/Save            subscriptionReferenceNumber, totalAmount,
                       userProfile, paymentProperties.billingDetail
```

`poBoxExpiryDate` is copied verbatim from `ExpiryDates`, offset included
(`2027-08-29T00:00:00+00:00`). Recomputing it or dropping the offset returns
`400 "Invalid date value."`

Happy to jump on a call and walk through it live.
