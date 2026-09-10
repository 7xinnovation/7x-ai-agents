# EPGL — what we send today, and why Amount (Paid) is 0.00

**10 September 2026** · Environment: `epro--preprod2.sandbox`
**Worked example:** LR-37325 (`a11FW000X84agqmYIA`), YI FANG TAIWAN FRUIT TEA L.L.C, trade licence 697670
**Supersedes:** `EPGL-SUBMISSION-CURRENT-2026-09-09.md`

Everything below is copied from our audit log, not written out by hand. Your
9 September corrections are all applied and **the submission now succeeds** —
every item returns `success: true`.

One thing is still wrong on the record, and we believe it is a sequencing
question rather than a payload one. That is section 3.

---

## 1. The submission

`POST /services/apexrest/EPGL/LicenseRequest`

```json
{
  "allOrNone": true,
  "isAgentSource": true,
  "compositeRequest": [
    {
      "method": "POST",
      "referenceId": "NewAccount",
      "url": "/services/data/v66.0/sobjects/Account",
      "body": {
        "Name": "YI FANG TAIWAN FRUIT TEA L.L.C",
        "RecordTypeId": "0125f000001xIheAAE",
        "BillingStreet": "محل رقم R.40.13 ملك هيئة الطرق و المواصلات (محطة برجمان) - المنخول",
        "BillingPostalCode": "13422",
        "EPG_Region__c": "Al Mankhool",
        "EPG_Emirates__c": "Dubai",
        "EPG_Regulator__c": "Dep. of Economic Development",
        "EPG_Trade_license_no__c": "697670",
        "EPG_Company_Name_Arabic__c": "اي فانغ تايوان فروت للشاي ش.ذ.م.م",
        "EPG_Trade_license_Expiry_date__c": "2026-11-04"
      }
    },
    {
      "method": "POST",
      "referenceId": "NewPartner1",
      "url": "/services/data/v66.0/sobjects/EPG_Partner__c",
      "body": {
        "Name": "Faisal Eissa Lutfi Ali Hussain",
        "EPG_Company__c": "@{NewAccount.id}",
        "EPG_Emirates_ID__c": "784-1984-0847950-3",
        "EPG_Nationality__c": "United Arab Emirates",
        "EPG_Passport_No__c": "Z8G229333"
      }
    },
    { "…": "NewPartner2 and NewPartner3, same shape" },
    {
      "method": "POST",
      "referenceId": "NewUser",
      "url": "/services/data/v66.0/sobjects/User",
      "body": {
        "FirstName": "Emre",
        "LastName": "Karayalcin",
        "Email": "emre.karayalcin@7x.ae",
        "Phone": "0553708434",
        "EPG_Emirates_Id__c": "784-1984-0847950-3"
      }
    },
    {
      "method": "POST",
      "referenceId": "NewMember",
      "url": "/services/data/v66.0/sobjects/Members__c",
      "body": { "Name": "Emre Karayalcin", "AccountId__c": "@{NewAccount.id}" }
    },
    {
      "method": "POST",
      "referenceId": "NewDocument",
      "url": "/services/data/v66.0/sobjects/EPG_Document__c",
      "body": [
        {
          "docType__c": "pdf",
          "fileType__c": "pdf",
          "fileSize__c": 259502,
          "EPG_Company__c": "@{NewAccount.id}",
          "EPG_File_Id__c": "23acfd05-53c4-42ef-a8aa-8abd9a0b6210",
          "EPG_File_Name__c": "Trade License Main 697670 - 2025 - 2026.pdf"
        },
        { "…": "7 more, one per uploaded file" }
      ]
    },
    {
      "method": "POST",
      "referenceId": "NewLicenseRequest",
      "url": "/services/data/v66.0/sobjects/EPG_License_Request__c",
      "body": {
        "RecordTypeId": "0125f000001xIhuAAE",
        "serviceId__c": "S-EPG-000002",
        "EPG_Service__c": "a1H5f0000033Q7pEAE",
        "EPG_Account__c": "@{NewAccount.id}",
        "ServiceNameEN__c": "Issue Postal Activity License",
        "Activity_Codes__c": "5320002",
        "EPG_Current_Emirate__c": "Dubai",
        "EPG_Current_Region__c": "Al Mankhool",
        "EPG_Terms_and_Conditions__c": true
      }
    }
  ]
}
```

**Response — every item succeeded.**

```
HTTP 200 OK
NewAccount           success=true  001FW008rZxmmqyYQA
NewPartner1          success=true  a16FW000BZuVWkCYYW
NewPartner2          success=true  a16FW000BZuZitEYYS
NewPartner3          success=true  a16FW000BZudv2GYYQ
NewUser              success=true  005FW002jJs1VQmYQM
NewMember            success=true  a3jFW000293lrseYAA
NewLicenseRequest    success=true  a11FW000X84agqmYIA   → LR-37325
```

All eight documents then upload through `POST /EPGL/Document`, each returning
`201` with `linkedTo` the licence request.

### The Contact fix, confirmed working

Your explanation was right and the mistake was ours. `NewContact` is for a
company's **secondary** contact; `NewUser` is the **applicant**. We had been
sending the applicant's own email as `NewContact`, so your handler matched the
Primary contact an earlier request had created for that same person and tried to
mark it Secondary as well.

We now send the applicant in `NewUser` only, and omit `NewContact` entirely
unless the customer names a genuinely different second person — whose email is
checked against the applicant's before the payload is built. We no longer send
`Is_Primary_Contact__c` or `Is_Secondary_Contact__c` at all: your handler owns
the designation, and both fields are read-only to our integration user anyway.

No submission has hit that validation rule since.

---

## 2. The payment notification

`POST /services/apexrest/paymentNotification/`

```json
{
  "entityId": "Emirates Post Group Licensing - AI Assistant",
  "notifyPayment": {
    "salesforceId": "a11FW000X84agqmYIA",
    "payment": {
      "paymentId": "4db6074f-9f42-44a7-b69e-46ba8a9d0b2d",
      "payOn": "2026-09-10T07:45:00.000Z",
      "payThru": "N-Genius",
      "paymentMethod": "CreditCard",
      "paymentStatus": "completed",
      "transactions": [
        {
          "transactionId": "4db6074f-9f42-44a7-b69e-46ba8a9d0b2d",
          "amount": 1000,
          "currency": { "en": "AED", "ar": "درهم" }
        }
      ]
    }
  }
}
```

**Response:** `HTTP 200`, `status: 200`, `desc.en: "Success"`, `correlationId: null`.

And it takes effect — `EPG_Request_Status__c` moves to **"Payment Verified"**.
So the call is reaching the right record and doing something.

> **Note on the amount for staging only.** AED 1,000, not 150,000. N-Genius's
> sandbox outlet refuses anything over AED 100,000 (`422 amountLimitExceeded`,
> measured), so staging runs at a payable figure. Production is set to 150,000.

---

## 3. Amount (Paid) stays AED 0.00 — we think this is the sequencing question

LR-37325 after a completed card payment and a successful notification:

| Field | Value |
|---|---|
| `EPG_Request_Status__c` | **Payment Verified** |
| `EPG_Total_Amount__c` | 0.00 |
| `EPG_Amount_Paid__c` | 0.00 |
| `Amount_Paid__c` | 0.00 |
| `EPG_Payment_Advice_Paid_Amount__c` | null |
| `EPG_Payment_Status__c` | null |
| `EPG_IsPaymentApproved__c` | **false** |
| `EPG_Due_Amount__c` | null |

And, queried directly:

```
SELECT Id FROM EPG_Transaction__c WHERE EPG_License_Request__c = 'a11FW000X84agqmYIA'
→ totalSize: 0
```

**There is no payment advice on the request.** Approval History is empty and
`EPG_IsPaymentApproved__c` is false.

Your own documentation describes exactly this:

> The payment advice and its Oracle AR invoice are created automatically by
> Salesforce **when the request reaches the payable stage** — the Agent never
> creates or updates them directly.

> Once the Payment Notification is sent to Salesforce, the Payment Advice is
> automatically marked as Paid, **after the request has been approved by the
> Business Team and its status is set to In Process**.

So our reading is: the notification arrives *before* anything exists for it to
attach to. No advice has been raised, so the summed transaction amount has
nowhere to post, and both amount fields stay at zero while the status moves
anyway.

**This is not a payload problem we can fix from our side** — the amount we send
is correct and your endpoint accepts it. It is a question of *when* the customer
pays.

### Which is it?

**(a) Payment should come after approval.** The applicant submits, EPGL review,
the request reaches the payable stage, Salesforce raises the advice with a
License Amount, and only then do we present a payment. In that case we will hold
the payment back and take it on a later interaction — tell us how the agent
should learn the request has become payable (a status value we can poll for on
`getRequestStatus` would be enough).

**(b) Payment at submission is correct** and the advice should be raised when an
agent-sourced request is submitted. In that case the fix is on your side, and
our notification is already arriving correctly.

We built (b) because your *Payment Process with Agentic* map shows the applicant
submitting and paying in one step. Your 14 August note said payment follows
approval. We asked which is authoritative on 9 September and are still waiting —
and the zeroes above are what the disagreement looks like on a real record.

---

## 4. Corrections to the spec

Small things, all verified against your PreProd org today.

**`getRequestStatus` — `id` is not optional.**

```
GET /services/apexrest/EPGL/LicenseRequest/status?id=a11FW000X84agqmYIA  → 200
GET /services/apexrest/EPGL/LicenseRequest/status                        → 404
```

The swagger has `required: false`. It should be `required: true`.

**`getRequestStatus` does not return the request number.**

```json
{
  "salesforceRecordId": "a11FW000X84agqmYIA",
  "requestStatus": "Payment Verified",
  "requestIdentifier": null,
  "licenseNumber": "0",
  "lastUpdated": "2026-09-10T07:45:00.000Z"
}
```

`requestIdentifier` comes back null on every request we have tried. Nothing you
expose returns "LR-37325" for a known record id — `duplicate-check` returns a
*list* of every application on the company, and taking the newest from it gave a
customer the wrong application's number. **Could `requestIdentifier` carry the
licence request Name?** Until then we resolve it ourselves with a SOQL query, so
that the customer sees LR-37325 rather than `a11FW000X84agqmYIA`.

**`paymentNotification` — the schema and the example disagree.**

| | Schema says | Example says | We send |
|---|---|---|---|
| the record key | `licenseRequestSalesforceId` (required) | `salesforceId` | `salesforceId` |
| the currency object | `currency` | `responseCurrency` | `currency` |

We are sending what works today, and your file header notes the Apex still binds
the legacy `applicationId`. **Please confirm the pair you want us to send once
the alignment deployment lands**, and we will switch on your word.

---

## 5. Still open from 9 September

1. **The Virtual IBAN status.** What should `EPG_Request_Status__c` read between
   submission and the transfer arriving? "Pending Payment" and
   "Virtual Iban Approved" both exist on the picklist. That branch has no
   payment to notify, so the status is the only signal the applicant has.
2. **`EPG_Designation__c` is read-only to our integration user**
   (`createable: false, updateable: false`). Your renewal rules require a Contact
   whose designation contains "Accountant". We cannot set it — please grant
   field-level access or have the handler set it.
3. **The matching key for `EPG_License_Request__c` on update.** We propose its
   `Name`. Please confirm.
4. **`EPG_Payment_Reference__c`.** Do you already store
   `notifyPayment.payment.paymentId`? If so we will stop sending it.
5. **The document download endpoint.** Before we build one — what would it give
   you that the upload does not? The files already arrive inline as base64 and
   all nine return 201.

---

## What is working, for completeness

- Submission succeeds end to end, both payment branches, on the account that
  failed on 9 September.
- All eight documents attach to the licence request.
- Activity codes go as numbers (`5320002`) rather than the company's DED trade
  activities.
- Field names all match your 8 September corrections.
- The payment notification reaches the record and moves the status.
- Customer Pulse is live for both New License (TZ) and License Renewal (Ta),
  using EPGL's own linking ids.
