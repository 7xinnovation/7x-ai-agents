# New Licence Issuance — LR-37377

**A complete end-to-end run on PreProd, 15 September 2026, against contract 2.0.0.**
Every payload below is the one actually sent; every response is the one actually returned.

- Agent reference: **LR-37377** · record id `a11FW000aHtco7sYQA`
- Account: **YI FANG TAIWAN FRUIT TEA L.L.C** `001FW008rZxmmqyYQA` · trade licence 697670
- Submitted 13:36:11 UTC · Request Status **Under document review** · payment method Virtual IBAN
- Result: **composite 200 on all 7 items, 8 documents 201 Created, all files attached**

---

## 1. What changed on our side since the last payload we sent you

Everything here is a consequence of contract 2.0.0 and is live.

| | Before | Now |
|---|---|---|
| Documents in the composite | an `EPG_Document__c` item | **removed** — and actively stripped, not merely not-added |
| Document endpoint | `versionData` / `fileName` / `licenseRequestId` | `content` / `EPG_File_Name__c` / `EPG_License_Request__c` |
| `label__c` | not sent | **sent on every document** — see §4 |
| `EPG_File_Id__c` | our own row id | **not sent**, so Salesforce stores the ContentDocumentId |
| `docType__c` / `fileType__c` | both carried the file extension | the document TYPE / the file FORMAT |
| Payment notification currency | `currency` | `responseCurrency` |
| Account licence status | `EPG_License_Status__c` | `License_Status__c` |
| `EPG_License__c` on the request | never set | set **on renewals**; null on a new licence (see §6) |

---

## 2. Action steps — what we send, in order

1. **`POST /EPGL/LicenseRequest/duplicate-check`** — `contactEmail` + `tradeLicenseNumber`. If it matches, the customer is asked whether to update an existing application or file a new one; we never choose for them.
2. **`POST /EPGL/LicenseRequest`** — the composite. One call, `allOrNone: true`, `isAgentSource: true`. Account → partners → portal user → member → licence request.
3. **`POST /EPGL/Document`** — one call per file, after the composite, because each needs the licence request id. Eight calls here.
4. *(card payments only)* **`POST /paymentNotification/`** with `notifyPayment.salesforceId`. Not used on this run — Virtual IBAN, so the request is submitted and waits for Finance.
5. **`POST /EPGL/LicenseRequest/status`** — to report progress back to the customer.

---

## 3. The composite we sent

`POST /services/apexrest/EPGL/LicenseRequest`

```jsonc
{
  "allOrNone": true,
  "isAgentSource": true,
  "compositeRequest": [
    {
      "method": "POST", "referenceId": "NewAccount",
      "url": "/services/data/v66.0/sobjects/Account",
      "body": {
        "Name": "YI FANG TAIWAN FRUIT TEA L.L.C",
        "EPG_Company_Name_Arabic__c": "اي فانغ تايوان فروت للشاي ش.ذ.م.م",
        "EPG_Trade_Name_in_English__c": "YI FANG TAIWAN FRUIT TEA L.L.C",
        "EPG_Trade_Name_in_Arabic__c": "اي فانغ تايوان فروت للشاي ش.ذ.م.م",
        "EPG_Trade_license_no__c": "697670",
        "EPG_Trade_license_Expiry_date__c": "2026-11-04",
        "EPG_Regulator__c": "Dep. of Economic Development",
        "EPG_Emirates__c": "Dubai",
        "EPG_Region__c": "Al Mankhool",
        "EPG_PO_Box__c": "13422",
        "BillingStreet": "Shop No. R.40.13 Property of Roads and Transport Authority (BurJuman Station) - Al Mankhool",
        "BillingCity": "Dubai", "BillingCountry": "UAE",
        "RecordTypeId": "0125f000001xIheAAE"
      }
    },
    {
      "method": "POST", "referenceId": "NewPartner1",
      "url": "/services/data/v66.0/sobjects/EPG_Partner__c",
      "body": {
        "Name": "Faisal Eissa Lutfi Ali Hussain",
        "EPG_Partner_Name_Arabic__c": "فيصل عيسى لطفى على حسين",
        "EPG_Company__c": "@{NewAccount.id}",
        "EPG_Emirates_ID__c": "784-1984-0847950-3",
        "EPG_Passport_No__c": "L6J683896",
        "EPG_Nationality__c": "United Arab Emirates",
        "EPG_Residence_Type__c": "Citizen"
      }
    },
    // NewPartner2 — Abdelaziz Mohamed Obaid · 784-1986-7635438-8 · HK6357227 · Resident
    // NewPartner3 — Valentina Mintah · 784-1973-4862505-0 · 127690297 · United Kingdom · Resident
    {
      "method": "POST", "referenceId": "NewUser",
      "url": "/services/data/v66.0/sobjects/User",
      "body": {
        "FirstName": "Emre", "LastName": "Karayalcin",
        "Email": "emre.karayalcin@7x.ae", "Phone": "0553708434",
        "AccountId": "@{NewAccount.id}",
        "EPG_Emirates_Id__c": "784-1984-0847950-3"
      }
    },
    {
      "method": "POST", "referenceId": "NewMembers",
      "url": "/services/data/v66.0/sobjects/Members__c",
      "body": { "Name": "Emre Karayalcin", "AccountId__c": "@{NewAccount.id}" }
    },
    {
      "method": "POST", "referenceId": "NewLicenseRequest",
      "url": "/services/data/v66.0/sobjects/EPG_License_Request__c",
      "body": {
        "RecordTypeId": "0125f000001xIhuAAE",
        "EPG_Account__c": "@{NewAccount.id}",
        "EPG_Service__c": "a1H5f0000033Q7pEAE",
        "serviceId__c": "S-EPG-000002",
        "ServiceNameEN__c": "Issue Postal Activity License",
        "Activity_Codes__c": "5320002",
        "EPG_Current_Emirate__c": "Dubai",
        "EPG_Current_Region__c": "Al Mankhool",
        "EPG_Payment_Method__c": "viban",
        "EPG_Terms_and_Conditions__c": true
      }
    }
  ]
}
```

**No `EPG_Document__c` item.** Confirmed on the wire: 7 items, none of them a document.

**Response — every item 200, `success: true`:**

| referenceId | id |
|---|---|
| NewAccount | `001FW008rZxmmqyYQA` |
| NewPartner1 / 2 / 3 | `a16FW000BZuVWkCYYW` / `a16FW000BZuZitEYYS` / `a16FW000BZudv2GYYQ` |
| NewUser | `005FW002jJs1VQmYQM` |
| NewMembers | `a3jFW000293lrseYAA` |
| NewLicenseRequest | `a11FW000aHtco7sYQA` → **LR-37377** |

---

## 4. The eight document calls

`POST /services/apexrest/EPGL/Document`, one per file. Shape:

```jsonc
{
  "EPG_License_Request__c": "a11FW000aHtco7sYQA",
  "label__c": "TRADE LICENSE",
  "EPG_File_Name__c": "Trade License Main 697670 - 2025 - 2026.pdf",
  "docType__c": "TRADE LICENSE",
  "fileType__c": "pdf",
  "fileSize__c": 259502,
  "uploadBy__c": "Agent AI",
  "uploadOn__c": "2026-09-15T13:36:22.470Z",
  "content": "<base64>"
}
```

All eight returned **201 Created**, `createdNewDocument: true`, and each has its file attached (verified via `ContentDocumentLink` on the `EPG_Document__c` record).

| `label__c` sent | `checklistId` returned |
|---|---|
| `TRADE LICENSE` | `a0u5f000001qDT9AAM` ✅ |
| `Memorandum of Association` | `a0u5f000001qDTIAA2` ✅ |
| `PASSPORT — Faisal Eissa Lutfi Ali Hussain` | **null** |
| `Emirates ID — Faisal Eissa Lutfi Ali Hussain` | **null** |
| `PASSPORT — Abdelaziz Mohamed Obaid` | **null** |
| `Emirates ID — Abdelaziz Mohamed Obaid` | **null** |
| `PASSPORT — Valentina Mintah` | **null** |
| `Emirates ID — Valentina Mintah` | **null** |

### The one question we need answered

Your contract makes `label__c` both the **checklist key** and the **deduplication key**, and for documents we collect once per partner those two pull in opposite directions.

Your checklist has a single `PASSPORT` entry. We collect one passport per partner. If we send all three as `PASSPORT`, the second call updates the first document and the third updates the second — the application ends up holding **one** passport with no sign that two more were sent. So we append whose it is, which keeps all three, and the cost is the `checklistId: null` above.

**How would you like repeating documents named** so they both dedupe correctly and match a checklist entry? Options as we see them:

1. A checklist entry per partner (`PASSPORT 1`, `PASSPORT 2`, …) and we send those names.
2. `label__c` stays the checklist name and the dedup key becomes `label__c` + a discriminator we supply (a new field, or `EPG_File_Id__c`).
3. You are content with `checklistId: null` on per-partner documents, and the checklist is satisfied some other way.

We will match whichever you pick.

---

## 5. The rename detection you asked for

EPGL asked that the system "validate and identify any changes in the submitted document". Exercised deliberately on this run.

The customer uploaded the **2020 MOA**, which names the company **YIFANG CAFE MIDDLE EAST L.L.C**, against a trade licence reading **YI FANG TAIWAN FRUIT TEA L.L.C** — same trade licence number, 697670.

The agent said:

> One note on that: the MOA was issued under the name **YIFANG CAFE MIDDLE EAST L.L.C**, which differs from the current trade licence name **YI FANG TAIWAN FRUIT TEA L.L.C**. This looks like a company rename — do you have a more recent MOA issued under the current name?

- The document was **not** described as verified.
- Both names were put to the customer.
- The customer replaced it with the 2022 amendment, which was accepted.
- **The application kept the current name throughout.** The composite above carries `YI FANG TAIWAN FRUIT TEA L.L.C` — the superseded name never reached Salesforce.

A matching licence number alone no longer clears a document: it settles *which company*, not *which version*.

---

## 6. Two notes on the record itself

**`EPG_License__c` is null on the licence request, and we believe that is correct.** The field is createable and updateable for our user, and 3,010 of your requests carry it — but every one is a record type acting on an existing licence (Payment, Renewal, Change of Partner, Trade License Upload, Cancellation). All **695** `New License` requests in the org have it null, including the 88 that reached *Closed*. There is no licence record to point at until Licensing issue one. **On renewals we now set it**, since the licence exists and we already hold its id.

**An empty `EPG_Document__c` named "Lease Contract" was created against this request** at 13:36:12, one second after the composite and twelve seconds before our first document call. We did not send it — no lease contract was uploaded, and the composite carried no document items. We take it to be your handler creating a checklist placeholder (it shows `CreatedBy: AI Agent` because your Apex runs under our OAuth session). **Please confirm that is expected**, so we can tell an applicant whether a "Lease Contract" row on their application means a document is outstanding or nothing at all.

---

## 7. Reproducing this run

Trade licence **697670** (YI FANG TAIWAN FRUIT TEA L.L.C), three partners, Virtual IBAN. Documents: current trade licence, the 2020 MOA *(to trigger the rename check)*, the 2022 MOA amendment, and a passport + Emirates ID for each of the three partners.
