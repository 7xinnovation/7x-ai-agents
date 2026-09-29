# A second renewal request is refused — "one of the unique fields"

For Emirates Post Group Licensing's Salesforce team.
Environment: **PreProd2** (`epro--preprod2.sandbox.my.salesforce.com`)
When: **24 September 2026, 08:18:36 UTC**
Company: TRAHEEL DELIVERY SERVICES L.L.C, trade licence **1196781**

> This file contains a real applicant's name, email, phone, Emirates ID and
> passport number, because those values are what the constraint may be on.
> Please keep it to the people reviewing it.

## What happens

A customer who already has a licence request on file for this trade licence
cannot submit another. Your `duplicate-check` endpoint reports the existing ones
and recommends updating them, which is reasonable — but when the customer
chooses to submit a new one anyway, the composite is rolled back:

```
A record already exists with the same unique value for "one of the unique fields".
```

Every item reports the same message because `allOrNone: true` unwinds the whole
composite, so the response does not say WHICH field collided. That is the
question we need answered.

## ANSWERED by EPGL, 29 September 2026

Their replies, verbatim, against the three questions below:

| Question | Their answer |
|---|---|
| Which field is the unique constraint on? | "its the company name — there is duplicate rule on SF to prevent any company name duplication", and "`EPG_TRN_No__c` should be unique also" |
| Should a second open request for the same trade licence be possible? | "Yes it's possible, and the `recommendedAction` is just a recommendation, not a rule" |
| Can `User` / `Contact` be upserted on an external id? | Already are: "we are using email for contact to match and update; for user it's on `EPG_Emirates_Id__c`" |

**So our reading was wrong.** We had `NewUser` down as the likeliest culprit —
a `Username` is unique org-wide and this applicant had submitted before. It is
not: their handler matches the User on `EPG_Emirates_Id__c` and the Contact on
`Email`, so a returning applicant updates rather than collides. The Account was
the one item we ruled out, on the grounds that it carries an `Id` and is
therefore an update.

### What we changed, 29 September

**We tried dropping `Name` from the Account when we hold its `Id`, and reverted
it the same day.** The reasoning looked sound — a renewal does not rename a
company, and a name we resend is a name your duplicate rule can match on. The
first renewal through it, **LR-37641**, came back with **EMRE KARAYALCIN** on
the record where **TRAHEEL DELIVERY SERVICES L.L.C** belongs: the applicant's
name, which is the only other name in that composite (the `User` item).

**So your handler does not leave an absent `Name` alone — something downstream
fills it.** Please confirm what, because it matters beyond us: any caller
omitting a field on an update would expect the stored value to stand.

**And please check the Account for trade licence 1196781 in PreProd2.** If its
`Name` was overwritten with the applicant's, it needs restoring to TRAHEEL
DELIVERY SERVICES L.L.C.

The Account is now sent exactly as it was before, with both its `Id` and its
`Name`.

**The rollback now explains itself.** `allOrNone` echoes one sentence onto every
item, so the applicant used to be told "a record already exists with the same
unique value for one of the unique fields", which nobody can act on. It now
names the company-name rule, says nothing was created and nothing they gave is
wrong, forbids the retry that fails identically, and offers to update the
existing application instead.

**`EPG_TRN_No__c` we have never sent** — it appears nowhere in the payload
below. Nothing to fix, but worth recording: we do not collect a TRN anywhere in
this journey, so if EPGL expect one on the request it has to be added on both
sides.

**We will go on offering "submit as new".** Their answer says a second open
request is allowed, so the recommendation stays a recommendation and the choice
stays the customer's.

### Still open with EPGL

1. **Why does a name-matching duplicate rule fire on a record we address by
   `Id`?** A record is not its own duplicate. Either PreProd2 holds a SECOND
   Account named TRAHEEL DELIVERY SERVICES L.L.C — plausible, since submissions
   before 16 September could insert one — or the rule is matching the record
   against itself. **This is now the whole question.** Withholding the name was
   the one fix available on our side and it cannot be used, so 24 September's
   rollback is unresolved until this is answered.
2. **Can the error name the field?** Still the single change that would save the
   most time on both sides. "One of the unique fields" cost a week.
3. **Contact is matched on `Email` — which makes the email the key.** In the
   payload below the ACCOUNTANT's contact goes out under
   `emre.karayalcin@7x.ae` with `LastName: HALL`. If the applicant's own contact
   already uses that address, matching on email would overwrite the applicant's
   record with the accountant's name. We are checking our side; EPGL should
   confirm what their handler does when one email arrives twice with two names.

## Our reading at the time, which was wrong


`Account` is sent with an `Id`, so it is an update and cannot be the collision.
That leaves `NewLicenseRequest`, `Partner1`, `Partner2`, `NewUser`, `NewContact`
and `Member1`.

**`NewUser` is the one we would look at first.** It inserts a `User` whose email
is `emre.karayalcin@hotmail.com`, and this applicant has submitted before — a
Salesforce `Username` is unique across every org, and `Email` is commonly unique
on portal users too. A second submission by the same person would try to create
the same user again.

We may well be wrong. We cannot see your validation rules, duplicate rules or
custom unique fields, which is why this is a question rather than a report.

## What we asked (answered above)

1. **Which field is the unique constraint on?** The response does not name it —
   if the error could carry the field, that alone would save a lot of time.
2. **Should a second open request for the same trade licence be possible?** Your
   `duplicate-check` returns `recommendedAction: "Update existing application"`
   for every match, which reads as advice rather than a rule. If it is a rule,
   we will stop offering "submit as new" and always update.
3. **If it is the `User` or `Contact`**, can the composite upsert them on an
   external id rather than insert? A returning applicant is the normal case, not
   an exception.

## The request

`POST /services/apexrest/EPGL/LicenseRequest`

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
        "EPG_Current_Emirate__c": "Dubai",
        "EPG_Trade_license_no__c": "1196781",
        "Approved_Commitment_Form__c": true,
        "EPG_Terms_and_Conditions__c": true,
        "EPG_Trade_license_Expiry_date__c": "2027-06-07",
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
        "Phone": "+971 56 2236775",
        "LastName": "HALL",
        "FirstName": "FAHAD SALEH ALI MOHAMMAD",
        "EPG_Account__c": "001FW00B34EmqMWYEZ",
        "EPG_Designation__c": "Accountant",
        "EPG_License_Request__c": "@{NewLicenseRequest.id}",
        "Is_Secondary_Contact__c": "True"
      },
      "method": "POST",
      "referenceId": "NewContact"
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
    }
  ]
}
```

## The response

```json
{
  "compositeResponse": [
    {
      "referenceId": "Account",
      "httpStatusCode": 400,
      "httpHeaders": {},
      "body": {
        "errors": [
          "Rolled back due to allOrNone=true: A record already exists with the same unique value for \"one of the unique fields\"."
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
          "Rolled back due to allOrNone=true: A record already exists with the same unique value for \"one of the unique fields\"."
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
          "Rolled back due to allOrNone=true: A record already exists with the same unique value for \"one of the unique fields\"."
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
          "Rolled back due to allOrNone=true: A record already exists with the same unique value for \"one of the unique fields\"."
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
          "Rolled back due to allOrNone=true: A record already exists with the same unique value for \"one of the unique fields\"."
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
          "Rolled back due to allOrNone=true: A record already exists with the same unique value for \"one of the unique fields\"."
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
          "Rolled back due to allOrNone=true: A record already exists with the same unique value for \"one of the unique fields\"."
        ],
        "success": false,
        "id": null
      }
    }
  ]
}
```

## The duplicate-check that preceded it, for context

`POST /services/apexrest/EPGL/LicenseRequest/duplicate-check`

```json
{ "tradeLicenseNumber": "1196781", "postalLicenseNumber": "377" }
```

```json
{
  "matchFound": true,
  "matchedRequests": [
    { "matchedRequestNumber": "LR-37604", "matchedRequestStatus": "Closed", "recommendedAction": "Update existing application" },
    { "matchedRequestNumber": "LR-37598", "matchedRequestStatus": "Under document review", "recommendedAction": "Update existing application" },
    { "matchedRequestNumber": "LR-37566", "matchedRequestStatus": "Closed", "recommendedAction": "Update existing application" }
  ]
}
```

Note that two of the three matches are **Closed**. If the constraint is meant to
stop a second *open* request, a closed one should probably not count.
