# EPGL assistant — API call flows

| | |
|---|---|
| **Assistant** | EPGL — Emirates Post Group Licensing assistant (chat widget on epgl.ae) |
| **Salesforce org** | `https://epro--preprod2.sandbox.my.salesforce.com` (pre-prod sandbox) |
| **REST API version** | `v62.0` for reads, `v66.0` for composite sub-request URLs |
| **Date** | 2 September 2026 |

Every call the assistant makes, in the order it makes them, with the payload.
Each step says what the customer is doing, which call it triggers, and what we
take from the response.

**Auth.** One OAuth 2.0 **client-credentials** grant against
`/services/oauth2/token`, cached ~20 minutes and re-minted once on a `401`.
Salesforce rejects a `scope` parameter on this grant, so we do not send one.
Every call below carries `Authorization: Bearer <that token>`.

**Two kinds of call.** **Reads** are SOQL over the standard query endpoint, with
the statements fixed in our code — the model supplies a value, never the query.
**Writes** are your Apex REST resources. Italics in amber mark an open question
for your team.

---

# Flow A — Identify the customer and their company

### A1 · Customer signs in with UAE PASS

```
GET  https://id.uaepass.ae/idshub/authorize?client_id=epg_web_prod&…
POST https://id.uaepass.ae/idshub/token
GET  https://id.uaepass.ae/idshub/userinfo
```
**Why** Establish who they are. Not Salesforce — UAE PASS directly.
**Take** the Emirates ID from `userinfo`. That is all we get, and it is the only
key we can use to find their company.

---

### A1b · Their trade licences, from the Ministry of Economy

```
GET {wayn}/api/entities/get-moe
x-emirates-id: 784199983926421
Authorization: Bearer <service JWT from accounts.emiratespost.ae>
```
```
staging     https://stg.wayn.ae/services/digitalbox-portalapi
production  https://www.wayn.ae/services/digitalbox-portalapi
```
**Why** A2 below finds only companies EPGL has *already licensed*. A first-time
applicant holds a perfectly good trade licence and matches nothing, so we used to
ask them to type the number, the name, the expiry and the regulator by hand.

**We do not call GSB ourselves.** `integrate.gsb.government.ae` is reached by the
Wayn business API (`digitalbox-portalapi`), which holds the MOEc credentials and
is the service registered to call the bus. A base URL pointing at the government
host is refused by our client rather than used.

**Take** `TradeLicenseNumber`, `CompanyNameEn` / `CompanyNameAr`, `ERN` and
`IssuingEntityCode`. **That is all this endpoint returns** — see the gaps below.

**Then reconcile.** Each licence is looked up with A3. Already licensed by EPGL →
it is a **renewal**, and we have the account. Not → it is a **new application**,
pre-filled from the registry rather than typed.

**What this endpoint does not give us, and needs to**
- **No licence expiry.** `EPG_Trade_license_Expiry_date__c` is required on the
  filing, and the summary DTO drops the date MOEc returned. The assistant is told
  the expiry is UNKNOWN rather than blank, so it asks — but that is a workaround.
- **No owners.** MOEc returns the owner block; the DTO keeps only managers, and
  the handler keeps neither. Ownership therefore reads as `unknown` and falls
  back to document review.
- **It filters.** Licences already linked to the *subject's* Wayn account are
  skipped — onboarding behaviour, wrong for us. A customer who is also a Wayn
  business user sees a short list and no indication it was shortened.
- **It needs an admin JWT.** `GetAuthData(true)` resolves a user with
  `IsAdmin == true` and the handler dereferences `authData.User.Id` *before*
  reading `x-emirates-id`, so despite `[AllowAnonymous]` an anonymous call is a
  500, not a lookup.

*Status (3 Sep 2026): the Wayn team is preparing a NEW set of services for EPGL
rather than opening this one up, so `get-moe` above is the shape of the problem
rather than the endpoint we will end up calling. What we need from whatever they
publish is unchanged: keyed on Emirates ID, callable server-to-server, and
carrying the licence EXPIRY and the OWNER block — the two fields this endpoint's
DTO discards and the two we cannot file without. Only the transport in
`lib/moeLicences.ts` changes; the parsing, the Salesforce reconciliation and the
tests sit above it.*

**Expected responses** An empty list means the person holds no licence — a normal
answer, not a failure. A response carrying licences that none of our mappings
recognise throws instead of reading as "owns nothing": the two are otherwise
indistinguishable.

*Open: the MOEc code lists for emirate, status and legal type — their own
`IssuingEntities` table (`GET /api/entities/issuing`) carries `EntCode` with
emirate name and free-zone flag and is likely the join; whether coverage includes
emirate-level DED and DIFC/ADGM; and what `ownerContest` / `entityContest` scope.*

---

### A2 · Find their company from that Emirates ID

```
GET /services/data/v62.0/query?q=<SOQL>
```
```sql
SELECT Id, Name, EPG_Company_Name_Arabic__c, EPG_Trade_Name_in_English__c,
       EPG_Trade_Name_in_Arabic__c, EPG_Trade_license_no__c,
       EPG_Trade_license_Expiry_date__c, EPG_Emirates__c, EPG_Regulator__c,
       EPG_License_Number__c, EPG_License__c, EPG_License_Status__c,
       EPG_License_Expiry_Date__c,
       (SELECT FirstName, LastName, Email, Phone, EPG_Emirates_Id__c,
               LegalEntity_Profile_Person_EmiratesID__c, EPG_Designation__c
          FROM Contacts)
FROM Account
WHERE Id IN (SELECT AccountId FROM Contact
              WHERE EPG_Emirates_Id__c IN ('784199983926421',
                                           '784-1999-8392642-1'))
```
**Why** Sign-in gives an Emirates ID, not a trade licence number, so the company
has to be reached through `Contact`. **Both spellings are queried** — bare digits
and dashed — because a record stored one way would otherwise read as "no company".
**Take** `Id` (the Account id), the trade licence number, `EPG_License__c` (the
licence RECORD id — needed later), and the contacts.

**Note** A person can be a contact on several companies, so this returns a list
and the customer chooses. We never assume the first.

*Open: is there a supported way to resolve an Account from an Emirates ID
directly? We were told the `AccountByLicense` Apex resource applies the ownership
rule, but our integration user is not granted that class (403), so we join
through Contact ourselves.*

---

### A3 · Or find it from a trade licence number

```sql
SELECT <same fields> FROM Account WHERE EPG_Trade_license_no__c = '1234567'
```
**Why** The fallback when sign-in produces no match, or for a guest.

### A3b · Or by Account id, once known

```sql
SELECT <same fields> FROM Account WHERE Id = '0015f00000XXXXXXXX'
```

---

### A4 · Show their quarterly history

```sql
SELECT Id, Name, EPG_Year__c, Quarter__c, EPG_Status__c, EPG_Approval_Status__c,
       EPG_Submitted_Date__c, EPG_License__c, EPG_License__r.Name,
       EPG_License_Start_Date__c, EPG_License_End_Date__c,
       EPG_Postal_License_Number__c, EPG_Total_Revenue__c,
       EPG_Total_Revenue_for_Leviable_Services__c,
       Total_Revenue_for_Non_Leviable_Services__c,
       EPG_Calculated_Levy_Amount__c, EPG_Due_Fees_for_the_period__c,
       EPG_Amount_Paid__c, Payable_Balance_For_Customer__c
FROM EPG_Form_9__c
WHERE EPG_Company_Name__c = '0015f00000XXXXXXXX'
ORDER BY EPG_Year__c DESC, Quarter__c DESC
LIMIT 12
```
**Why** Form 9 is what IDEP files each quarter, so these are the quarterly
figures we pre-fill a renewal from — the customer does not retype them.
**Take** `EPG_License__c` in particular: it is the licence record id the renewal
finance rows require, and your example query returns the licence *name* instead.

---

# Flow B — Apply for a new licence

### B1 · Check it is not a duplicate

```
POST /services/apexrest/EPGL/LicenseRequest/duplicate-check
```
**Why** Before any brand-new submission, so we do not create a second
application for something already in flight.
**Take** `matchFound`, `matchedRecordIds`, `matchedRequests[]` with each one's
status, number and `recommendedAction`.

*Note: this does not return an Account id, so it cannot be used to find one.*

---

### B2 · Submit the application — one atomic composite

```
POST /services/apexrest/EPGL/LicenseRequest
```
```jsonc
{ "allOrNone": true,
  "isAgentSource": true,
  "compositeRequest": [
    { "method": "POST", "referenceId": "NewAccount",
      "url": "/services/data/v66.0/sobjects/Account",
      "body": { "Name": "Example Courier LLC",
                "EPG_Company_Name_Arabic__c": "…",
                "EPG_Trade_license_no__c": "1234567",       // the upsert key
                "EPG_Trade_license_Expiry_date__c": "2027-05-30",
                "EPG_Emirates__c": "Dubai",
                "RecordTypeId": "0125f000001xIheAAE" } },

    { "method": "POST", "referenceId": "NewPartner",
      "url": "/services/data/v66.0/sobjects/EPG_Partner__c",
      "body": { "EPG_Account__c": "@{NewAccount.id}", … } },

    { "method": "POST", "referenceId": "NewContact",
      "url": "/services/data/v66.0/sobjects/Contact",
      "body": { "AccountId": "@{NewAccount.id}",
                "EPG_Emirates_Id__c": "784…", "EPG_Designation__c": "Manager", … } },

    { "method": "POST", "referenceId": "NewUser",
      "url": "/services/data/v66.0/sobjects/User",
      "body": { "EPG_Emirates_Id__c": "784…", … } },

    { "method": "POST", "referenceId": "NewMember",
      "url": "/services/data/v66.0/sobjects/Members__c", "body": { … } },

    { "method": "POST", "referenceId": "NewDocument",
      "url": "/services/data/v66.0/sobjects/EPG_Document__c", "body": { … } },

    { "method": "POST", "referenceId": "NewLicenseRequest",
      "url": "/services/data/v66.0/sobjects/EPG_License_Request__c",
      "body": { "EPG_Account__c": "@{NewAccount.id}",
                "RecordTypeId": "0125f000001xIhuAAE",
                "EPG_Service__c": "a1H5f0000033Q7pEAE",
                "serviceId": "S-EPG-000002",
                "serviceNameEN": "Issue Postal Activity License",
                "Terms_Conditions_Accepted__c": true } } ] }
```

**What we learned the hard way, all of it worth confirming with you**

| | |
|---|---|
| **HTTP is always 200.** | Success is judged only by each item's `body.success`. A failed submission still returns 200. |
| **Every item needs `method`, `referenceId` and a `url`.** | A sub-request without a valid `url` fails the whole submit with `Invalid or missing URL`. |
| **The Account is matched by trade licence number, not by Id.** | Send the Account **without** an `Id` and with `EPG_Trade_license_no__c`; the handler updates the existing record. A "duplicate / unique conflict" on the Account means the company already exists — resend the same licence number, do not create a second company. |
| **Array-body items fan out with `_<index>`.** | `NewContact` becomes `NewContact_0`, `NewContact_1`… in the response. |
| **`EPG_Document__c` items are processed internally and omitted from the response.** | So their absence is not a failure. |
| **On any failure every item echoes the same message.** | `Rolled back due to allOrNone=true: …` — we relay the underlying error rather than that wrapper. |
| **Account fields are nearly all read-only to the portal.** | Editable: `Name`, `EPG_Trade_license_no__c`, `RecordTypeId`, `EPG_Trade_license_Expiry_date__c`, `EPG_Trade_Name_in_English__c`, `EPG_Trade_Name_in_Arabic__c`. The English company name is the **standard `Name`** field — there is no English-name custom field. |

---

### B2b · Document placeholders — **unresolved**

Per your team, an application's documents are tracked as `EPG_Document__c`
records, one per file, and the Documents panel on the licence request lists
those. We now send them in the composite exactly as your spec's issuance example
shows — captured from LR-37195 on 2 September:

```jsonc
{ "method": "POST", "referenceId": "NewDocument",
  "url": "/services/data/v66.0/sobjects/EPG_Document__c",
  "body": [
    { "EPG_Company__c": "@{NewAccount.id}", "EPG_File_Name__c": "Postal  GSI.pdf",
      "docType__c": "pdf", "fileType__c": "pdf",
      "EPG_File_Id__c": "64bd3864-50f4-4f59-afbe-e357b61777b9",
      "fileSize__c": 478561 },
    { …"MOA GSI.pdf", 148777 },
    { …"Image (3).jpg", "jpg", 326795 } ] }
```

**Seven items go out; six come back.** The `NewDocument` item is absent from
`compositeResponse` entirely — no id, no `success`, no error:

```
NewAccount         200  {"success":true,"id":"0015f00000ic9pLAAQ"}
NewPartner         200  {"success":true,"id":"a16FW000BDkkzYOYYY"}
NewContact         200  {"success":true,"id":"003FW00CMsxUkTgYMK"}
NewUser            200  {"success":true,"id":"005FW002f7qVFbMYAW"}
NewMember          200  {"success":true,"id":"a3jFW0001wj2Dg8YAE"}
NewLicenseRequest  200  {"success":true,"id":"a11FW000V4a3nF2YII"}
                        ← NewDocument: nothing
```

The files themselves attach fine — LR-37195 shows all three under **Files** — but
the Documents panel still lists only the system-generated "Lease Contract".

**What we need to know:**

1. Are the `EPG_Document__c` records being created at all? If so, they hang off
   `EPG_Company__c`, so would they appear on the **Company** rather than on the
   licence request?
2. Should the placeholder also carry a licence-request lookup? Your example has
   only `EPG_Company__c`, and we will not invent a field name.
3. What is `EPG_File_Id__c` meant to be? We mint a UUID per file. If it is meant
   to correlate with the uploaded file, the upload returns `contentVersionId` and
   `contentDocumentId` — Salesforce ids, not UUIDs — which would mean uploading
   first and submitting second.
4. Should the item be echoed in `compositeResponse` either way? Silence is
   indistinguishable from being ignored.

---

### B3 · Attach the documents

```
POST /services/apexrest/EPGL/Document
```
Base64, linked to the `NewLicenseRequest` id. Trade licence, MOA, Emirates ID.

**Note** the Declaration & Undertaking is captured in the conversation, not as a
file: `Terms_Conditions_Accepted__c: true` on the licence request, with the
acceptance timestamp held on our side. We never ask for a signed PDF of it.

---

### B4 · Report status back to the customer

```
GET /services/apexrest/EPGL/LicenseRequest/status?id=<NewLicenseRequest id>
```

---

# Flow C — Renew a licence

Flow B's shape, with a different record type and four extra requirements.

### C1 · Read the company and its licence first

`Flow A2` or `A3`, then `A4`. This is not optional for a renewal — two values
only exist there:

- `accountId` → the renewal Account item **must** carry its `Id`. Without it the
  handler attempts an insert and fails on the Account's unique field.
- `EPG_License__c` (the licence **record id**) → every finance row needs it.

### C2 · Submit the renewal

```
POST /services/apexrest/EPGL/LicenseRequest
```
```jsonc
{ "allOrNone": true, "isAgentSource": true,
  "compositeRequest": [
    { "method": "POST", "referenceId": "NewAccount",
      "url": "/services/data/v66.0/sobjects/Account",
      "body": { "Id": "0015f00000XXXXXXXX",              // required on a renewal
                "EPG_Trade_license_no__c": "1234567",
                "EPG_Trade_license_Expiry_date__c": "2027-05-30",
                "RecordTypeId": "0125f000001xIheAAE" } },

    { "method": "POST", "referenceId": "NewContact",
      "url": "/services/data/v66.0/sobjects/Contact",
      "body": { "AccountId": "@{NewAccount.id}",
                "EPG_Designation__c": "Accountant", … } },       // mandatory

    { "method": "POST", "referenceId": "NewLicenseRequest",
      "url": "/services/data/v66.0/sobjects/EPG_License_Request__c",
      "body": { "EPG_Account__c": "@{NewAccount.id}",
                "RecordTypeId": "0125f000001xIhwAAE",
                "EPG_Service__c": "a1H5f0000033Q7lEAE",
                "serviceId": "S-EPG-000003",
                "serviceNameEN": "Renew Postal Activity License",
                "EPG_Terms_and_Conditions__c": true,
                "Approved_Commitment_Form__c": true,
                "Mandatory_integration_with_IDEP__c": true,
                "EPG_Is_Financial_Statement_Submitted__c": true } },

    { "method": "POST", "referenceId": "Finance1",
      "url": "/services/data/v66.0/sobjects/EPG_Finance_Summary__c",
      "body": { "EPG_License_Request__c": "@{NewLicenseRequest.id}",
                "EPG_License_No__c": "a0X5f00000YYYYYYYY",   // licence RECORD id
                "Quarter__c": "Q3", "EPG_Year__c": "2023",
                "Name": "Q3 2023",
                "EPG_Leviable_Income__c": 250000,
                "EPG_Non_Leviable_Income__c": 0 } },
    /* …one per quarter, walking forward from the licence period start… */ ] }
```

**Four renewal-specific things**

| | |
|---|---|
| **All four flags must be `true`.** | `EPG_Terms_and_Conditions__c`, `Approved_Commitment_Form__c`, `Mandatory_integration_with_IDEP__c`, `EPG_Is_Financial_Statement_Submitted__c`. We only set them from an explicit in-chat confirmation. |
| **`EPG_License_No__c` is an ID-type lookup.** | It takes the licence **record id**, not the printed licence number. Sending the number fails the whole composite with `License No: id value of incorrect type`. |
| **`EPG_Finance_Summary__c` has no upsert key.** | So a second submit for the same renewal creates duplicate quarters. We check `getRequestStatus` before retrying, ever. |
| **Quarters are real calendar quarters.** | Walked forward from the licence period start, rolling the year at Q4 — start Q3 2023 gives Q3 2023, Q4 2023, Q1 2024, Q2 2024. |

**Expected responses**
- The backend auto-sets `Under document review` on renewals — we tell the
  customer that rather than treating it as pending action.
- `No License found for this Account` means there is nothing to renew; we offer a
  new application instead.

---

# Flow D — Pay a licence fee

The customer pays on our gateway. Salesforce creates the Payment Advice, Invoice
and Receipt itself — your team was explicit that we create none of those. What
Salesforce cannot know is that the money arrived, so we tell it:

```
POST /services/apexrest/paymentNotification/
```
```jsonc
{ "entityId": "Emirates Post Group Licensing - AI Assistant",
  "notifyPayment": {
    "salesforceId": "a0Y5f00000ZZZZZZZZ",          // EPG_License_Request__c id
    "payment": {
      "paymentId": "PAY-2026-0001",
      "payOn": "2026-09-02T08:14:00.000Z",
      "payThru": "N-Genius",
      "paymentMethod": "CreditCard",
      "paymentStatus": "completed",
      "transactions": [
        { "transactionId": "…", "amount": 5000,
          "currency": { "en": "AED", "ar": "درهم" } } ] } } }
```
Fired from our payment webhook once the gateway settles, never from the model.

**The amount is what SETTLED, fee included.** From 3 Sep 2026 EPGL takes payment
on the Emirates Post gateway (temporarily, until it has its own) and adds **1%
"Admin processing fees" ON TOP** — a 100,000 licence fee is charged as 101,000,
in the client's own words. So the transaction amount reported here is 101,000,
not 100,000, because that is the money that arrived.

The fee is computed **server-side** from the licence fee, never by the model, and
the base is remembered on the case: a percentage applied to a total that already
contains it charges 100,000 → 101,000 → 102,010 across reissued payment links for
one unchanged application. Merchant id `200200012694`.

Only the gateway route carries it. Their process map's other route — Finance
requesting a Virtual IBAN from the bank by hand — is at face value, and never
passes through us at all.

**Outlets.** Two, and they must not be swapped:

| | |
|---|---|
| production | `b2bf0418-4bef-430c-8afc-c04154408f80` — EPGL's own, live |
| staging | `b78ef8c7-ce2a-41d6-84c9-e6219557a991` — the N-Genius sandbox |

Emirates Post said to use "anything random" on staging. An invented UUID does not
work — N-Genius rejects an outlet it does not know, so the payment fails at order
creation rather than harmlessly going nowhere. The sandbox outlet NXN already
tests against does work and holds no money. The binding script refuses to put the
production outlet on the sandbox host, or the sandbox outlet on the live one.

**Charging is not switched on.** The gateway is bound and the fee declared, but
the journeys do not require payment yet — the fee is inert until they do.

*Open: whether Salesforce wants the fee as its own Payment Item, or folded into
the one total; and whether it is refunded with the fee on a rejected application.*

**Two wire quirks from your own spec, noted so nobody tidies them away**
- `currency` and `desc` are reserved words in Apex and are remapped internally,
  so those exact keys must appear on the wire.
- The `400` body still names a legacy `applicationId` element; the field it means
  is `notifyPayment.salesforceId`.

**On success** Salesforce creates the `Payment_Notification__c` against the
request's Payment Advice, sets the request to Payment Verified, marks the Advice
Paid with the summed transaction amount, and approves the Payment Items.

---

# What we deliberately do NOT do

| | |
|---|---|
| **The model never writes SOQL.** | Every query above is a fixed template in our code; the model supplies one value, which is shape-checked first. A licence number must match `^[A-Za-z0-9][A-Za-z0-9\-/ ]{0,38}$`, an Emirates ID must be 15 digits, an id 15–18 alphanumerics. The `q` parameter is not a tool input, so an injected instruction in an uploaded document cannot read the org. |
| **We create no Payment Advice, Invoice or Receipt.** | Only the notification. |
| **We never submit a renewal twice.** | `EPG_Finance_Summary__c` has no upsert key. |
| **We never ask for a signed declaration document.** | It is a checkbox in the conversation, mapped to the boolean fields. |

---

# Open questions

1. **`AccountByLicense`** — our integration user gets a `403` on that Apex class,
   so we join Account → Contact ourselves to resolve a company from an Emirates
   ID. Should we be granted it, or is the join the intended route? (A1b now
   answers the first-time applicant, whom the Contact join never could, but a
   customer already on file is still reached through that join.)
2. **An Account id from `duplicate-check`.** It returns `matchedRecordIds` and
   `matchedRequests`, but nothing that identifies the Account, so a renewal has
   to reach the id through the SOQL read. Is that intended?
3. **`EPG_Finance_Summary__c` upsert key.** Without one, any retry duplicates
   quarters. Could `EPG_License_Request__c` + `Quarter__c` + `EPG_Year__c` be
   made an external id?
4. **HTTP 200 on failure.** Judging by `body.success` per item works, but a
   non-2xx on a rolled-back composite would remove a whole class of mistake.
5. **Production org.** Everything above runs against
   `epro--preprod2.sandbox`. We have no production instance URL or credentials,
   so the production assistant is still pointed at the sandbox.
6. **Field-level access.** Confirmation of exactly which Account fields the
   portal integration user may write. We work from six; more would remove some
   re-asking.
7. **Document placeholders — see B2b.** Seven composite items go out and six come
   back: the `EPG_Document__c` item is dropped from `compositeResponse` without an
   id, a success or an error, and the licence request's Documents panel stays
   empty while the files attach correctly. This is the one blocking item.
