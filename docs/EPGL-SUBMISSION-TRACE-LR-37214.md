# EPGL new-licence submission — full request/response trace

**Licence request:** `a11FW000VfuZVYGYI4`
**Environment:** staging, `epro--preprod2.sandbox`
**Date:** 3 September 2026
**Company:** YI FANG TAIWAN FRUIT TEA L.L.C — trade licence 697670

Every call our assistant made to Salesforce for this one application, in order,
with the payload we sent and the response we received. Captured from our own
audit log, not reconstructed. Base64 file contents are elided; nothing else is
edited.

Please check this against `a11FW000VfuZVYGYI4` and tell us what did not land as expected.

---

## Call 1 — duplicate check ×3

`POST /services/apexrest/EPGL/LicenseRequest/duplicate-check`

**Request**
```json
{
  "companyNameAR": "اي فانغ تايوان فروت للشاي ش.ذ.م.م",
  "companyNameEN": "YI FANG TAIWAN FRUIT TEA L.L.C",
  "tradeLicenseNumber": "697670"
}
```

**Response**
```json
HTTP 200 OK
{"matchFound":true,"matchedRequests":[{"recommendedAction":"Update existing application","matchedRequestStatus":"Payment Verified","matchedRequestNumber":"LR-37214"},{"recommendedAction":"Update existing application","matchedRequestStatus":"Payment Verified","matchedRequestNumber":"LR-37213"},{"recommendedAction":"Update existing application","matchedRequestStatus":"Under document review","matchedRequestNumber":"LR-37212"},{"recommendedAction":"Update existing application","matchedRequestStatus":"Under document review","matchedRequestNumber":"LR-37210"},{"recommendedAction":"Update existing application","matchedRequestStatus":"Under document review","matchedRequestNumber":"LR-37209"},{"recommendedAction":"Update existing application","matchedRequestStatus":"Under document review","matchedRequestNumber":"LR-37205"},{"recommendedAction":"Update existing application","matchedRequestStatus":null,"matchedRequestNumber":"LR-37098"}],"matchedRecordIds":["001FW008rZxmmqyYQA"]}
```

Run 3 times as the customer worked through the duplicate list. Same
request each time; we did not update an existing request because the customer
chose to submit a new one.

---

## Call 2 — the submission

`POST /services/apexrest/EPGL/LicenseRequest`

One atomic composite, `allOrNone: true`. This is the whole payload:

**Request**
```json
{
  "allOrNone": true,
  "isAgentSource": true,
  "compositeRequest": [
    {
      "url": "/services/data/v66.0/sobjects/Account",
      "body": {
        "Name": "YI FANG TAIWAN FRUIT TEA L.L.C",
        "BillingCity": "Dubai",
        "RecordTypeId": "0125f000001xIheAAE",
        "BillingStreet": "Shop No. R.40.13, Roads and Transport Authority Property (BurJuman Station) - Al Mankhool",
        "EPG_Emirates__c": "Dubai",
        "EPG_Regulator__c": "Department of Economic Development",
        "BillingPostalCode": "13422",
        "EPG_Trade_license_no__c": "697670",
        "EPG_Company_Name_Arabic__c": "اي فانغ تايوان فروت للشاي ش.ذ.م.م",
        "EPG_Trade_Name_in_Arabic__c": "اي فانغ تايوان فروت للشاي ش.ذ.م.م",
        "EPG_Trade_Name_in_English__c": "YI FANG TAIWAN FRUIT TEA L.L.C",
        "EPG_Trade_license_Expiry_date__c": "2026-11-04"
      },
      "method": "POST",
      "referenceId": "NewAccount"
    },
    {
      "url": "/services/data/v66.0/sobjects/EPG_Partner__c",
      "body": {
        "Name": "Faisal Eissa Lutfi Ali Hussain",
        "EPG_Account__c": "@{NewAccount.id}",
        "EPG_Emirates_ID__c": "784-1984-0847950-3",
        "EPG_Nationality__c": "United Arab Emirates",
        "EPG_Passport_No__c": "Z8G229333"
      },
      "method": "POST",
      "referenceId": "NewPartner1"
    },
    {
      "url": "/services/data/v66.0/sobjects/EPG_Partner__c",
      "body": {
        "Name": "Abdelaziz Mohamed Obaid",
        "EPG_Account__c": "@{NewAccount.id}",
        "EPG_Emirates_ID__c": "784198676354388",
        "EPG_Nationality__c": "United Arab Emirates",
        "EPG_Passport_No__c": "HK6357227"
      },
      "method": "POST",
      "referenceId": "NewPartner2"
    },
    {
      "url": "/services/data/v66.0/sobjects/EPG_Partner__c",
      "body": {
        "Name": "Valentina Mintah",
        "EPG_Account__c": "@{NewAccount.id}",
        "EPG_Emirates_ID__c": "784-1973-4862505-0",
        "EPG_Nationality__c": "United Kingdom",
        "EPG_Passport_No__c": "720035369"
      },
      "method": "POST",
      "referenceId": "NewPartner3"
    },
    {
      "url": "/services/data/v66.0/sobjects/Contact",
      "body": {
        "Email": "emre.karayalcin@7x.ae",
        "Phone": "0553708434",
        "LastName": "Karayalcin",
        "AccountId": "@{NewAccount.id}",
        "FirstName": "Emre"
      },
      "method": "POST",
      "referenceId": "NewContact"
    },
    {
      "url": "/services/data/v66.0/sobjects/User",
      "body": {
        "Email": "emre.karayalcin@7x.ae",
        "LastName": "Karayalcin",
        "FirstName": "Emre",
        "EPG_Emirates_Id__c": "784-1984-0847950-3"
      },
      "method": "POST",
      "referenceId": "NewUser"
    },
    {
      "url": "/services/data/v66.0/sobjects/Members__c",
      "body": {
        "EPG_Account__c": "@{NewAccount.id}",
        "EPG_Contact__c": "@{NewContact.id}"
      },
      "method": "POST",
      "referenceId": "NewMember"
    },
    {
      "url": "/services/data/v66.0/sobjects/EPG_Document__c",
      "body": [
        {
          "docType__c": "pdf",
          "fileSize__c": 259502,
          "fileType__c": "pdf",
          "EPG_Company__c": "@{NewAccount.id}",
          "EPG_File_Id__c": "4fc318e9-20fb-4acd-af47-395cbf262aee",
          "EPG_File_Name__c": "Trade License Main 697670 - 2025 - 2026.pdf"
        },
        {
          "docType__c": "pdf",
          "fileSize__c": 291962,
          "fileType__c": "pdf",
          "EPG_Company__c": "@{NewAccount.id}",
          "EPG_File_Id__c": "d11da0af-5a4b-4219-a9f2-9c0b11d6970c",
          "EPG_File_Name__c": "Yi Fang MOA 2020 (old).pdf"
        },
        {
          "docType__c": "pdf",
          "fileSize__c": 2037477,
          "fileType__c": "pdf",
          "EPG_Company__c": "@{NewAccount.id}",
          "EPG_File_Id__c": "b32b70b1-81da-4236-b072-ee6762c9f205",
          "EPG_File_Name__c": "EID - Faisal Eissa Lutfi Ali Hussain.pdf"
        },
        {
          "docType__c": "pdf",
          "fileSize__c": 173002,
          "fileType__c": "pdf",
          "EPG_Company__c": "@{NewAccount.id}",
          "EPG_File_Id__c": "ea2ed859-f6be-4adc-abab-90aa0c0aafc0",
          "EPG_File_Name__c": "Passport - Faisal - Details Page.pdf"
        },
        {
          "docType__c": "pdf",
          "fileSize__c": 2037477,
          "fileType__c": "pdf",
          "EPG_Company__c": "@{NewAccount.id}",
          "EPG_File_Id__c": "8262e878-de0a-40c5-86ed-cf5644ed3b2c",
          "EPG_File_Name__c": "EID - Faisal Eissa Lutfi Ali Hussain.pdf"
        },
        {
          "docType__c": "pdf",
          "fileSize__c": 1606796,
          "fileType__c": "pdf",
          "EPG_Company__c": "@{NewAccount.id}",
          "EPG_File_Id__c": "51b7d8fb-89e2-4104-b7a2-f1c87e41ef86",
          "EPG_File_Name__c": "Passport Mohamed Alnuaimi .pdf"
        },
        {
          "docType__c": "pdf",
          "fileSize__c": 503233,
          "fileType__c": "pdf",
          "EPG_Company__c": "@{NewAccount.id}",
          "EPG_File_Id__c": "60f2024e-9306-4ff4-9ca5-349034f83256",
          "EPG_File_Name__c": "EID - Mohammad Al Nuaimi.pdf"
        },
        {
          "docType__c": "pdf",
          "fileSize__c": 824008,
          "fileType__c": "pdf",
          "EPG_Company__c": "@{NewAccount.id}",
          "EPG_File_Id__c": "95c0c658-8a94-4d1c-b0ea-94aed64d0251",
          "EPG_File_Name__c": "Passport - Valentina Mintah.pdf"
        },
        {
          "docType__c": "pdf",
          "fileSize__c": 286809,
          "fileType__c": "pdf",
          "EPG_Company__c": "@{NewAccount.id}",
          "EPG_File_Id__c": "86c3097f-4741-4b9f-857f-170bd638b6d2",
          "EPG_File_Name__c": "EID - Valentina Mintah.pdf"
        }
      ],
      "method": "POST",
      "referenceId": "NewDocument"
    },
    {
      "url": "/services/data/v66.0/sobjects/EPG_License_Request__c",
      "body": {
        "serviceId": "S-EPG-000002",
        "RecordTypeId": "0125f000001xIhuAAE",
        "EPG_Region__c": "Al Mankhool",
        "serviceNameEN": "Issue Postal Activity License",
        "EPG_Account__c": "@{NewAccount.id}",
        "EPG_Contact__c": "@{NewContact.id}",
        "EPG_Service__c": "a1H5f0000033Q7pEAE",
        "EPG_Emirates__c": "Dubai",
        "EPG_Amount_Paid__c": 1010,
        "EPG_Activity_Codes__c": "Coffee Shop, Restaurant",
        "EPG_Payment_Reference__c": "d12ddb6c-0da4-440a-a0d5-f9b637e94c29",
        "Terms_Conditions_Accepted__c": true
      },
      "method": "POST",
      "referenceId": "NewLicenseRequest"
    }
  ]
}
```

**Response**
```json
HTTP 200 OK
{"compositeResponse":[{"referenceId":"NewAccount","httpStatusCode":200,"httpHeaders":{"Location":"/services/data/v60.0/sobjects/Account/001FW008rZxmmqyYQA"},"body":{"success":true,"id":"001FW008rZxmmqyYQA","errors":[]}},{"referenceId":"NewPartner1","httpStatusCode":200,"httpHeaders":{"Location":"/services/data/v60.0/sobjects/EPG_Partner__c/a16FW000BWCTfZYYY1"},"body":{"success":true,"id":"a16FW000BWCTfZYYY1","errors":[]}},{"referenceId":"NewPartner2","httpStatusCode":200,"httpHeaders":{"Location":"/services/data/v60.0/sobjects/EPG_Partner__c/a16FW000BWCXriaYYD"},"body":{"success":true,"id":"a16FW000BWCXriaYYD","errors":[]}},{"referenceId":"NewPartner3","httpStatusCode":200,"httpHeaders":{"Location":"/services/data/v60.0/sobjects/EPG_Partner__c/a16FW000BWCc3rcYYB"},"body":{"success":true,"id":"a16FW000BWCc3rcYYB","errors":[]}},{"referenceId":"NewContact","httpStatusCode":200,"httpHeaders":{"Location":"/services/data/v60.0/sobjects/Contact/003FW00CW7iw9pQYMQ"},"body":{"success":true,"id":"003FW00CW7iw9pQYMQ","errors":[]}},{"referenceId":"NewUser","httpStatusCode":200,"httpHeaders":{"Location":"/services/data/v60.0/sobjects/User/005FW002iJkjKz2YQE"},"body":{"success":true,"id":"005FW002iJkjKz2YQE","errors":[]}},{"referenceId":"NewMember","httpStatusCode":200,"httpHeaders":{"Location":"/services/data/v60.0/sobjects/Members__c/a3jFW00020Db5rMYAR"},"body":{"success":true,"id":"a3jFW00020Db5rMYAR","errors":[]}},{"referenceId":"NewLicenseRequest","httpStatusCode":200,"httpHeaders":{"Location":"/services/data/v60.0/sobjects/EPG_License_Request__c/a11FW000VfuZVYGYI4"},"body":{"success":true,"id":"a11FW000VfuZVYGYI4","errors":[]}}]}
```

---

## Call 3 — payment notification

`POST /services/apexrest/paymentNotification/`

Sent once the gateway confirmed the money had settled — AED 1,010 on
N-Genius.

**Request**
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
        {
          "transactionId": "d12ddb6c-0da4-440a-a0d5-f9b637e94c29",
          "amount": 1010,
          "currency": { "en": "AED", "ar": "درهم" }
        }
      ]
    }
  }
}
```

**Response** — accepted. Request Status on `a11FW000VfuZVYGYI4` moved to **Payment Verified**.

---

## Call 4 — document uploads ×9

`POST /services/apexrest/EPGL/Document`

One call per file, each linked to the licence request. Example:

**Request**
```json
{
  "fileName": "Trade License Main 697670 - 2025 - 2026.pdf",
  "fileType": "pdf",
  "versionData": "<base64 omitted>",
  "licenseRequestId": "a11FW000VfuZVYGYI4"
}
```

**Response**
```json
HTTP 201 Created
{"success":true,"linkedTo":"a11FW000VfuZVYGYI4","contentVersionId":"068FW003ifE4dF6YAJ","contentDocumentId":"069FW003iY1Q9WmYQK"}
```

All 9 returned `201 Created` and reported `success: true`:

- `Trade License Main 697670 - 2025 - 2026.pdf` → `068FW003ifE4dF6YAJ`
- `Yi Fang MOA 2020 (old).pdf` → `068FW003ietq3gSYAQ`
- `EID - Faisal Eissa Lutfi Ali Hussain.pdf` → `068FW003ifKqDoKYAV`
- `Passport - Faisal - Details Page.pdf` → `068FW003ifRboNYYAZ`
- `EID - Faisal Eissa Lutfi Ali Hussain.pdf` → `068FW003ifYNOwmYAH`
- `Passport Mohamed Alnuaimi .pdf` → `068FW003iff8zW0YAI`
- `EID - Mohammad Al Nuaimi.pdf` → `068FW003iflua5EYAQ`
- `Passport - Valentina Mintah.pdf` → `068FW003ifRg0WaYAJ`
- `EID - Valentina Mintah.pdf` → `068FW003ie8SvhsYAC`

---

## What we would like checked on `a11FW000VfuZVYGYI4`

1. **Payment Info.** `EPG_Amount_Paid__c: 1010` was accepted on the licence
   request, and the notification carrying the same 1,010 was accepted and moved
   Request Status to Payment Verified. The record still shows
   **License Amount `AED 0.00`**, **Amount (Paid) `AED 0.00`** and a blank
   **Payment Status**. Which fields drive those three?

2. **Terms and Conditions.** `Terms_Conditions_Accepted__c: true` was accepted;
   the checkbox on the record shows unticked. Is that the right field?

3. **`NewDocument` is missing from the response.** The composite carries nine
   items and `compositeResponse` returns eight — every `referenceId` except
   `NewDocument` comes back with an id. No id, no `success`, no error. The files
   themselves attach fine (Call 4, all 201) but the Documents panel on the
   request shows only a system-generated "Lease Contract".

4. **`docType__c`.** We currently send the file extension (`"pdf"`), the same
   value as `fileType__c`. Nothing on the record distinguishes partner 3's
   passport from partner 2's Emirates ID except the file name. Should
   `docType__c` carry a semantic type, and which values does it accept?

5. **Partners.** Three `EPG_Partner__c` records were created against the
   Account, each with name, Emirates ID, passport number and nationality. They
   are not visible on the licence request page — is that expected, or should
   they appear as a related list there?
