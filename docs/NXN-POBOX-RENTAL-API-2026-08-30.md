# PO Box Rental API — payment resolved, one question left

| | |
|---|---|
| **To** | Emirates Post PO Box API team |
| **From** | 7X — NXN conversational assistant |
| **Environment** | `https://box-stg.emiratespost.ae/services/pobox` (staging) |
| **Date** | 31 August 2026 |

A rental now completes end to end against staging and the box reaches the
customer's portal. One question remains — the delivery address — plus a few
behaviours we'd like confirmed and some test reservations to release. All of it
is from live calls, using the customer's own UAE PASS session token.

---

## Payment: resolved, with two follow-ups

Your last reply was right and the flow now works. We stopped creating our own
N-Genius order, send the customer to the `paymentUrl` that `Rental/Save` returns,
and call `UpdatePayment/{paymentGateWayResponse.referenceNumber}` afterwards. A
rental completes end to end and the box appears in the customer's portal.

**Live example on staging: PO Box 902020 (MyHome, Dubai), order 260961760.**
Rented through our assistant on 31 August. Please leave it in place — the two
questions below are both about that box.

1. How long after payment does `isPaymentSuccess` flip? We currently confirm as
   soon as it returns true, but we do not know the worst case, so we do not know
   how long to wait before telling a customer something is wrong.
2. Is there any way to attach an existing N-Genius payment to a rental order —
   for reconciling the test payments already made against the unpaid orders
   listed below.

---

## The open question: the delivery address

On 902020 the portal's **Delivery Address details** panel reads
`DXB-12Dubai UAEMerkadh road, Waves, No: 221` — the components run together with
no separators. On 450294, rented before we sent an address at all, it reads
`- UAE, , No:`.

We now send `userProfile.customersAddress` (region code, street, building,
villa/apartment) and `myHomeProfile.myHomeAddress` on `Rental/Save`.

**Can `Rental/Save` populate that panel properly, and which field feeds it?** Or
is `ChangeAddress/Save` the only way in — in which case a customer cannot set
their delivery address at the point of renting, only pay to change it afterwards.
Your own rent flow does not send `customersAddress`, which may be why 450294 is
blank.

---

## Four behaviours we found by trial — please confirm they're intended

| Finding | Why it matters |
|---------|----------------|
| `Select` needs **`uniqueBoxId`** from `FreeBoxes`, not `boxId`. MyBox prefixes it (`2450063` for box `450063`), MyHome does not (`958009` for both), so it cannot be derived. `boxId` returns `108 BOX_NOT_FREE`. | Reads as "someone took it", so we told customers boxes were unavailable when they were free. |
| `paymentProperties.billingDetail` is **optional in the spec, required in practice — all six fields**. Omitted → `400 {"Error":"Error from payment gateway"}`. Partial (name + email only) → `400 … 157 ERROR_GETTING_HOLD_DETAILS`. | Neither error names the missing field, and the second points at the hold, which isn't the problem. This cost us a day. |
| A MyHome address is rejected — `173 MYHOME_ADDDRESSNOT_FOUND` — unless **`myHomeAddress.regionName`** carries an area **code** (`DXB-84`) from `masters/locations/api/Regions`. `regionCode` is ignored, and a typed area name never matches. | The area list is on a different service, and the field that takes the code is the one named for the name. Nothing in the spec or the error says so. |
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
- `LocationId` means two different things: the branch's `officeId` for MyBox, the
  **emirate code** for MyHome and MyHome Instant. The wrong one returns an empty
  list, not an error, so every branch looked sold out.
- `LocationId` is the branch's own `officeId`, not `mainOfficeId`. Where the two
  differ the location is a box hall (`155` / `101`, New Suoq Complex), and the
  `mainOfficeId` returns an empty list rather than an error.
- `Rental/Save` takes **~17s**; `Select` under 1s. Expected?
- `FreeBoxes` returns 401 with the API key alone — it needs a customer session.

**One open question (4 Sep).** A corporate `Rental/Select` is refused with an
empty error object, so we cannot tell the customer why:

```
POST /api/Rental/Select
{ "bundleId": "LI", "uniqueBoxID": "2450404",
  "poBoxExpiryDate": "2027-09-03T00:00:00+00:00", "physicalBoxRequired": true }
→ 400 {"errorDetails":{},"payload":null}
```

`2450404` came from `FreeBoxes?BundleId=LI&LocationId=244` in the same journey,
and the identical shape with `bundleId=IN` succeeds on boxes from that same list.
A personal Select that cannot proceed answers `108 BOX_NOT_FREE`, which we can
relay; this one says nothing at all. **Does a corporate rental need something on
the session we are not sending — the licence, or an approved company profile —
and can the refusal carry a code?** Staging, 4 Sep 13:32 UTC.

*We previously raised `157 ERROR_GETTING_HOLD_DETAILS` with you. That was ours — an
invented reference, a stale hold, and the partial `billingDetail` above. No action
needed.*

---

## Reservations left stranded by testing

Please release if they don't expire on their own — all Dubai:

- **Held, no order:** 378781, 378785, 378790, 378795, 378796, 378797, 379115,
  449691, 449949, 449989, 449993, 450000, 450052, 450152, 450348, 450364 ·
  **902017**, **987022** (MyHome)
- **Order created, unpaid:** 449922 · 449997 · 450063 · 450294 · 450358 ·
  417377 · 417676 — orders 260961732, 260961735, 260961736, 260961739,
  260961740, 260961741, 260961742, 260961754, 260961756, 260961757

**Do NOT release these three — they are paid and live**, and are our evidence for
the questions above: **902020** (MyHome, order 260961760), **901961** (MyHome,
260961758), **450293** (MyBox, 260961759).

---

Happy to walk through it on a call.
