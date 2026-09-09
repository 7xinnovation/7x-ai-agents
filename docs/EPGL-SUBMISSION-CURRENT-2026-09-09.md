# EPGL submission — what we send now

**Updated:** 9 September 2026 · **Environment:** `epro--preprod2.sandbox`
**Supersedes:** `EPGL-SUBMISSION-TRACE-LR-37214.md` (3 September)

Every correction from your 8 September review is applied. This is the payload as
it leaves us today, taken from our audit log rather than written out by hand.

Each field below was checked against your org with a `describe` before this
document was written: 22 of 22 confirmed present and writeable, except where
noted.

---

## What changed since LR-37214

| Object | Was | Now |
|---|---|---|
| `EPG_Partner__c` | `EPG_Account__c` | `EPG_Company__c` |
| `EPG_Partner__c` | `EPG_Emirates_Id__c` | `EPG_Emirates_ID__c` (capital ID) |
| `Members__c` | `EPG_Account__c` | `AccountId__c` |
| `Members__c` | `EPG_Contact__c`, `EPG_Designation__c` | removed — they do not exist |
| `Members__c` | *(no name)* | `Name` always sent; an unnamed member is not sent at all |
| `EPG_License_Request__c` | `serviceId` | `serviceId__c` |
| `EPG_License_Request__c` | `serviceNameEN` | `ServiceNameEN__c` |
| `EPG_License_Request__c` | `EPG_Activity_Codes__c` | `Activity_Codes__c` |
| `EPG_License_Request__c` | `Terms_Conditions_Accepted__c` | `EPG_Terms_and_Conditions__c` |
| `EPG_License_Request__c` | `EPG_Emirates__c` | `EPG_Current_Emirate__c` |
| `EPG_License_Request__c` | `EPG_Region__c` | `EPG_Current_Region__c` |
| `Contact` | *(nothing)* | `Is_Primary_Contact__c: true` — see the blocker below |
| Activity codes | `"Coffee Shop, Restaurant"` | `"5320002,5320009"` |

These names are enforced in our code rather than left to the assistant, so they
cannot drift between submissions.

### Why the activity codes were wrong

Worth recording, because no rename would have fixed it. `"Coffee Shop,
Restaurant"` was the company's **DED trade-licence activities**, read off the
licence automatically. They were never postal activities. The assistant now asks
the applicant which of your three postal services they are applying for, and
sends nothing at all if the answer is not one of them.

---

## The composite we send

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
        "BillingCity": "Dubai",
        "RecordTypeId": "0125f000001xIheAAE",
        "BillingStreet": "Shop No. R.40.13 Roads and Transport Authority property (BurJuman Station) - Al Mankhool",
        "EPG_Region__c": "Al Mankhool",
        "BillingCountry": "UAE",
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
    {
      "method": "POST",
      "referenceId": "NewPartner2",
      "url": "/services/data/v66.0/sobjects/EPG_Partner__c",
      "body": {
        "Name": "Abdelaziz Mohamed Obaid",
        "EPG_Company__c": "@{NewAccount.id}",
        "EPG_Emirates_ID__c": "784-1986-7635438-8",
        "EPG_Nationality__c": "United Arab Emirates",
        "EPG_Passport_No__c": "HK6357227"
      }
    },
    {
      "method": "POST",
      "referenceId": "NewPartner3",
      "url": "/services/data/v66.0/sobjects/EPG_Partner__c",
      "body": {
        "Name": "Valentina Mintah",
        "EPG_Company__c": "@{NewAccount.id}",
        "EPG_Emirates_ID__c": "784-1973-4862505-0",
        "EPG_Nationality__c": "United Kingdom",
        "EPG_Passport_No__c": "720035369"
      }
    },
    {
      "method": "POST",
      "referenceId": "NewContact",
      "url": "/services/data/v66.0/sobjects/Contact",
      "body": {
        "Email": "emre.karayalcin@7x.ae",
        "Phone": "0553708434",
        "LastName": "Karayalcin",
        "AccountId": "@{NewAccount.id}",
        "FirstName": "Emre",
        "Is_Primary_Contact__c": true
      }
    },
    {
      "method": "POST",
      "referenceId": "NewDocument",
      "url": "/services/data/v66.0/sobjects/EPG_Document__c",
      "body": [
        {
          "docType__c": "pdf",
          "fileSize__c": 259502,
          "fileType__c": "pdf",
          "EPG_Company__c": "@{NewAccount.id}",
          "EPG_File_Id__c": "51bc47dd-cfe5-4055-ab22-ee416fdb4d50",
          "EPG_File_Name__c": "Trade License Main 697670 - 2025 - 2026.pdf"
        },
        {
          "…": "7 more rows, same shape"
        }
      ]
    },
    {
      "method": "POST",
      "referenceId": "NewLicenseRequest",
      "url": "/services/data/v66.0/sobjects/EPG_License_Request__c",
      "body": {
        "RecordTypeId": "0125f000001xIhuAAE",
        "serviceId__c": "S-EPG-000002",
        "EPG_Account__c": "@{NewAccount.id}",
        "EPG_Service__c": "a1H5f0000033Q7pEAE",
        "ServiceNameEN__c": "Issue Postal Activity License",
        "Activity_Codes__c": "5320002,5320009",
        "EPG_Current_Region__c": "Al Mankhool",
        "EPG_Payment_Method__c": "viban",
        "EPG_Request_Status__c": "Pending Payment",
        "EPG_Current_Emirate__c": "Dubai",
        "EPG_Terms_and_Conditions__c": true
      }
    }
  ]
}
```

---

## BLOCKER — we cannot satisfy the Contact validation

Every submission is rejected with:

```
Rolled back due to allOrNone=true: Either of Is Primary Contact or  Is Secondary Contact should be selected
```

**What we tried.** Your swagger documents `Secondary_Contact` on Contact, so we
sent it as `'True'`. No change. We described the object and sent the real field,
`Is_Primary_Contact__c: true` — visible in the payload above. Still rejected.

**What the describe returns, using our own integration credentials:**

| Field | Exists | createable | updateable |
|---|---|---|---|
| `Secondary_Contact` | **No** | — | — |
| `Is_Primary_Contact__c` | Yes | **false** | **false** |
| `Is_Secondary_Contact__c` | Yes | **false** | **false** |
| `EPG_Designation__c` | Yes | **false** | **false** |

Our integration user cannot write either field the rule reads, so no
API-created Contact can satisfy it.

**Most likely fixes, in order:**

1. **Field-level security.** `createable: false` is reported per profile, so this
   may simply be that our integration user's profile has no write access to those
   two fields. That would resolve it outright.
2. **Or exempt agent-sourced requests.** We already send `isAgentSource: true`;
   if the rule is meant for records created by hand in the UI, that is the
   natural exemption.
3. **Or have CompositeHandler set the designation** from a field we can send.

We will keep sending `Is_Primary_Contact__c: true` regardless — Salesforce
ignores a field the caller cannot write, so the payload is already correct the
moment access is granted, with no change needed at our end.

**The same problem is waiting on renewals.** `EPG_Designation__c` is equally
read-only to us, and your renewal notes require at least one Contact whose
designation contains "Accountant".

---

## Spec corrections

- `Secondary_Contact` is documented on Contact but does not exist on the object.
- `Is_Primary_Contact__c` and `Is_Secondary_Contact__c` are not documented, but a
  validation rule requires one of them.
- `serviceNameEN__c` — the org's field is `ServiceNameEN__c` with a capital S.
  Writes are case-insensitive so nothing was broken; we now send the org's own
  casing.

The validation message names field *labels* rather than API names, which is what
sent us to the wrong field twice.

---

## Answers and open questions

**`EPG_License_Request__c` matching key.** We propose `Name` — the licence
request number as returned by `duplicate-check` (`matchedRequestNumber`) or
`getRequestStatus`. It matches your swagger and needs no new identifier from
either side. Please confirm.

**`EPG_Payment_Reference__c` / `EPG_Contact__c`.** Do you already store
`notifyPayment.payment.paymentId`? If so we will drop the payment reference. We
would like the Contact lookup if it is cheap to add; otherwise we will manage
without it. Both are currently absent from the payload.

**Document download endpoint.** Before we build one: what would it give you that
the upload does not? `POST /EPGL/Document` already sends the file bytes inline as
base64 and all nine returned `201`. If you do need to re-fetch later we will
build it properly — it serves Emirates IDs and passports, so it needs
authentication, per-file authorisation and short-lived signed URLs rather than a
base path we hand over.

**Payment before approval.** You asked us to hold the payment notification until
the licence is approved. That conflicts with your own *Payment Process with
Agentic* map, where the customer submits and pays in one step and verification
follows. Which is authoritative? We have built to the map.

**Virtual IBAN.** Per Emre's description: we capture everything, submit the
request so it is locked, set `EPG_Request_Status__c` to indicate it is awaiting
payment, and tell the applicant their Virtual IBAN will be issued within one
working day. Please confirm the exact picklist value you want on that field —
only "Payment Verified" and "Under document review" have appeared in anything we
have seen, and an unaccepted value fails the whole composite under `allOrNone`.
