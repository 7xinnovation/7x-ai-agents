# Payment Info is empty on the licence request — for the Salesforce team

**Ask:** which fields populate **License Amount**, **Amount (Paid)** and
**Payment Status** on `EPG_License_Request__c`? We are writing
`EPG_Amount_Paid__c` on the record *and* sending the payment notification, both
are accepted, and all three fields still read `AED 0.00` / blank.

Live example: **`a11FW000VfuZVYGYI4`**, staging (`epro--preprod2.sandbox`),
3 September 2026. AED 1,010 taken and settled on the gateway.

---

## 1. What we send on the licence request

`POST /services/apexrest/EPGL/LicenseRequest` — the `NewLicenseRequest` item of
the composite, verbatim:

```json
{
  "url": "/services/data/v66.0/sobjects/EPG_License_Request__c",
  "method": "POST",
  "referenceId": "NewLicenseRequest",
  "body": {
    "serviceId": "S-EPG-000002",
    "serviceNameEN": "Issue Postal Activity License",
    "RecordTypeId": "0125f000001xIhuAAE",
    "EPG_Service__c": "a1H5f0000033Q7pEAE",
    "EPG_Account__c": "@{NewAccount.id}",
    "EPG_Contact__c": "@{NewContact.id}",
    "EPG_Emirates__c": "Dubai",
    "EPG_Region__c": "Al Mankhool",
    "EPG_Activity_Codes__c": "Coffee Shop, Restaurant",
    "EPG_Amount_Paid__c": 1010,
    "EPG_Payment_Reference__c": "d12ddb6c-0da4-440a-a0d5-f9b637e94c29",
    "Terms_Conditions_Accepted__c": true
  }
}
```

**Accepted:**

```json
{ "referenceId": "NewLicenseRequest", "httpStatusCode": 200,
  "body": { "success": true, "id": "a11FW000VfuZVYGYI4", "errors": [] } }
```

Every other item in the composite was accepted the same way — Account, three
`EPG_Partner__c`, Contact, User, `Members__c`.

## 2. What we send once the money settles

`POST /services/apexrest/paymentNotification/`

```json
{
  "entityId": "Emirates Post Group Licensing - AI Assistant",
  "notifyPayment": {
    "salesforceId": "a11FW000VfuZVYGYI4",
    "payment": {
      "paymentId": "d12ddb6c-0da4-440a-a0d5-f9b637e94c29",
      "payOn": "2026-09-03T18:10:14.000Z",
      "payThru": "N-Genius",
      "paymentMethod": "CreditCard",
      "paymentStatus": "completed",
      "transactions": [
        { "transactionId": "d12ddb6c-0da4-440a-a0d5-f9b637e94c29",
          "amount": 1010,
          "currency": { "en": "AED", "ar": "درهم" } }
      ]
    }
  }
}
```

**Accepted**, and it visibly took effect: **Request Status moved to "Payment
Verified"** on this record and on `a11FW000VeH3f1sYIB` and
`a11FW000Vfnnuz2YIA` before it. So the notification is reaching the right
record and your automation is acting on it.

## 3. What the record shows

| Field | Shows |
|---|---|
| Request Status | **Payment Verified** ✅ |
| License Amount | `AED 0.00` |
| Amount (Paid) | `AED 0.00` |
| Payment Status | *(blank)* |

## 4. The question

The amount reaches you twice — as `EPG_Amount_Paid__c` on the record, and as the
transaction amount on the notification — and both are accepted. So either:

1. **`EPG_Amount_Paid__c` is not the field behind "Amount (Paid)".** If so,
   please tell us the correct API name and we will send it.
2. **Those fields are rollups from a Payment Advice / Payment Item** that your
   side creates from the notification. If so, is something in that chain not
   firing? Your original spec said we must create no Payment Advice, Invoice or
   Receipt, so we create none.
3. **"License Amount" is EPGL's own figure**, set by your pricing rather than by
   us. If so, is it expected to stay 0.00 on an agent-sourced request?

Also on the same record: **Terms and Conditions** shows unticked although
`Terms_Conditions_Accepted__c: true` was accepted. Same question — is that the
field behind that checkbox?

## 5. Separately, and still outstanding

The composite carries **nine** items. `compositeResponse` returns **eight**:

```
NewAccount ✅  NewPartner1 ✅  NewPartner2 ✅  NewPartner3 ✅
NewContact ✅  NewUser ✅  NewMember ✅  NewLicenseRequest ✅
NewDocument ❌  ← no entry at all: no id, no success, no error
```

`NewDocument` is a `POST` to `/sobjects/EPG_Document__c` with an array of nine
rows, one per uploaded file. The files themselves attach fine — each returns
`201 Created` from `/services/apexrest/EPGL/Document` — but the Documents panel
on the request stays empty, showing only a system-generated "Lease Contract".

And a smaller one: `docType__c` and `fileType__c` both currently carry the file
extension (`"pdf"`). Nothing on the record distinguishes partner 3's passport
from partner 2's Emirates ID except the file name. Should `docType__c` carry a
semantic document type, and if so which values does it accept?
