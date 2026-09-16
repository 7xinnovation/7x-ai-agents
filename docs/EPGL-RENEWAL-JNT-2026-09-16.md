# EPGL renewal submission — JNT EXPRESS COURIER SERVICES L.L.C

For review: this is a complete, successful renewal submitted from the assistant
on **16 September 2026**, exactly as it went over the wire. Please confirm the
records landed the way EPGL expect them to — the fields, the record types, the
relationships and anything you would have wanted that is not here.

| | |
|---|---|
| Company | JNT EXPRESS COURIER SERVICES L.L.C |
| Trade licence | 983571 (expiry 18-09-2024) |
| Postal licence | 377 |
| Account | `0015f00000ic9okAAA` |
| Licence record | `a12NM000003PYU4YAO` |
| Submitted | 2026-09-16T11:47:17.915Z |
| Environment | `epro--preprod2.sandbox.my.salesforce.com` (PreProd) |
| Endpoint | `POST /services/apexrest/EPGL/LicenseRequest` |

---

## What was created

| referenceId | object | id | HTTP |
|---|---|---|---|
| `UpdateAccount` | `Account` | `0015f00000ic9okAAA` | 200 |
| `NewLicenseRequest` | `EPG_License_Request__c` | `a11FW000aQd1zZwYQI` | 200 |
| `NewUser` | `User` | `005FW003BoINT1MYIX` | 200 |
| `Partner1` | `EPG_Partner__c` | `a16FW000Cwc9DdQYIU` | 200 |
| `Partner2` | `EPG_Partner__c` | `a165f0000045hr0AAA` | 200 |
| `Member1` | `Members__c` | `a3jFW0002FV3fOyYQJ` | 200 |

The licence request is **`a11FW000aQd1zZwYQI`**.

---

## The request we sent

`allOrNone: true`, `isAgentSource: true`. Six items, in this order.

```json
{
  "allOrNone": true,
  "isAgentSource": true,
  "compositeRequest": [
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
    },
    {
      "url": "/services/data/v66.0/sobjects/EPG_License_Request__c",
      "body": {
        "RecordTypeId": "0125f000001xIhwAAE",
        "serviceId__c": "S-EPG-000003",
        "EPG_Account__c": "0015f00000ic9okAAA",
        "EPG_License__c": "a12NM000003PYU4YAO",
        "EPG_Service__c": "a1H5f0000033Q7lEAE",
        "ServiceNameAR__c": "تجديد رخصة النشاط البريدي",
        "ServiceNameEN__c": "Renew Postal Activity License",
        "Activity_Codes__c": "5320002,5320007,5320009",
        "EPG_Current_Emirate__c": "Dubai",
        "EPG_Trade_License_No__c": "983571",
        "EPG_Postal_License_No__c": "377",
        "Approved_Commitment_Form__c": true,
        "EPG_Terms_and_Conditions__c": true,
        "Terms_Conditions_Accepted_Date__c": "2026-09-16",
        "Mandatory_integration_with_IDEP__c": true,
        "EPG_Is_Financial_Statement_Submitted__c": false
      },
      "method": "POST",
      "referenceId": "NewLicenseRequest"
    },
    {
      "url": "/services/data/v66.0/sobjects/User",
      "body": {
        "Email": "nithyaepg@gmail.com",
        "Phone": "0581917992",
        "LastName": "SREEPADA MANJAPPA",
        "FirstName": "NITHYASHRI",
        "EPG_Account__c": "0015f00000ic9okAAA",
        "EPG_Emirates_Id__c": "784199017220577",
        "EPG_License_Request__c": "@{NewLicenseRequest.id}"
      },
      "method": "POST",
      "referenceId": "NewUser"
    },
    {
      "url": "/services/data/v66.0/sobjects/EPG_Partner__c",
      "body": {
        "Name": "GLOBAL JET EXPRESS AE FZCO",
        "EPG_Company__c": "0015f00000ic9okAAA",
        "EPG_Nationality__c": "United Arab Emirates",
        "EPG_Residence_Type__c": "Non Resident",
        "EPG_License_Request__c": "@{NewLicenseRequest.id}",
        "EPG_Partner_Name_Arabic__c": "جلوبال جيت إكسبريس ايه إي ش م ح"
      },
      "method": "POST",
      "referenceId": "Partner1"
    },
    {
      "url": "/services/data/v66.0/sobjects/EPG_Partner__c",
      "body": {
        "Name": "Khalifa Thani Ali Khalifa Bin Ghalita",
        "EPG_Company__c": "0015f00000ic9okAAA",
        "EPG_Emirates_ID__c": "784-1983-7376321-2",
        "EPG_Nationality__c": "United Arab Emirates",
        "EPG_Passport_No__c": "PPRZ02949",
        "EPG_Residence_Type__c": "Resident",
        "EPG_License_Request__c": "@{NewLicenseRequest.id}",
        "EPG_Partner_Name_Arabic__c": "خليفه ثاني على خليفه بن غليطه"
      },
      "method": "POST",
      "referenceId": "Partner2"
    },
    {
      "url": "/services/data/v66.0/sobjects/Members__c",
      "body": {
        "Name": "ZHAO ZHAO",
        "EPG_Role__c": "Manager",
        "AccountId__c": "0015f00000ic9okAAA",
        "EPG_Name_Arabic__c": "زهاو زهاو",
        "EPG_Nationality__c": "China",
        "EPG_License_Request__c": "@{NewLicenseRequest.id}"
      },
      "method": "POST",
      "referenceId": "Member1"
    }
  ]
}
```

### Notes on the payload

- **`UpdateAccount`** carries the Account id your company lookup returned. We do
  not create an Account on a renewal, and the id is stamped by us from that
  lookup rather than composed — a record id is not something we let the model
  write.
- **`Activity_Codes__c`** is sent as numeric MOEc codes, not as the free text
  printed on the trade licence.
- **`EPG_License__c`** on the licence request is the licence record id, not the
  printed postal licence number.
- **Partner names** are taken from the trade licence, not from the partner's
  Emirates ID, so a company does not accumulate two spellings of the same person.
- **`Members__c`** carries the "License Members / الاطراف" table — here ZHAO
  ZHAO, Manager — separately from the partners, who are the shareholders.
- **Documents are not in this payload.** They go separately through
  `POST /EPGL/Document` with `label__c` set to your checklist name, after the
  licence request id comes back.
- **`NewUser`** is the applicant as UAE PASS returned them at sign-in — name,
  Emirates ID and contact details come from the sign-in, not from anything typed
  into the chat.
- **`EPG_Is_Financial_Statement_Submitted__c: false`** records that this renewal
  went through without the AFS, under the six-month grace period your licensing
  team described on 16 September.

---

## The response

```json
{
  "compositeResponse": [
    {
      "referenceId": "UpdateAccount",
      "httpStatusCode": 200,
      "httpHeaders": {
        "Location": "/services/data/v60.0/sobjects/Account/0015f00000ic9okAAA"
      },
      "body": {
        "errors": [],
        "success": true,
        "id": "0015f00000ic9okAAA"
      }
    },
    {
      "referenceId": "NewLicenseRequest",
      "httpStatusCode": 200,
      "httpHeaders": {
        "Location": "/services/data/v60.0/sobjects/EPG_License_Request__c/a11FW000aQd1zZwYQI"
      },
      "body": {
        "errors": [],
        "success": true,
        "id": "a11FW000aQd1zZwYQI"
      }
    },
    {
      "referenceId": "NewUser",
      "httpStatusCode": 200,
      "httpHeaders": {
        "Location": "/services/data/v60.0/sobjects/User/005FW003BoINT1MYIX"
      },
      "body": {
        "errors": [],
        "success": true,
        "id": "005FW003BoINT1MYIX"
      }
    },
    {
      "referenceId": "Partner1",
      "httpStatusCode": 200,
      "httpHeaders": {
        "Location": "/services/data/v60.0/sobjects/EPG_Partner__c/a16FW000Cwc9DdQYIU"
      },
      "body": {
        "errors": [],
        "success": true,
        "id": "a16FW000Cwc9DdQYIU"
      }
    },
    {
      "referenceId": "Partner2",
      "httpStatusCode": 200,
      "httpHeaders": {
        "Location": "/services/data/v60.0/sobjects/EPG_Partner__c/a165f0000045hr0AAA"
      },
      "body": {
        "errors": [],
        "success": true,
        "id": "a165f0000045hr0AAA"
      }
    },
    {
      "referenceId": "Member1",
      "httpStatusCode": 200,
      "httpHeaders": {
        "Location": "/services/data/v60.0/sobjects/Members__c/a3jFW0002FV3fOyYQJ"
      },
      "body": {
        "errors": [],
        "success": true,
        "id": "a3jFW0002FV3fOyYQJ"
      }
    }
  ]
}
```

---

## What we would like confirmed

1. **The shape is right.** Six records, this order, these relationships — is
   anything missing that EPGL need on a renewal?
2. **`Members__c`.** Is that the object and field shape you want for a licence
   member, and should a member's identity documents travel with the application?
3. **A corporate partner.** Partner 1 here is GLOBAL JET EXPRESS AE FZCO, a
   company with no passport and no Emirates ID. Your checklist carries
   `Trade License-Partner` and `Memorandom Of Association-Partner` — are those
   what you want in their place, and should the partner record be marked as
   corporate?
4. **The renewal fee.** This submission carries the fee our configuration holds.
   Please confirm the figure EPGL expect on a renewal, and whether approved
   penalties should be collected with it.
5. **The AFS grace period.** Is `EPG_Is_Financial_Statement_Submitted__c: false`
   what tags the request as partially completed, or is there another field we
   should be setting for the six-month clock to start?
