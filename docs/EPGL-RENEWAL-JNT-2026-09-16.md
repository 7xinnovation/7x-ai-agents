# EPGL renewal — JNT EXPRESS COURIER SERVICES L.L.C, 16 September 2026

Two submissions of the same renewal, nineteen minutes apart. The first was rolled
back by Salesforce; the second created the licence request. This note sets out
both payloads, what differed, and what we have changed so it cannot happen again.

**Company.** JNT EXPRESS COURIER SERVICES L.L.C · trade licence 983571 · postal
licence 377 · Account `0015f00000ic9okAAA` · licence record `a12NM000003PYU4YAO`.

Environment: EPGL PreProd (`epro--preprod2.sandbox.my.salesforce.com`),
`POST /services/apexrest/EPGL/LicenseRequest`, `allOrNone: true`,
`isAgentSource: true`.

---

## 1. What went wrong — and it was ours

**2026-09-16T11:28:56.388Z** — rolled back.

```
"errors": ["Rolled back due to allOrNone=true: invalid cross reference id | portal account owner must have a role"]
```

All six records in the composite carried the same message, which is what
`allOrNone: true` is for.

We read the second half of that sentence first and told the applicant EPGL had a
portal configuration problem. **That was wrong, and we are sorry for the
misdirection.** The operative half is the first: `invalid cross reference id`.

The Account item carried an id that does not exist — `0015f00000XwXwXAAV`.
JNT's account is **`0015f00000ic9okAAA`**, and your own company lookup had
returned it to us minutes earlier in the same conversation. The id was fabricated
by our composer, and the same wrong id was copied onto the child records
(`EPG_Company__c`, `AccountId__c`), so nothing in the composite could resolve.

### The failed payload (Account and Contact items)

```jsonc
{
  "url": "/services/data/v66.0/sobjects/Account",
  "body": {
    "Id": "0015f00000XwXwXAAV",
    "Name": "JNT EXPRESS COURIER SERVICES L.L.C",
    "RecordTypeId": "0125f000001xIheAAE",
    "EPG_Trade_license_no__c": "983571",
    "EPG_Company_Name_Arabic__c": "جيه ان تي اكسبريس لنقل الوثائق ش.ذ.م.م",
    "EPG_Trade_Name_in_Arabic__c": "جيه ان تي اكسبريس لنقل الوثائق ش.ذ.م.م",
    "EPG_Trade_Name_in_English__c": "JNT EXPRESS COURIER SERVICES L.L.C",
    "EPG_Trade_license_Expiry_date__c": "2024-09-18"
  },
  "method": "POST",
  "referenceId": "Account"
}
{
  "url": "/services/data/v66.0/sobjects/Contact",
  "body": {
    "Email": "emre.karayalcin@7x.ae",
    "Phone": "0553708434",
    "LastName": "karayalcin",
    "FirstName": "emre",
    "EPG_Designation__c": "Accountant",
    "Is_Secondary_Contact__c": "True"
  },
  "method": "POST",
  "referenceId": "NewContact"
}
```

Response:

```json
HTTP 200 OK
{"compositeResponse":[{"referenceId":"Account","httpStatusCode":400,"httpHeaders":{},"body":{"errors":["Rolled back due to allOrNone=true: invalid cross reference id | portal account owner must have a role"],"success":false,"id":null}},{"referenceId":"NewPartner1","httpStatusCode":400,"httpHeaders":{},"body":{"errors":["Rolled back due to allOrNone=true: invalid cross reference id | portal account owner must have a role"],"success":false,"id":null}},{"referenceId":"NewPartner2","httpStatusCode":400,"httpHeaders":{},"body":{"errors":["Rolled back due to allOrNone=true: invalid cross reference id | portal account owner must have a role"],"success":false,"id":null}},{"referenceId":"NewMember1","httpStatusCode":400,"httpHeaders":{},"body":{"errors":["Rolled back due to allOrNone=true: invalid cross reference id | portal account owner must have a role"],"success":false,"id":null}},{"referenceId":"NewUser","httpStatusCode":400,"httpHeaders":{},"body":{"errors":["Rolled back due to allOrNone=true: invalid cross reference id | portal account owner must have a role"],"success":false,"id":null}},{"referenceId":"NewContact","httpStatusCode":400,"httpHeaders":{},"body":{"errors":["Rolled back due to allOrNone=true: invalid cross reference id | portal account owner must have a role"],"success":false,"id":null}},{"referenceId":"NewLicenseRequest","httpStatusCode":400,"httpHeaders":{},"body":{"errors":["Rolled back due to allOrNone=true: invalid cross reference id | portal account owner must have a role"],"success":false,"id":null}}]}
```

---

## 2. What succeeded

**2026-09-16T11:47:17.915Z** — created `EPG_License_Request__c` **a11FW000aQd1zZwYQI**.

Same conversation, same documents, same declaration. The material difference is
that the Account item carried the **real** id, and no `Name`:

```jsonc
{
  "url": "/services/data/v66.0/sobjects/Account",
  "body": {
    "Id": "0015f00000ic9okAAA",
    "RecordTypeId": "0125f000001xIheAAE",
    "EPG_Trade_license_no__c": "983571",
    "EPG_Trade_Name_in_Arabic__c": "جيه ان تي اكسبريس لنقل الوثائق ش.ذ.م.م",
    "EPG_Trade_Name_in_English__c": "JNT EXPRESS COURIER SERVICES L.L.C",
    "EPG_Trade_license_Expiry_date__c": "2024-09-18"
  },
  "method": "POST",
  "referenceId": "UpdateAccount"
}
```

Composite shape, in order:

| referenceId | object | outcome |
|---|---|---|
| `UpdateAccount` | `Account` | created |
| `NewLicenseRequest` | `EPG_License_Request__c` | created |
| `NewUser` | `User` | created |
| `Partner1` | `EPG_Partner__c` | created |
| `Partner2` | `EPG_Partner__c` | created |
| `Member1` | `Members__c` | created |

Response:

```json
HTTP 200 OK
{"compositeResponse":[{"referenceId":"UpdateAccount","httpStatusCode":200,"httpHeaders":{"Location":"/services/data/v60.0/sobjects/Account/0015f00000ic9okAAA"},"body":{"errors":[],"success":true,"id":"0015f00000ic9okAAA"}},{"referenceId":"NewLicenseRequest","httpStatusCode":200,"httpHeaders":{"Location":"/services/data/v60.0/sobjects/EPG_License_Request__c/a11FW000aQd1zZwYQI"},"body":{"errors":[],"success":true,"id":"a11FW000aQd1zZwYQI"}},{"referenceId":"NewUser","httpStatusCode":200,"httpHeaders":{"Location":"/services/data/v60.0/sobjects/User/005FW003BoINT1MYIX"},"body":{"errors":[],"success":true,"id":"005FW003BoINT1MYIX"}},{"referenceId":"Partner1","httpStatusCode":200,"httpHeaders":{"Location":"/services/data/v60.0/sobjects/EPG_Partner__c/a16FW000Cwc9DdQYIU"},"body":{"errors":[],"success":true,"id":"a16FW000Cwc9DdQYIU"}},{"referenceId":"Partner2","httpStatusCode":200,"httpHeaders":{"Location":"/services/data/v60.0/sobjects/EPG_Partner__c/a165f0000045hr0AAA"},"body":{"errors":[],"success":true,"id":"a165f0000045hr0AAA"}},{"referenceId":"Member1","httpStatusCode":200,"httpHeaders":{"Location":"/services/data/v60.0/sobjects/Members__c/a3jFW0002FV3fOyYQJ"},"body":{"errors":[],"success":true,"id":"a3jFW0002FV3fOyYQJ"}}]}

LICENCE REQUEST NUMBER: LR-37425
That is the reference to give the customer — the id above is Salesforce's internal record key and means nothing to them. Do NOT say the reference is pending, awaiting assignment or not yet issued, and do NOT look it up with duplicate-check: that returns every application this company has, and the newest is not n
```

---

## 3. What we changed on our side, today

The composite is composed by the model, which is why the same journey produced
two different shapes nineteen minutes apart. Anything that is a **key** is no
longer left to it:

- **The Account id is stamped from your lookup.** Where your company lookup has
  returned an Account id, it now overwrites whatever the composite carries — on
  the Account item and on every child that references it. This is the one place
  we overwrite rather than fill: a record id is not a reading off a document.
- Already in place from earlier rounds, for the same reason: `Activity_Codes__c`
  as numeric codes, `EPG_License__c` as the licence record id rather than the
  printed number, partner names taken from the trade licence rather than from an
  Emirates ID, and documents sent through API 5 rather than in the composite.

## 4. Two questions for EPGL

1. **A corporate partner.** JNT's partner 1 is GLOBAL JET EXPRESS AE FZCO — a
   company, with no passport and no Emirates ID. Your checklist carries
   `Trade License-Partner` and `Memorandom Of Association-Partner`; are those
   what you want in place of the personal identity documents, and should the
   partner record carry anything marking it as corporate?
2. **License Members.** The licence also names ZHAO ZHAO as Manager under
   "License Members / الاطراف", with no share. We send these as `Members__c`
   rows alongside the partners. Please confirm that is the object and shape you
   want, and whether a member's identity documents should travel with the
   application.

## 5. Reproducing

Conversation ids in our audit log, if you need anything further pulled: failed
`1bc657e8-5e0d-4905-b2b0-bf1d59633160`, succeeded
`fa770d68-a5d8-4e1e-8fdc-57b526f21567`.
