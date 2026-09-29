# The company-name check blocks a renewal of the company itself

For Emirates Post Group Licensing's Salesforce team.
Environment: **PreProd2** (`epro--preprod2.sandbox.my.salesforce.com`)
Company: **TRAHEEL DELIVERY SERVICES L.L.C**, trade licence **1196781**
Account: **`001FW00B34EmqMWYEZ`**
Date: **29 September 2026**

> This file contains a real applicant's name, email, phone, Emirates ID and
> passport number, because the payloads are reproduced exactly as sent.
> Please keep it to the people reviewing it.

## The one-line version

We send the Account **addressed by its own `Id`**, carrying **its own existing
`Name`**. Your duplicate-name check finds that same record and refuses the
update. A record is not its own duplicate.

You confirmed the check "is being applied on update/create request". That is
fine on create. On **update** it has to exclude the record being updated —
`AND Id != :recordId`. A standard Salesforce duplicate rule already does this,
so this looks like a SOQL lookup in Apex or a flow.

## The controlled comparison

Two submissions, the same account, **43 minutes apart**, differing in one field.

| | Account item | Result |
|---|---|---|
| 2026-09-29T08:05:01.590Z | `Id`, **no** `Name` | **200 — succeeded.** Account updated, licence request `a11FW000fDxudF2YQI` (LR-37641) created |
| 2026-09-29T08:37:10.784Z | `Id` **+** `Name` | **400 — rolled back**, "A company with the same name already exists" |

The Account bodies, side by side. The only difference is the `Name` line:

**Blocked**
```json
{
  "Id": "001FW00B34EmqMWYEZ",
  "Name": "TRAHEEL DELIVERY SERVICES L.L.C",
  "RecordTypeId": "0125f000001xIheAAE",
  "EPG_Trade_license_no__c": "1196781",
  "EPG_Company_Name_Arabic__c": "تراحيل لخدمات التوصيل ش.ذ.م.م",
  "EPG_Trade_Name_in_Arabic__c": "تراحيل لخدمات التوصيل ش.ذ.م.م",
  "EPG_Trade_Name_in_English__c": "TRAHEEL DELIVERY SERVICES L.L.C",
  "EPG_Trade_license_Expiry_date__c": "2027-06-07"
}
```

**Succeeded**
```json
{
  "Id": "001FW00B34EmqMWYEZ",
  "RecordTypeId": "0125f000001xIheAAE",
  "EPG_Trade_license_no__c": "1196781",
  "EPG_Company_Name_Arabic__c": "تراحيل لخدمات التوصيل ش.ذ.م.م",
  "EPG_Trade_Name_in_Arabic__c": "تراحيل لخدمات التوصيل ش.ذ.م.م",
  "EPG_Trade_Name_in_English__c": "TRAHEEL DELIVERY SERVICES L.L.C",
  "EPG_Trade_license_Expiry_date__c": "2027-06-07"
}
```

Nothing else in PreProd2 carries that name — it is the company's own record,
matching itself.

## Why we cannot work around it

Omitting the `Name` gets past the check. We tried exactly that on 29 September,
and it is the two successful rows above. **The company was then renamed to the
applicant, "EMRE KARAYALCIN"** — something on your side fills an absent `Name`
rather than leaving the stored value alone. We reverted within the hour.

So there is currently **no valid payload for a renewal**: with the name we are
blocked, without it the company is renamed.

Two things we need:

1. **Exclude the record being updated from the duplicate-name check.**
2. **Please check Account `001FW00B34EmqMWYEZ`** and restore its `Name` to
   TRAHEEL DELIVERY SERVICES L.L.C if our 12:05/12:06 submissions overwrote it.
   And tell us what fills an omitted `Name` on an update.

If you would rather keep the check firing on update as it is, tell us what a
renewal should send instead — we will change our side to match.

## One more thing, unrelated to the above

Earlier the same afternoon, a different submission was rolled back by your flow
"Populating the primary contact information on account contact_2":

```
INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST: Designation: bad value for restricted
picklist field: Applicant
```

`Accountant` is accepted; `Applicant` is not. **Please send us the allowed
values for `EPG_Designation__c`.** We are otherwise guessing at a restricted
picklist, and a wrong guess rolls back the entire submission.

A third error you may see in your logs from today — "Value does not exist or
does not match filter criteria" — was **ours**: the Contact item was carrying
`EPG_Company__c`, which is correct on `EPG_Partner__c` and wrong there. Fixed on
29 September. Nothing needed from you.

---

# The blocked request, in full

`POST /services/apexrest/EPGL/LicenseRequest` — 2026-09-29T08:37:10.784Z

```json
{
  "allOrNone": true,
  "isAgentSource": true,
  "compositeRequest": [
    {
      "url": "/services/data/v66.0/sobjects/Account",
      "body": {
        "Id": "001FW00B34EmqMWYEZ",
        "Name": "TRAHEEL DELIVERY SERVICES L.L.C",
        "RecordTypeId": "0125f000001xIheAAE",
        "EPG_Trade_license_no__c": "1196781",
        "EPG_Company_Name_Arabic__c": "تراحيل لخدمات التوصيل ش.ذ.م.م",
        "EPG_Trade_Name_in_Arabic__c": "تراحيل لخدمات التوصيل ش.ذ.م.م",
        "EPG_Trade_Name_in_English__c": "TRAHEEL DELIVERY SERVICES L.L.C",
        "EPG_Trade_license_Expiry_date__c": "2027-06-07"
      },
      "method": "POST",
      "referenceId": "UpdatedAccount"
    },
    {
      "url": "/services/data/v66.0/sobjects/EPG_License_Request__c",
      "body": {
        "RecordTypeId": "0125f000001xIhwAAE",
        "serviceId__c": "S-EPG-000003",
        "EPG_Account__c": "001FW00B34EmqMWYEZ",
        "EPG_Service__c": "a1H5f0000033Q7lEAE",
        "ServiceNameAR__c": "تجديد رخصة النشاط البريدي",
        "ServiceNameEN__c": "Renew Postal Activity License",
        "Activity_Codes__c": "5320002,5320007,5320009",
        "EPG_Current_Region__c": "Al Khabaisi",
        "EPG_Current_Emirate__c": "Dubai",
        "EPG_Trade_license_no__c": "1196781",
        "Approved_Commitment_Form__c": true,
        "EPG_Terms_and_Conditions__c": true,
        "Mandatory_integration_with_IDEP__c": true,
        "EPG_Is_Financial_Statement_Submitted__c": true
      },
      "method": "POST",
      "referenceId": "NewLicenseRequest"
    },
    {
      "url": "/services/data/v66.0/sobjects/EPG_Partner__c",
      "body": {
        "Name": "Zain Elabdeen Isam Garieballa Elshareef",
        "EPG_Company__c": "001FW00B34EmqMWYEZ",
        "EPG_Emirates_ID__c": "784-1997-0827680-5",
        "EPG_Nationality__c": "Sudan",
        "EPG_Passport_No__c": "P11734322",
        "EPG_Residence_Type__c": "Resident",
        "EPG_License_Request__c": "@{NewLicenseRequest.id}",
        "EPG_Partner_Name_Arabic__c": "زين العابدين عصام الدين قريب الله الشريف"
      },
      "method": "POST",
      "referenceId": "Partner1"
    },
    {
      "url": "/services/data/v66.0/sobjects/EPG_Partner__c",
      "body": {
        "Name": "Isam Eldien Garieballa",
        "EPG_Company__c": "001FW00B34EmqMWYEZ",
        "EPG_Emirates_ID__c": "784-1961-1874270-7",
        "EPG_Nationality__c": "United States of America",
        "EPG_Passport_No__c": "A08466759",
        "EPG_Residence_Type__c": "Resident",
        "EPG_License_Request__c": "@{NewLicenseRequest.id}",
        "EPG_Partner_Name_Arabic__c": "عصام الدين غريب الله"
      },
      "method": "POST",
      "referenceId": "Partner2"
    },
    {
      "url": "/services/data/v66.0/sobjects/Members__c",
      "body": {
        "Name": "ZAIN ELABDEEN ISAM GARIEBALLA ELSHAREEF",
        "AccountId__c": "001FW00B34EmqMWYEZ",
        "EPG_License_Request__c": "@{NewLicenseRequest.id}",
        "DULLicenseMembersNationalityEn__c": "Sudan",
        "DUL_License_Members_MemberRoleEn__c": "Manager",
        "DUL_License_Members_Person_NameAr__c": "زين العابدين عصام الدين قريب الله الشريف",
        "DUL_License_Members_Person_NameEn__c": "ZAIN ELABDEEN ISAM GARIEBALLA ELSHAREEF"
      },
      "method": "POST",
      "referenceId": "Member1"
    },
    {
      "url": "/services/data/v66.0/sobjects/User",
      "body": {
        "Email": "emre.karayalcin@hotmail.com",
        "Phone": "971-55-5282857",
        "LastName": "KARAYALCIN",
        "FirstName": "EMRE",
        "EPG_Account__c": "001FW00B34EmqMWYEZ",
        "EPG_Emirates_Id__c": "784199983926421",
        "EPG_License_Request__c": "@{NewLicenseRequest.id}"
      },
      "method": "POST",
      "referenceId": "NewUser"
    },
    {
      "url": "/services/data/v66.0/sobjects/Contact",
      "body": {
        "Email": "emre.karayalcin@7x.ae",
        "Phone": "0553708434",
        "LastName": "KARAYALCIN",
        "AccountId": "001FW00B34EmqMWYEZ",
        "FirstName": "EMRE",
        "EPG_Designation__c": "Accountant",
        "EPG_License_Request__c": "@{NewLicenseRequest.id}",
        "Is_Secondary_Contact__c": "True"
      },
      "method": "POST",
      "referenceId": "NewContact"
    }
  ]
}
```

## Its response

HTTP 200. `allOrNone` echoes the same message onto every item, so the response
does not say which item collided — that is why this took a week to isolate.

```json
{
  "compositeResponse": [
    {
      "referenceId": "UpdatedAccount",
      "httpStatusCode": 400,
      "httpHeaders": {},
      "body": {
        "errors": [
          "Rolled back due to allOrNone=true: A company with the same name already exists. Please choose a different name and try again."
        ],
        "success": false,
        "id": null
      }
    },
    {
      "referenceId": "NewLicenseRequest",
      "httpStatusCode": 400,
      "httpHeaders": {},
      "body": {
        "errors": [
          "Rolled back due to allOrNone=true: A company with the same name already exists. Please choose a different name and try again."
        ],
        "success": false,
        "id": null
      }
    },
    {
      "referenceId": "Partner1",
      "httpStatusCode": 400,
      "httpHeaders": {},
      "body": {
        "errors": [
          "Rolled back due to allOrNone=true: A company with the same name already exists. Please choose a different name and try again."
        ],
        "success": false,
        "id": null
      }
    },
    {
      "referenceId": "Partner2",
      "httpStatusCode": 400,
      "httpHeaders": {},
      "body": {
        "errors": [
          "Rolled back due to allOrNone=true: A company with the same name already exists. Please choose a different name and try again."
        ],
        "success": false,
        "id": null
      }
    },
    {
      "referenceId": "Member1",
      "httpStatusCode": 400,
      "httpHeaders": {},
      "body": {
        "errors": [
          "Rolled back due to allOrNone=true: A company with the same name already exists. Please choose a different name and try again."
        ],
        "success": false,
        "id": null
      }
    },
    {
      "referenceId": "NewUser",
      "httpStatusCode": 400,
      "httpHeaders": {},
      "body": {
        "errors": [
          "Rolled back due to allOrNone=true: A company with the same name already exists. Please choose a different name and try again."
        ],
        "success": false,
        "id": null
      }
    },
    {
      "referenceId": "NewContact",
      "httpStatusCode": 400,
      "httpHeaders": {},
      "body": {
        "errors": [
          "Rolled back due to allOrNone=true: A company with the same name already exists. Please choose a different name and try again."
        ],
        "success": false,
        "id": null
      }
    }
  ]
}

SUBMISSION ROLLED BACK — NOTHING WAS CREATED. Read this before you reply.
THE SAME MESSAGE APPEARS ON EVERY ITEM. That is what allOrNone does: one failure unwinds the whole composite and every item echoes it. You therefore do NOT know which item failed, and you must NOT tell the customer which one did — not the Account, not the Contact, not any of them.
DO NOT INVENT A CAUSE. Say only what the message above actually says. If it does not name a field, neither do you.
DO NOT RESUBMIT WITH ITEMS REMOVED. Dropping the User or the Contact to "avoid a conflict" files an application missing the records EPGL need, and it is not a fix. Submit the same complete application or do not submit.
DO NOT tell the customer their application was rejected, that anything is wrong with what they gave you, or that they must re-enter or re-upload anything. Nothing they did caused this.
WHAT THIS ONE IS: EPGL's own duplicate-name check on the company. It is a known issue on their side — their check does not exclude the record being updated, so a renewal that sends the company's existing name is blocked by the company's own record. It is NOT something the customer can fix by changing anything, and it is NOT a reason to alter the company name. Tell them plainly that EPGL's system is blocking the submission on their company record, that their application is complete and nothing is lost, and that it needs EPGL to clear it. A callback is the right offer HERE, and only here.

```

---

# The request that succeeded, for comparison

`POST /services/apexrest/EPGL/LicenseRequest` — 2026-09-29T08:05:01.590Z

Identical but for the Account's `Name`.

```json
{
  "allOrNone": true,
  "isAgentSource": true,
  "compositeRequest": [
    {
      "url": "/services/data/v66.0/sobjects/Account",
      "body": {
        "Id": "001FW00B34EmqMWYEZ",
        "RecordTypeId": "0125f000001xIheAAE",
        "EPG_Trade_license_no__c": "1196781",
        "EPG_Company_Name_Arabic__c": "تراحيل لخدمات التوصيل ش.ذ.م.م",
        "EPG_Trade_Name_in_Arabic__c": "تراحيل لخدمات التوصيل ش.ذ.م.م",
        "EPG_Trade_Name_in_English__c": "TRAHEEL DELIVERY SERVICES L.L.C",
        "EPG_Trade_license_Expiry_date__c": "2027-06-07"
      },
      "method": "POST",
      "referenceId": "Account"
    },
    {
      "url": "/services/data/v66.0/sobjects/EPG_License_Request__c",
      "body": {
        "RecordTypeId": "0125f000001xIhwAAE",
        "serviceId__c": "S-EPG-000003",
        "EPG_Account__c": "001FW00B34EmqMWYEZ",
        "EPG_Service__c": "a1H5f0000033Q7lEAE",
        "ServiceNameAR__c": "تجديد رخصة النشاط البريدي",
        "ServiceNameEN__c": "Renew Postal Activity License",
        "Activity_Codes__c": "5320002,5320007,5320009",
        "EPG_Current_Region__c": "Al Khabaisi",
        "EPG_Current_Emirate__c": "Dubai",
        "EPG_Trade_License_No__c": "1196781",
        "EPG_Postal_License_No__c": "377",
        "Approved_Commitment_Form__c": true,
        "EPG_Terms_and_Conditions__c": true,
        "Mandatory_integration_with_IDEP__c": true,
        "EPG_Is_Financial_Statement_Submitted__c": true
      },
      "method": "POST",
      "referenceId": "NewLicenseRequest"
    },
    {
      "url": "/services/data/v66.0/sobjects/EPG_Partner__c",
      "body": {
        "EPG_Company__c": "001FW00B34EmqMWYEZ",
        "EPG_Emirates_ID__c": "784-1997-0827680-5",
        "EPG_Nationality__c": "Sudan",
        "EPG_Passport_No__c": "P11734322",
        "EPG_Partner_Name__c": "Zain Elabdeen Isam Garieballa Elshareef",
        "EPG_Residence_Type__c": "Resident",
        "EPG_License_Request__c": "@{NewLicenseRequest.id}",
        "EPG_Partner_Name_Arabic__c": "زين العابدين عصام الدين قريب الله الشريف"
      },
      "method": "POST",
      "referenceId": "Partner1"
    },
    {
      "url": "/services/data/v66.0/sobjects/EPG_Partner__c",
      "body": {
        "EPG_Company__c": "001FW00B34EmqMWYEZ",
        "EPG_Emirates_ID__c": "784-1961-1874270-7",
        "EPG_Nationality__c": "United States of America",
        "EPG_Passport_No__c": "A08466759",
        "EPG_Partner_Name__c": "Isam Eldien Garieballa",
        "EPG_Residence_Type__c": "Resident",
        "EPG_License_Request__c": "@{NewLicenseRequest.id}",
        "EPG_Partner_Name_Arabic__c": "عصام الدين غريب الله"
      },
      "method": "POST",
      "referenceId": "Partner2"
    },
    {
      "url": "/services/data/v66.0/sobjects/Members__c",
      "body": {
        "Name": "ZAIN ELABDEEN ISAM GARIEBALLA ELSHAREEF",
        "AccountId__c": "001FW00B34EmqMWYEZ",
        "EPG_License_Request__c": "@{NewLicenseRequest.id}",
        "DULLicenseMembersNationalityEn__c": "Sudan",
        "DUL_License_Members_MemberRoleEn__c": "Manager",
        "DUL_License_Members_Person_NameAr__c": "زين العابدين عصام الدين قريب الله الشريف",
        "DUL_License_Members_Person_NameEn__c": "ZAIN ELABDEEN ISAM GARIEBALLA ELSHAREEF"
      },
      "method": "POST",
      "referenceId": "Member1"
    },
    {
      "url": "/services/data/v66.0/sobjects/User",
      "body": {
        "Email": "emre.karayalcin@hotmail.com",
        "Phone": "+971555282857",
        "LastName": "KARAYALCIN",
        "FirstName": "EMRE",
        "EPG_Account__c": "001FW00B34EmqMWYEZ",
        "EPG_Emirates_Id__c": "784199983926421",
        "EPG_License_Request__c": "@{NewLicenseRequest.id}"
      },
      "method": "POST",
      "referenceId": "NewUser"
    },
    {
      "url": "/services/data/v66.0/sobjects/Contact",
      "body": {
        "Email": "emre.karayalcin@7x.ae",
        "Phone": "+971562236775",
        "LastName": "& Accounting",
        "AccountId": "001FW00B34EmqMWYEZ",
        "FirstName": "M B C Auditing",
        "EPG_Designation__c": "Accountant",
        "EPG_License_Request__c": "@{NewLicenseRequest.id}",
        "Is_Secondary_Contact__c": "True"
      },
      "method": "POST",
      "referenceId": "NewContact"
    }
  ]
}
```

## Its response

```json
{
  "compositeResponse": [
    {
      "referenceId": "Account",
      "httpStatusCode": 200,
      "httpHeaders": {
        "Location": "/services/data/v60.0/sobjects/Account/001FW00B34EmqMWYEZ"
      },
      "body": {
        "errors": [],
        "success": true,
        "id": "001FW00B34EmqMWYEZ"
      }
    },
    {
      "referenceId": "NewLicenseRequest",
      "httpStatusCode": 200,
      "httpHeaders": {
        "Location": "/services/data/v60.0/sobjects/EPG_License_Request__c/a11FW000fDxudF2YQI"
      },
      "body": {
        "errors": [],
        "success": true,
        "id": "a11FW000fDxudF2YQI"
      }
    },
    {
      "referenceId": "Partner1",
      "httpStatusCode": 200,
      "httpHeaders": {
        "Location": "/services/data/v60.0/sobjects/EPG_Partner__c/a16FW000FdjJDU8YIO"
      },
      "body": {
        "errors": [],
        "success": true,
        "id": "a16FW000FdjJDU8YIO"
      }
    },
    {
      "referenceId": "Partner2",
      "httpStatusCode": 200,
      "httpHeaders": {
        "Location": "/services/data/v60.0/sobjects/EPG_Partner__c/a16FW000FdjNPdAYIW"
      },
      "body": {
        "errors": [],
        "success": true,
        "id": "a16FW000FdjNPdAYIW"
      }
    },
    {
      "referenceId": "Member1",
      "httpStatusCode": 200,
      "httpHeaders": {
        "Location": "/services/data/v60.0/sobjects/Members__c/a3jFW0002aSQuUKYA1"
      },
      "body": {
        "errors": [],
        "success": true,
        "id": "a3jFW0002aSQuUKYA1"
      }
    },
    {
      "referenceId": "NewUser",
      "httpStatusCode": 200,
      "httpHeaders": {
        "Location": "/services/data/v60.0/sobjects/User/005FW003BeaXLTUYI4"
      },
      "body": {
        "errors": [],
        "success": true,
        "id": "005FW003BeaXLTUYI4"
      }
    },
    {
      "referenceId": "NewContact",
      "httpStatusCode": 200,
      "httpHeaders": {
        "Location": "/services/data/v60.0/sobjects/Contact/003FW00EjziA7hIYES"
      },
      "body": {
        "errors": [],
        "success": true,
        "id": "003FW00EjziA7hIYES"
      }
    }
  ]
}
```
