# NXN assistant — API call flows

| | |
|---|---|
| **Assistant** | NXN — Emirates Post PO Box assistant |
| **Staging** | `https://box-stg.emiratespost.ae/services/pobox` |
| **Production** | `https://box.emiratespost.ae/services/pobox` |
| **Date** | 1 September 2026 |

Every call the assistant makes, in the order it makes them, with the payload.
Each step says what the customer is doing, which call it triggers, and what we
take from the response.

**Reading it.** `(key)` = `X-API-KEY` only. `(session)` = `X-API-KEY` plus
`Authorization: Bearer <customer's Emirates Post token>` from their UAE PASS
sign-in. Payloads are real, captured from staging.

---

# Flow A — Rent a personal PO Box (MyBox)

### A0 · Customer opens the chat signed in

```
GET /users/api/v1/Account                                        (session)
```
**Why** Verify the token the portal handed us, and read who they are.
**Take** `uaePassId`, `emiratesId`, `firstNameEN`, `lastNameEN`, `mobileNumber`.

```
GET /users/api/PoBoxes                                           (session)
```
**Why** The "Account Pulse" — what they already hold, so we never ask for a box
number they own. Runs once per conversation.
**Take** per box: `boxNumber`, `bundleId`, `expiryDate`, `status`, `rentType`,
`ownerName`, `custProfId`.

---

### A1 · "I want a new PO Box" → show the plans

```
GET /api/Rental/Bundle?request=P                                 (key)
```
**Why** The bundle cards. `request=C` for corporate.
```jsonc
→ [ { "bundle_Id": "IN", "name_En": "MyBox", "bundle_Price": "300",
      "features_En": "10% off International Standard…||…" },
    { "bundle_Id": "MYHOME3", "name_En": "MyHome", "bundle_Price": "695" },
    { "bundle_Id": "MYHOMEF", "name_En": "MyHome Instant", "bundle_Price": "995" } ]
```
**Take** `bundle_Id`, `name_En`, `bundle_Price`, `features_En`.
**Note** `bundle_Price` is the annual rental only. The card also says a one-time
registration fee applies, because we cannot price it until step A5.

---

### A2 · Customer picks an emirate → show branches

```
GET /api/Rental/BoxLocations?BundleId=IN&EmirateCode=DXB         (key)
```
**Why** The branch cards, their map pins and their opening hours.
```jsonc
→ [ { "officeId": "201", "nameEn": "Dubai Central Post Office",
      "workingTime": " 08:00 AM- 20:00 PM", "workingDays": " Monday - Friday  ",
      "gpsLat": "25.245295", "gpsLong": "55.308596", "mainOfficeId": "201" }, … ]
```
**Take** `officeId` (**not** `mainOfficeId`), `nameEn`, the coordinates, and the
hours — which we parse to mark a branch "Closed now" and name an open one.

```
GET /api/Rental/FreeBoxes?BundleId=IN&LocationId=<officeId>      (session)   × up to 15
```
**Why** There is no box count on `BoxLocations`, so we call the availability
lookup once per branch purely to count. Dubai Central had **0** free MyBox boxes
on 31 Aug while being offered as the customer's usual branch.
**Take** the array length. A branch with 0 is shown greyed and cannot be chosen.

---

### A3 · Customer picks a branch → show available numbers

```
GET /api/Rental/FreeBoxes?BundleId=IN&LocationId=244             (session)
```
```jsonc
→ [ { "uniqueBoxId": "2450063", "boxId": "450063" }, … ]
```
**Take** show `boxId`; keep `uniqueBoxId` for A5.
**Note** `LocationId` is the branch `officeId` for MyBox but the **emirate code**
for MyHome. `uniqueBoxId` cannot be derived — MyBox prefixes `2`, MyHome does not.

---

### A4 · Customer picks a number → show durations

```
GET /api/Rental/ExpiryDates?BundleId=IN                          (key)
```
```jsonc
→ { "minDate": "…", "maxDate": "…",
    "dates": [ "2027-08-30T00:00:00+00:00", … ] }
```
**Take** one date string, copied **verbatim** into A5 — offset included.
Recomputing it returns `400 "Invalid date value."`

---

### A5 · Customer confirms the summary → hold the box

Called at the **last moment before payment**, never when the box is picked: a
hold cannot be released, so an abandoned journey loses that box permanently.

```
POST /api/Rental/Select                                          (session)
```
```jsonc
{ "bundleId": "IN",
  "uniqueBoxID": "2450063",                    // from A3, copied exactly
  "poBoxExpiryDate": "2027-08-30T00:00:00+00:00" }
```
```jsonc
→ { "subscriptionReferenceNumber": "260611719",
    "subcsriptionReferenceNumberExpiryDate": "…",   // ~1 hour
    "minimumAmount": 370.0,                          // the REAL total
    "priceDetails": [ { "serviceType": "RENT", "totalAmount": 300 },
                      { "serviceType": "REGISTRATION", "totalAmount": 70 } ] }
```
**Take** three things, all of which the next step needs:
- `subscriptionReferenceNumber` → A6. Our own reference is not this.
- `minimumAmount` → the price we show and charge.
- `priceDetails` → the breakdown, **and** which extras exist for this box. A
  `serviceType` absent from it cannot be added in A6.

---

### A6 · Create the order

```
POST /api/Rental/Save                                            (session, ~17s)
```
```jsonc
{ "subscriptionReferenceNumber": "260611719",
  "totalAmount": 370,
  "requestSource": "PoBoxAIBot",
  "userProfile": {
    "customerNameEN": "Emre Karayalcin", "idType": "EmiratesID",
    "idNumber": "784199983926421", "mobileNumber": "0553708000",
    "email": "…",
    "customersAddress": { "emirateCode": "DXB", "regionCode": "DXB-12",
                          "regionName": "Makhtoum Road", "streetOrLandmark": "…",
                          "buildingName": "221", "villaOrApartmentNo": "21",
                          "detailedAddress": "…", "countryName": "United Arab Emirates" } },
  "keyDeliveryAddress": { "name": "…", "mobileNo": "…",
                          "emirateCode": "DXB", "deliveryAddress": "…" },
  "additionalServiceDetailList": [ { "quantity": 1, "serviceType": "KEY-DELIVERY" } ],
  "paymentProperties": {
    "billingDetail": { "firstName": "Emre", "lastName": "Karayalcin",
                       "emailAddress": "…", "address": "DXB",
                       "cityName": "DXB", "countryName": "United Arab Emirates" },
    "saveCreditCard": true, "isAutomaticSubscriptionEnabled": true,
    "paymentReturnUrl": "https://7xagents.7x-lab.com/api/payments/ext-return" } }
```
```jsonc
→ { "orderNo": "260961760",
    "paymentGateWayResponse": {
        "paymentUrl": "https://paypage.sandbox.ngenius-payments.com/v2?code=…",
        "referenceNumber": "8ce8f91b-c278-4068-b15b-b6a2da48e0ec",
        "niOrderResult": { "state": "STARTED" } } }
```
**Take** `paymentUrl` → the customer pays there. `referenceNumber` → A7.

**Three things not in the spec, each of which cost us a day**

| | |
|---|---|
| `billingDetail` is optional in the spec, **required in practice, all six fields**. | Missing → `400 "Error from payment gateway"`. Partial → `157 ERROR_GETTING_HOLD_DETAILS`, which names the hold and is not about the hold. |
| `additionalServiceDetailList` may only name a `serviceType` that appeared in A5's `priceDetails`. | Otherwise `223 INVALID_ADDITIONAL_SERVICE`, and the rental stops. |
| `UpdatePayment` takes `paymentGateWayResponse.referenceNumber`. | `niOrderResult.reference` sits beside it, is also a UUID, and returns `500`. |

---

### A7 · Customer says they have paid → confirm

```
POST /api/Rental/UpdatePayment/8ce8f91b-c278-4068-b15b-b6a2da48e0ec   (session)
```
```jsonc
→ { "orderNumber": "260961760",
    "isPaymentSuccess": true,
    "paymentDetails": { "amountPaid": 370.0, "paymentRefNo": "…" },
    "transactionDetails": { "poBox": "450293" } }
```
**Take** `isPaymentSuccess`. Only `true` confirms the booking — an `orderNo`
alone is not a paid order.

---

### A8 · Set auto-renewal to what they chose

```
GET  /api/Renewal/Details?BoxNumber=450293&EmirateCode=DXB       (session)
POST /api/UpdateAutoRenewConfig                                  (session)
```
```jsonc
{ "requestSource": "PoBoxAIBot", "custProfId": "6542925",
  "uniqueBoxId": "902020", "isAutoReNewEnabled": true }
```
**Why** `isAutomaticSubscriptionEnabled` in A6 does **not** move the box's own
switch — 450294 was rented with it on and the portal shows auto-renew off. This
call is the only thing that changes it. `custProfId` and `uniqueBoxId` exist
nowhere until the box does, hence the read first.

---

### A9 · Show the satisfaction survey

```
POST https://sandboxapi.customerpulse.gov.ae/api/v2/transaction/create/
POST https://sandboxapi.customerpulse.gov.ae/api/v2/survey/token/
```
Not Emirates Post's API. Fired only after A7 returns `isPaymentSuccess: true`,
which is where the portal's own success page fires it.

---

# Flow B — Rent a MyHome box

Same as Flow A, with four differences.

### B2 · Branches are listed, but boxes are not held at them

```
GET /api/Rental/FreeBoxes?BundleId=MYHOME3&LocationId=DXB        (session)
```
`LocationId` is the **emirate code**, not the `officeId`. Sending an `officeId`
returns an empty list rather than an error, so every branch looked sold out while
the portal showed 468 available. One call answers for the whole emirate.

### B3 · `uniqueBoxId` has no prefix

```jsonc
→ [ { "uniqueBoxId": "958009", "boxId": "958009" }, … ]
```
MyBox returns `2450063` for box `450063`; MyHome returns the same number twice.
There is no rule — the value must be copied from this response.

### B5 · There is no key courier

`priceDetails` carries no `KEY-DELIVERY` line, because the key comes with the
box. The option is not offered and the line is not sent.

### B6 · The home address, which the box is delivered to

```jsonc
"myHomeProfile": {
  "emailID": "…", "mobileNo": "…",
  "deliveryOfficeID": "201",                      // the branch they chose
  "myHomeAddress": {
    "emirateCode": "DXB",
    "regionName": "DXB-12",                       // an area CODE, not a name
    "streetOrLandmark": "Sobha Road",
    "buildingName": "221",
    "villaOrApartmentNo": "21",
    "detailedAddress": "Sobha Road, Building 221, Apt 21, Makhtoum Road, Dubai" } }
```
`regionName` must carry a **code** from the masters service. `regionCode` is
ignored, and a typed area name returns `173 MYHOME_ADDDRESSNOT_FOUND` — an error
that names no field.

**How we get that code.** The customer pins their address on a map:

```
GET /shipping/api/MasterLocation/ReverseByProvider
        ?Longitude=55.1993&Latitude=25.1107&Provider=1           (session)
→ { "emirateCode": "DXB", "emirate": "Dubai Emirate",
    "area": "Al Barsha 1", "district": "Al Barsha 1",
    "street": "Casablanca 01 street", "building": "5, Casablanca 01 street" }

GET /shipping/api/MasterLocation/Territories/Reversegeo
        ?Take=1&Skip=0&Lng=55.1993&Lat=25.1107                   (session)
→ { "list": [ { "nameEn": "Al Barsha 1", "isOutOfService": false, "isOda": false } ] }

GET https://masters-stg.epservices.ae/locations/api/Regions?EmirateCode=DXB
→ { "data": { "list": [ { "code": "DXB-150", "nameEn": "Al Barsha 1",
                          "isDeliveryAllowed": true }, … ] } }
```

Both responses arrive as **JSON inside a JSON string** — the body parses to a
string that has to be parsed again.

*Open: the two services spell places differently. The geocoder answers "Nadd Al
Shiba 1" where the masters list says "Nad Al Sheeba 1", and "Marsa Dubai" where
it says "Dubai Marina". We match with tolerance and let the customer confirm, but
a shared identifier would remove the guesswork.*

---

# Flow C — Rent a corporate PO Box

Flow A, plus company verification before the hold.

### C1 · Identify the company — the registry first

```
GET /api/MOE/GetEntitiesById?entityCode=784199983926421          (session)
```
**Why** The companies registered to the customer's own Emirates ID, so they pick
rather than type. Only if this returns nothing:

```
GET /api/MOE/GetIssuingEntities                                  (key)
GET /api/MOE/GetEntitiesByLicenseNo?entityCode=<authority>&licenseNo=<no>   (key)
```
**Take** `tradeLicenseNo`, `nameEn`, `nameAr`, `emirateCode`, `issuingEntity`,
`issueDate`, `expiryDate`, and `ownerDetails[]` for the ownership check — the
only place the owners' Emirates IDs appear.

### C6 · The company on the order

```jsonc
"mainCorporateProfile": {
  "companyNameEn": "…", "companyNameAr": "…",
  "tradeLicenseNo": "…", "emirateCode": "DXB",
  "issuingEntity": "…", "issuingDate": "…", "tradeLicenseExpiryDate": "…",
  "attachments": [ /* trade licence, owner ID front, owner ID back */ ] },
"IsCorporateInfoAutoPopulated": true
```
`true` when the company came from the registry above — details Emirates Post
already holds — and `false` when the customer typed the licence number and
uploaded the documents. We set it from what the registry actually returned in
the conversation.

*Open: your portal sends **no attachments at all** when the flag is true. Should
we do the same, and stop asking those customers to upload anything?*

### C7 · After payment the box is not yet active

```jsonc
GET /users/api/PoBoxes → { "boxNumber": 417676, "rentType": "C", "status": 14,
                            "ownerName": "PRINCIPLE EXPRESS CARGO L.L.C" }
```
`status: 14` is **Pending approval** — Emirates Post reviewing the trade licence.
Status codes as your own filter endpoint groups them: `1/10/12/13` Active,
`14` Pending approval, `15` Rejected, `9` Hold, `0/5` Free.

---

# Flow D — Renew a box

### D1 · Read the box

```
GET /api/Renewal/Details?BoxNumber=902020&EmirateCode=DXB        (session)
GET /api/Guest/Renewal/Details?…                                 (key, not signed in)
```
```jsonc
→ { "poBoxRenewalDetails": {
      "poBoxDetails": { "boxNumber", "uniqueBoxId", "officeId", "boxStatus",
                        "assignedOfficeName", "isAutoRenewEnabled" },
      "poBoxSubscriptionDetails": { "bundle", "currentExpiryDate", "rentType",
                                    "currentBundle", "listPossibleBundles" },
      "poBoxCustomerDetails": { … },
      "poBoxAddressDetails": { "custProfId", "fullName", "email", "mobileNumber",
                               "region", "street", "buildingName", "apartmentNo" } } }
```
**Note** the record sits one level deeper than the field names suggest —
`payload.poBoxRenewalDetails.poBoxDetails`, not `payload.poBoxDetails`.

### D2 · Price each duration

```
POST /api/Guest/Renewal/Pricing                                  (key)
{ "boxNumber": "902020", "expiryDate": "2029-12-31T00:00:00",
  "newBundleId": "MYHOME3", "isBundleChanged": false }
```
`expiryDate` must be **year-end and in the future**: the current expiry's year
plus the renewal years, then `-12-31T00:00:00`. Anything else errors.

### D3 · Options and add-ons

```
GET /api/Renewal/GetRenewedByOptions                             (session)
GET /api/Renewal/GetAdditionalOptions                            (session)
GET /api/Renewal/GetChargesForAdditionalServices
        ?BundleId=IN&AdditionalServiceType=3                     (session)
→ { "totalAmount": 130.0,
    "pricingDetails": [ { "service": "LOCK", "amount": 100.0 },
                        { "service": "KEY", "amount": 0.0 },
                        { "service": "KEY-DELIVERY", "amount": 30.0 } ] }
```
Service types: `1` agent · `2` address change · `3` lock/key/courier ·
`4` MyHome installation · `5` agent · `6` public PO Box charge.
**None of them returns the registration fee** — hence the note in A1.

### D4 · Record it

```
POST /api/Guest/Renewal/Save                                     (key)
```
Renewals take payment on our checkout and use this to record the result, because
there is no confirm endpoint enabled for them.

---

# Flow E — Manage an existing box

| Customer asks | Call |
|---|---|
| "What boxes do I have?" | `GET /users/api/PoBoxes` **(session)** |
| "What companies are under my name?" | `GET /users/api/PoBoxes` + `GET /api/MOE/GetEntitiesById` — corporate boxes name their company in `ownerName`, and the registry list is separate |
| "Turn auto-renew on/off" | `GET /api/Renewal/Details` → `POST /api/UpdateAutoRenewConfig` |
| "Why was my box rejected?" | `GET /api/Rental/GetRejectedBoxDetails` **(session)** |
| "Can I still cancel?" | `GET /api/Renewal/ValidateCancel` **(session)** |
| "Who are the agents on my box?" | `GET /api/Renewal/GetAgents` **(session)** |

---

# Error codes we handle by name

| Code | Meaning | What it actually was, each time we saw it |
|---|---|---|
| `108 BOX_NOT_FREE` | Box unavailable | We sent `boxId` where `uniqueBoxId` was wanted. The box was free. |
| `157 ERROR_GETTING_HOLD_DETAILS` | Hold not found | A partial `billingDetail`. Nothing to do with the hold. |
| `173 MYHOME_ADDDRESSNOT_FOUND` | Address not found | `regionName` carried an area name instead of its code. |
| `223 INVALID_ADDITIONAL_SERVICE` | Extra not valid | A `serviceType` absent from `priceDetails` for that bundle. |
| `400 "Invalid date value."` | Bad date | `poBoxExpiryDate` recomputed instead of copied from `ExpiryDates`. |

---

# Open questions

1. An endpoint for the **registration fee** before the box is held, so the bundle
   card can show the real starting price.
2. A **free-box count** on `BoxLocations`, so we stop calling `FreeBoxes` once
   per branch.
3. A way to **release a hold** — an abandoned journey loses that box for good.
4. How long `isPaymentSuccess` can take to flip after payment.
5. Whether `Rental/Save` can populate the **delivery address** panel, or whether
   `ChangeAddress/Save` (a paid service) is the only way in.
6. Whether `MOE/GetEntitiesById` is really keyed to the Emirates ID in
   production — staging returns the same three stub companies for any input.
7. Whether a corporate rental with `IsCorporateInfoAutoPopulated: true` should
   send **no** attachments, as your portal does.
8. A shared identifier between the **geocoder's area names and the masters
   region list** — "Marsa Dubai" and "Dubai Marina" are the same place.
