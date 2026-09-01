# NXN assistant — every endpoint we call

| | |
|---|---|
| **Assistant** | NXN — Emirates Post PO Box assistant (chat widget on emiratespost.ae) |
| **Staging** | `https://box-stg.emiratespost.ae/services/pobox` |
| **Production** | `https://box.emiratespost.ae/services/pobox` |
| **Date** | 1 September 2026 |

Everything below is called live from the assistant. The **Used for** column says
where in the conversation it happens, so you can match each call to what the
customer sees.

**Auth.** Every call carries `X-API-KEY`. Calls marked **session** also carry
`Authorization: Bearer <customer's Emirates Post session token>`, taken from the
UAE PASS sign-in on the portal. Without it those endpoints answer `401`.

---

## 1. Identity

| Endpoint | Used for |
|---|---|
| `GET /users/api/v1/Account` | **session** — verifying the token the portal hands the widget, and reading the customer's name, Emirates ID and mobile. This is what makes the customer "signed in" to the assistant. |

Response fields we use: `payload.uaePassId`, `emiratesId`, `firstNameEN`,
`lastNameEN`, `mobileNumber`, `id`.

---

## 2. Renting a box — the main flow

Six calls in a fixed order. Each one feeds the next.

| # | Endpoint | Used for |
|---|---|---|
| 1 | `GET /api/Rental/Bundle?request=P` | The bundle cards (MyBox, MyHome, MyHome Instant). `request=C` for corporate. |
| 2 | `GET /api/Rental/BoxLocations` | The branch cards for the chosen emirate. |
| 3 | `GET /api/Rental/FreeBoxes` | The list of available box numbers to pick from. Also called once per branch to show which branches have boxes at all. |
| 4 | `GET /api/Rental/ExpiryDates` | The rental duration options. |
| 5 | `POST /api/Rental/Select` **session** | Holds the box, immediately before payment. Returns the real total. |
| 6 | `POST /api/Rental/Save` **session** | Creates the order and opens the payment on your gateway. |
| 7 | `POST /api/Rental/UpdatePayment/{ref}` **session** | Confirms the payment after the customer pays. |

### 1. Bundles

```
GET /api/Rental/Bundle?request=P
→ [{ bundle_Id: "IN", name_En: "MyBox", bundle_Price: "300", features_En: "…||…" }, …]
```

We show `bundle_Price` as the annual rental. **`bundle_Price` does not include the
registration fee** — MyBox reads 300 and the customer pays 370 — so the card also
says a one-time registration fee applies. *Is there an endpoint that returns that
fee before the box is held? Today we can only name it, not price it.*

### 2. Branches

```
GET /api/Rental/BoxLocations?BundleId=IN&EmirateCode=DXB
→ [{ officeId: "201", nameEn: "Dubai Central Post Office",
     workingTime: " 08:00 AM- 20:00 PM", workingDays: " Monday - Friday  ",
     gpsLat, gpsLong, mainOfficeId }, …]
```

We use `officeId` (**not** `mainOfficeId`), the name, the map pin, and the working
hours — which we parse to mark a branch "Closed now" and offer an open one instead.

### 3. Available boxes

```
GET /api/Rental/FreeBoxes?BundleId=IN&LocationId=244
→ [{ uniqueBoxId: "2450063", boxId: "450063" }, …]
```

- `LocationId` means **two different things**: the branch `officeId` for MyBox, the
  **emirate code** for MyHome and MyHome Instant. The wrong one returns an empty
  list rather than an error.
- We show `boxId` to the customer and keep `uniqueBoxId` for step 5. MyBox prefixes
  it with `2`, MyHome does not (`958009` is both), so it cannot be derived.
- We also call this once per branch when showing the branch list, purely to count
  what is free — Dubai Central had 0 MyBox boxes on 31 Aug while being offered as
  the customer's usual branch. *A count on `BoxLocations` would save 5–15 calls.*

### 4. Durations

```
GET /api/Rental/ExpiryDates?BundleId=IN
→ { minDate, maxDate, dates: ["2027-08-30T00:00:00+00:00", …] }
```

Copied **verbatim** into step 5, offset included. Recomputing returns
`400 "Invalid date value."`

### 5. Hold the box

```
POST /api/Rental/Select                                     (session)
{ "bundleId": "MYHOME3", "uniqueBoxID": "902020",
  "poBoxExpiryDate": "2027-08-30T00:00:00+00:00" }

→ { "subscriptionReferenceNumber": "260611719",
    "subcsriptionReferenceNumberExpiryDate": "…",     ← hold lapses in ~1 hour
    "minimumAmount": 765.0,                            ← the REAL total
    "priceDetails": [ { serviceType: "RENT", totalAmount: 695 },
                      { serviceType: "REGISTRATION", … }, … ] }
```

This is the first point at which the true price exists, so it is where the payment
summary comes from. `priceDetails` also decides which extras are on offer: MyHome
has no `KEY-DELIVERY` line, and sending one anyway returns
`223 INVALID_ADDITIONAL_SERVICE`.

Called at the **last moment before payment**, never when the customer picks a box —
there is no endpoint to release a hold, so an abandoned journey takes a box out of
circulation permanently. *Is there a release endpoint we have missed?*

### 6. Create the order

```
POST /api/Rental/Save                                       (session, ~17s)
{ "subscriptionReferenceNumber": "260611719",     ← from step 5, never our own ref
  "totalAmount": 765,
  "requestSource": "PoBoxAIBot",
  "userProfile": { customerNameEN, mobileNumber, email, idNumber, idType,
                   customersAddress: { emirateCode, regionCode, regionName,
                                       streetOrLandmark, buildingName,
                                       villaOrApartmentNo, detailedAddress } },
  "myHomeProfile": {                              ← MyHome / MyHome Instant only
      emailID, mobileNo, deliveryOfficeID: "201",
      myHomeAddress: { emirateCode: "DXB", regionName: "DXB-12", … } },
  "mainCorporateProfile": {                       ← corporate rentals only
      companyNameEn, companyNameAr, tradeLicenseNo, emirateCode,
      issuingEntity, issuingDate, tradeLicenseExpiryDate, attachments },
  "IsCorporateInfoAutoPopulated": true,           ← see below
  "keyDeliveryAddress": { name, mobileNo, emirateCode, deliveryAddress },
  "additionalServiceDetailList": [ { quantity: 1, serviceType: "KEY-DELIVERY" } ],
  "paymentProperties": {
      billingDetail: { firstName, lastName, emailAddress,
                       address, cityName, countryName },   ← all six required
      saveCreditCard, isAutomaticSubscriptionEnabled, paymentReturnUrl } }

→ { "orderNo": "260961760",
    "paymentGateWayResponse": { "paymentUrl": "https://paypage…",
                                "referenceNumber": "8ce8f91b-…" } }
```

Three things that are not in the spec and cost us time:

- `billingDetail` is optional in the spec and **required in practice, all six
  fields**. Missing → `400 "Error from payment gateway"`. Partial → `157
  ERROR_GETTING_HOLD_DETAILS`, which points at the hold and is not about the hold.
- `myHomeAddress.**regionName**` must carry an area **code** (`DXB-12`) from the
  masters service (§6). `regionCode` is ignored, and a typed area name returns
  `173 MYHOME_ADDDRESSNOT_FOUND`.
- `additionalServiceDetailList` may only name services that appeared in
  `priceDetails`.

**`IsCorporateInfoAutoPopulated`** is `true` when the company came from the GSB
licence registry (§5) — details Emirates Post already holds — and `false` when the
customer typed the licence number and uploaded the documents. We set it from what
the registry actually returned during the conversation, not from anything the
assistant asserts. *Your portal also skips the trade licence, owner ID front and
owner ID back attachments entirely when the flag is true — should we do the same,
and stop asking those customers to upload anything?*

The customer pays at `paymentUrl`. We keep `referenceNumber` for step 7.

### 7. Confirm the payment

```
POST /api/Rental/UpdatePayment/8ce8f91b-…                   (session)
→ { "orderNumber": "260961760", "isPaymentSuccess": true,
    "paymentDetails": { amountPaid, paymentRefNo },
    "transactionDetails": { poBox: "902020" } }
```

Takes `paymentGateWayResponse.referenceNumber`. The other UUID in the same
response, `niOrderResult.reference`, returns `500`. We confirm the booking only on
`isPaymentSuccess: true`. *How long can that take to flip?*

---

## 3. After the rental

| Endpoint | Used for |
|---|---|
| `POST /api/UpdateAutoRenewConfig` **session** | Setting auto-renewal to whatever the customer chose, once the box exists. |
| `GET /api/Rental/GetRejectedBoxDetails` **session** | Explaining a rejected box to the customer. |

```
POST /api/UpdateAutoRenewConfig
{ requestSource: "PoBoxAIBot", custProfId, uniqueBoxId, isAutoReNewEnabled }
```

`custProfId` and `uniqueBoxId` come from `Renewal/Details` (§5), which is the only
place they exist. Note `isAutomaticSubscriptionEnabled` on `Rental/Save` does
**not** move this switch — box 450294 was rented with it on and the portal shows
auto-renew off. This call is the only thing that changes it.

---

## 4. Renewing a box

| Endpoint | Used for |
|---|---|
| `GET /api/Renewal/Details` **session** | The box's current bundle, expiry and holder. Drives the whole renewal. |
| `GET /api/Guest/Renewal/Details` | Same, for a customer who is not signed in. |
| `POST /api/Guest/Renewal/Pricing` | The price per renewal duration, before the customer picks. |
| `GET /api/Renewal/GetRenewedByOptions` · `GET /api/Guest/Renewal/GetRenewedByOptions` | "Who is renewing" options. |
| `GET /api/Renewal/GetAdditionalOptions` | The add-ons offered at renewal. |
| `GET /api/Renewal/GetChargesForAdditionalServices` · Guest variant | Prices those add-ons. |
| `GET /api/Renewal/AdditionalDetails` **session** | Extra detail on the renewal record. |
| `GET /api/Renewal/GetAgents` **session** | Agents already on the box. |
| `GET /api/Renewal/ValidateCancel` **session** | Whether a renewal can still be cancelled. |
| `GET /api/Rental/renewaldetails` **session** | Renewal detail on the rental side. |
| `POST /api/Guest/Renewal/Save` | Records the renewal. |

```
GET /api/Renewal/Details?BoxNumber=902020&EmirateCode=DXB
→ { poBoxRenewalDetails: {
      poBoxDetails: { boxNumber, uniqueBoxId, officeId, boxStatus,
                      assignedOfficeName, isAutoRenewEnabled },
      poBoxSubscriptionDetails: { bundle, currentExpiryDate, rentType,
                                  currentBundle, listPossibleBundles },
      poBoxCustomerDetails: { … },
      poBoxAddressDetails: { custProfId, fullName, email, mobileNumber,
                             region, street, buildingName, apartmentNo } } }
```

Note the payload is nested one level deeper than the field names suggest —
`payload.poBoxRenewalDetails.poBoxDetails`, not `payload.poBoxDetails`.

```
POST /api/Guest/Renewal/Pricing
{ boxNumber, expiryDate: "2030-12-31T00:00:00", newBundleId, isBundleChanged }
```

`expiryDate` must be **year-end and in the future**: current expiry year + renewal
years, then `-12-31T00:00:00`. Anything else errors.

**Open question — the delivery address.** `poBoxAddressDetails` is what the
portal's "Delivery Address details" panel shows. On 902020 it renders as
`DXB-12Dubai UAEMerkadh road, Waves, No: 221`, with the components run together;
on 450294, rented before we sent an address, it reads `- UAE, , No:`. Can
`Rental/Save` populate it properly, and which field feeds it — or is
`ChangeAddress/Save` (a paid service) the only way in?

---

## 5. The customer's boxes and companies

| Endpoint | Used for |
|---|---|
| `GET /users/api/PoBoxes` **session** | The "Account Pulse" — every box the signed-in customer holds. |
| `GET /users/api/v1/PoBoxes/getpoboxesbymobile?EmiratesId=…` **session** | The same list by Emirates ID. |
| `GET /api/MOE/GetIssuingEntities` | The list of trade-licence issuing authorities. |
| `GET /api/MOE/GetEntitiesById?entityCode=…` | Companies under one authority, or under an Emirates ID. |
| `GET /api/MOE/GetEntitiesByLicenseNo` | One company plus its owners — the ownership check for a corporate rental. |
| `GET /api/Guest/GetIssuingEntitiesEscher` | Issuing authorities for the guest flow. |

```
GET /users/api/PoBoxes
→ [{ boxNumber: 417676, uniqueBoxId: 2417676, bundleId: "BR",
     rentType: "C", status: 14, ownerName: "PRINCIPLE EXPRESS CARGO L.L.C",
     custProfId, expiryDate, cityCode, assignedBranchName }, …]
```

`rentType: "C"` plus `ownerName` is how the assistant answers "what companies do I
have" — a corporate box names its company and nothing else does. Status codes are
read as the portal groups them: `1/10/12/13` Active, `14` Pending approval, `15`
Rejected, `9` Hold, `0/5` Free.

**Note on `GetEntitiesById`:** on staging it returns the same three stub companies
(Shams Tourist LLC, SA Aluminium Glass Fixing LLC, Al Felaj Transport) for any
input. *Please confirm it is genuinely keyed to the Emirates ID in production.*

---

## 6. Outside the PO Box API

Two services we call that are not part of your API, listed so nothing is a
surprise.

| Service | Endpoint | Used for |
|---|---|---|
| **Shipping** (yours) | `GET /shipping/api/MasterLocation/ReverseByProvider?Longitude=&Latitude=&Provider=1` **session** | Turning a pinned map location into an address — returns `emirate`, `emirateCode`, `area`, `street`, `building`. The customer drops a pin instead of naming a district. |
| **Shipping** (yours) | `GET /shipping/api/MasterLocation/Territories/Reversegeo?Take=1&Skip=0&Lng=&Lat=` **session** | Whether Emirates Post delivers to that point at all, before a MyHome rental gets any further. |
| **Masters** `masters-stg.epservices.ae` / `masters.epservices.ae` | `GET /locations/api/Regions?EmirateCode=DXB` | The delivery areas a MyHome address must sit in. Returns `{ code: "DXB-84", nameEn: "Nad Al Sheeba 1", isDeliveryAllowed }`. The customer picks one and its **code** goes into `myHomeAddress.regionName`. Same service your rent flow uses. |
| **Customer Pulse** `sandboxapi.customerpulse.gov.ae` | `POST /api/v2/transaction/create/` then `POST /api/v2/survey/token/` | The satisfaction survey, shown as a modal once `UpdatePayment` confirms the payment. Same two-step and the same 2-second delay as your payment success page. |

Customer Pulse uses linking ids `entity Q · channel kn · survey C · main service D2`
and sub-service `UP` rent personal, `UU` rent corporate, `UQ` renew personal,
`UV` renew corporate. *We have staging credentials only — production base URL and
API key still needed.*

---

## 7. Available but not connected

Disabled deliberately, so the assistant cannot call them:

`ChangeAddress/Save` · `ChangeLock/Save` and their `Confirm` pairs ·
`Renewal/Save` · `Renewal/Pricing` · `Renewal/ProcessPayment` ·
`Renewal/SaveAgent` · `Renewal/UpdateAgent` · `Renewal/VerifyCancel` ·
`DELETE /api/Renewal` · `Rental/UpdateRejectedBoxDetails` · `CRM/ApproveRental` ·
`CRM/ApproveAgent` · `Account/passwordLessToken` · `Guest/UpdateAutoRenewConfig` ·
`Guest/Renewal/ConfirmPayment` · `Guest/Renewal/SendNotification`

Tell us which of these you want the assistant to use and we will enable them.

---

## Open questions, in one place

1. An endpoint for the **registration fee** before the box is held, so the bundle
   card can show the real starting price.
2. A **box count** on `BoxLocations`, so we stop calling `FreeBoxes` per branch.
3. A way to **release a hold** — today an abandoned journey loses a box for good.
4. How long `isPaymentSuccess` can take to flip after payment.
5. Whether `Rental/Save` can populate the **delivery address** panel, or only
   `ChangeAddress/Save`.
6. Whether `MOE/GetEntitiesById` is really keyed to the Emirates ID in production.
7. Whether a corporate rental with `IsCorporateInfoAutoPopulated: true` should
   send **no** document attachments, as your portal does.
8. A shared identifier between the geocoder's area names and the masters region
   list — "Marsa Dubai" and "Dubai Marina" are the same place, and nothing joins
   them.

*A step-by-step version of this, showing each flow in call order with payloads,
is in `NXN-API-FLOWS.pdf`.*
