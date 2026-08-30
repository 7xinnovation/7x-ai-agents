# PO Box Rental API — one open question

| | |
|---|---|
| **To** | Emirates Post PO Box API team |
| **From** | 7X — NXN conversational assistant |
| **Environment** | `https://box-stg.emiratespost.ae/services/pobox` (staging) |
| **Date** | 30 August 2026 |

The rental flow works end to end against staging — availability, hold, order
creation. One question remains, plus a few behaviours we'd like confirmed. All of
it is from live calls, using the customer's own UAE PASS session token.

---

## The question: `Save` opens its own payment

`Rental/Save` succeeds and returns a hosted payment page on **your** N-Genius
outlet:

```jsonc
200 OK
{ "payload": {
    "orderNo": "260961742",
    "paymentGateWayResponse": {
      "paymentUrl": "https://paypage.sandbox.ngenius-payments.com/v2?code=…",
      "referenceNumber": "8ce8f91b-c278-4068-b15b-b6a2da48e0ec",
      "niOrderResult": { "outletId": "b78ef8c7-ce2a-41d6-84c9-e6219557a991",
                         "state": "STARTED" }
    }
} }
```

We take payment on **our own** N-Genius outlet, so yours is never settled:

```jsonc
POST /api/v1/Rental/UpdatePayment/8ce8f91b-c278-4068-b15b-b6a2da48e0ec
200 OK
{ "payload": { "orderNumber": "260961742",
               "isPaymentSuccess": false,
               "paymentStatus": 2,
               "paymentDetails": { "amountPaid": 0.0, "paymentRefNo": null },
               "transactionDetails": { "poBox": "450358" } } }
```

The rental record exists and the box is reserved, but **it does not appear in the
customer's portal** — presumably because your order is unpaid.

**What we need to know:**

1. Can a rental be recorded as **already paid** — a flag, another endpoint, or a
   payment reference we can pass in?
2. If not: should the customer pay on the `paymentUrl` you return, and should we
   poll `UpdatePayment/{referenceNumber}` until `isPaymentSuccess` is `true`?
3. How long after payment does `isPaymentSuccess` flip? We need to know how long
   to wait before telling a customer anything.

---

## Three behaviours we found by trial — please confirm they're intended

| Finding | Why it matters |
|---------|----------------|
| `Select` needs **`uniqueBoxId`** from `FreeBoxes` (`2450063`), not `boxId` (`450063`). `boxId` returns `108 BOX_NOT_FREE`. | Reads as "someone took it", so we told customers boxes were unavailable when they were free. |
| `paymentProperties.billingDetail` is **optional in the spec, required in practice — all six fields**. Omitted → `400 {"Error":"Error from payment gateway"}`. Partial (name + email only) → `400 … 157 ERROR_GETTING_HOLD_DETAILS`. | Neither error names the missing field, and the second points at the hold, which isn't the problem. This cost us a day. |
| `UpdatePayment` takes **`paymentGateWayResponse.referenceNumber`**. `niOrderResult.reference` — also a UUID, same response — returns `500`. | Two UUIDs side by side with nothing to tell them apart. |

---

## Working sequence, for reference

```
Rental/Bundle        request=P                              (not EmirateCode)
Rental/BoxLocations  BundleId=IN, EmirateCode=DXB           → officeId per branch
Rental/FreeBoxes     BundleId=IN, LocationId=<officeId>     → { uniqueBoxId, boxId }
Rental/ExpiryDates   BundleId=IN                            → exact date strings
Rental/Select        bundleId, uniqueBoxID, poBoxExpiryDate → subscriptionReferenceNumber
Rental/Save          subscriptionReferenceNumber, totalAmount,
                     userProfile, paymentProperties.billingDetail
```

- `poBoxExpiryDate` must be copied **verbatim** from `ExpiryDates`, offset included
  (`2027-08-29T00:00:00+00:00`). Recomputing it returns `400 "Invalid date value."`
- `LocationId` is the branch's own `officeId`, not `mainOfficeId` — Naif is
  `214` / `209`, and `209` returns an empty list rather than an error.
- `Rental/Save` takes **~17s**; `Select` under 1s. Expected?
- `FreeBoxes` returns 401 with the API key alone — it needs a customer session.

*We previously raised `157 ERROR_GETTING_HOLD_DETAILS` with you. That was ours — an
invented reference, a stale hold, and the partial `billingDetail` above. No action
needed.*

---

## Reservations left stranded by testing

Please release if they don't expire on their own — all Dubai:

- **Held, no order:** 378781, 378785, 378790 (Naif) · 449691, 449949, 449989,
  450000 (Al Barsha)
- **Order created, unpaid:** 449922, 449997, 450063, 450152, 450358, 450364, 378797
  (Al Barsha) — orders 260961732, 260961735, 260961736, 260961739, 260961740,
  260961741, 260961742

---

Happy to walk through it on a call.
