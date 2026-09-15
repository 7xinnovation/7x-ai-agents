# EPGL — the renewal submission: what we send, and what has never arrived

**15 September 2026** · Environment: `epro--preprod2.sandbox`
**Worked example:** LR-37172 · FIRST FLIGHT COURIERS (MIDDLE EAST) (L.L.C) · trade licence 241481

The renewal composite **succeeds**. Five have landed from the agent, every one at
`Under document review` with the four mandatory flags true and an accountant
Contact on the account.

**But two things in it have never once reached your org**, and one of them is the
whole financial summary. Everything below is read off your records, not written
out by hand.

---

## 1. What we send

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
        "Id": "0015f00000ic9n1AAA",
        "Name": "FIRST FLIGHT COURIERS (MIDDLE EAST) (L.L.C)",
        "EPG_Trade_license_no__c": "241481",
        "EPG_Trade_license_Expiry_date__c": "2027-03-14",
        "RecordTypeId": "0125f000001xIheAAE"
      }
    },
    {
      "method": "POST",
      "referenceId": "NewContact",
      "url": "/services/data/v66.0/sobjects/Contact",
      "body": [
        {
          "AccountId": "@{NewAccount.id}",
          "FirstName": "Paisen",
          "LastName": "Devasia",
          "Email": "paisen@firstflightme.com",
          "Phone": "971501234567",
          "EPG_Designation__c": "Accountant",
          "EPG_Country_Code__c": "UAE(+971)"
        }
      ]
    },
    {
      "method": "POST",
      "referenceId": "NewLicenseRequest",
      "url": "/services/data/v66.0/sobjects/EPG_License_Request__c",
      "body": {
        "RecordTypeId": "0125f000001xIhwAAE",
        "EPG_Account__c": "@{NewAccount.id}",
        "EPG_Service__c": "a1H5f0000033Q7lEAE",
        "serviceId__c": "S-EPG-000003",
        "ServiceNameEN__c": "Renew Postal Activity License",
        "EPG_Terms_and_Conditions__c": true,
        "Approved_Commitment_Form__c": true,
        "Mandatory_integration_with_IDEP__c": true,
        "EPG_Is_Financial_Statement_Submitted__c": true
      }
    },
    {
      "method": "POST",
      "referenceId": "NewTrialBalance",
      "url": "/services/data/v66.0/sobjects/EPG_Finance_Summary__c",
      "body": [
        {
          "EPG_License_Request__c": "@{NewLicenseRequest.id}",
          "EPG_License_No__c": "a12NM000000A1yvYAC",
          "Quarter__c": "Q3", "EPG_Year__c": "2023", "Name": "Q3 2023",
          "EPG_Leviable_Income__c": 100000, "EPG_Non_Leviable_Income__c": 0
        },
        { "…": "Q4 2023, Q1 2024, Q2 2024 — the period walked forward" }
      ]
    }
  ]
}
```

Documents are **not** in the composite any more — they go through
`POST /EPGL/Document` per your 14 September change, with `content`,
`EPG_File_Name__c` and `EPG_License_Request__c`. Eight files attach per
application and every one returns 201.

---

## 2. What has never arrived — `EPG_Finance_Summary__c`

**Zero rows. Not on the five renewals. Not anywhere in the org. Ever.**

```
SELECT Id FROM EPG_Finance_Summary__c            → totalSize: 0
```

They were not rejected — `allOrNone: true` would have rolled the licence request
back with them, and the requests exist. **They were never sent.**

This is ours and it is fixed: the rows were being assembled by the model from a
written instruction, and are now built deterministically from the case, beside
the document metadata. One row per quarter, the real calendar quarter walked
forward from the licence period's start, `EPG_License_No__c` carrying the licence
RECORD id from `epgl_company_lookup`.

**We flag it because of what it means for the five that already landed:**
LR-37128, LR-37130, LR-37131, LR-37171 and LR-37172 are sitting at *Under
document review* with `EPG_Is_Financial_Statement_Submitted__c = true` and **no
quarterly figures behind them**. If your review reads the finance rows, those
five have nothing to read.

> **A question back to you:** should `EPG_Is_Financial_Statement_Submitted__c`
> be true when no `EPG_Finance_Summary__c` rows exist? If your trigger takes that
> flag as evidence the figures are in, it would be worth having it check.

---

## 3. What has never arrived — the service fields

On LR-37172, landed cleanly on 26 August:

| Field | Value on the record |
|---|---|
| `EPG_Service__c` | `a1H5f0000033Q7lEAE` ✅ |
| `serviceId__c` | **null** |
| `ServiceNameEN__c` | **null** |

Both are constants for the service, both are in your spec's renewal example, and
both arrive correctly on a NEW licence from the same instruction. Ours again, and
also fixed — they are now stated rather than left to be remembered.

---

## 4. What works, so you do not have to re-check it

Verified on the records themselves, not from our logs:

- **The Account matches** rather than inserting. `Id` alongside
  `EPG_Trade_license_no__c`, which your handler needs — without the `Id` it
  attempts an insert and fails on the unique field.
- **All four mandatory flags** true on every renewal:
  `EPG_Terms_and_Conditions__c`, `Approved_Commitment_Form__c`,
  `Mandatory_integration_with_IDEP__c`, `EPG_Is_Financial_Statement_Submitted__c`.
- **An accountant Contact** on the account —
  `EPG_Designation__c` containing `Accountant`, which you told us on
  11 September your handler can write and which our own `describe` had wrongly
  reported as read-only.
- **`EPG_Request_Status__c` auto-set** to `Under document review`. We set nothing;
  the progression is yours.
- **The documents attach** — eight per application, 201 each.

---

## 5. One change on our side you should know about

**The Form 9 upload is gone from the renewal.** Emirates Post asked for it on
15 September: Form 9 is a quarterly return filed on your platform, not a document
handed over in a chat. We no longer ask for the file. The **figures** still come
from Form 9 — through `epgl_form9_history`, the returns already filed against the
company — which is where they should have come from all along for a company you
already licence.

Nothing is gated on it yet. When you give us the list of companies with
outstanding returns, we will hold the renewal until they are filed; until then
the assistant says where Form 9 is completed and does not claim to know whether
anybody's are outstanding.

---

## 6. Still open from before

Unchanged, and both waiting on you:

1. **The payment order.** You answered that payment follows *Documents approved*.
   EPGL's own side has not confirmed whether the fee is offered at submission or
   after approval, and until it does we have not moved it. This is why
   `Amount (Paid)` reads 0.00 on a paid request.
2. **The updated Document swagger.** You shipped the new API 5 before sending it;
   we mapped the contract by probing. One request: the endpoint rejects
   `licenseRequestId` with *"Either licenseRequestId or accountId is required"* —
   an error naming the field it was given and no longer accepts. Please have it
   name `EPG_License_Request__c`.
