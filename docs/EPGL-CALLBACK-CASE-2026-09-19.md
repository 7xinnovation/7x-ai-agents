# EPGL callback case — what we built, and two things to check your end

For Emirates Post Group Licensing, against
`CallbackCase-PREPROD-Simple.postman_collection.json` (19 September 2026).

The assistant can now raise a callback Case in your Salesforce when an applicant
asks to speak to someone, or when something fails that it cannot recover. Before
this it had no licensing route at all — the only callback path in the product
goes to the PO Box side of the business, which cannot help with a postal
activity licence — so it simply told them to contact you, without naming a
channel.

## Verified in PreProd2

Raised through the code that will do it live, then read back:

| | |
|---|---|
| Case | `500FW00AOKcbyRkY2I` — **00003600** (a test; please close) |
| RecordTypeId | `012FW001nRU85B6YQJ` (Callback) |
| Subject | Callback request — Renew Postal Activity License |
| Origin | Live Chat |
| Priority | High |
| Type | Renew Postal Activity License |
| Status | New |
| Supplied name / phone / email | as sent |

**No new credentials were needed.** The integration's existing connected app
resolves to `ai.agent@epg.ae.preprod` — the same user you assigned
`Callback_Case_API` to on 18 September — and `Case` describes as createable for
it. Same org, same app, same token cache as the licence submission.

## What we send

`RecordTypeId`, `Subject`, `Description`, `Origin`, `Priority`, `Type`,
`SuppliedName`, `SuppliedPhone`, `SuppliedEmail`.

`Type` is mapped from what the applicant was doing, so it reaches the right list
rather than arriving as a generic question:

| journey | Type |
|---|---|
| licence renewal | Renew Postal Activity License |
| new licence | Licensing |
| anything else | Question |

`Origin` is **Live Chat**, because Origin records where the request came from —
the assistant — not how the applicant would like to be reached.

`Description` carries the applicant's own words first, then the context the
assistant already holds: what they were trying to do, the last completed step,
consents given, where the payment got to, and what has already been supplied so
nobody asks for it twice.

## Two things for you

**1. The permission set — done, and confirmed working.** `Callback_Case_API` has
been assigned to the production integration user, and we have verified it end to
end against the live org:

```
instance          https://epro.my.salesforce.com
integration user  sf.integration@7x.ae.agentai
Case              createable = true
Callback type     012NM00SU5NdE0yYMF   available = true
```

That is the id your production collection names, and we do not hold it anywhere:
it is read from the Case describe at run time, so PreProd2's
`012FW001nRU85B6YQJ` and production's are each discovered in the org they belong
to. Every field we send is createable in production and the Origin and Type
picklists match PreProd2 exactly, so nothing needed changing for the live org.

**2. Two documented fields are not actually available.** The collection offers
`AccountId` and `EPG_Postal_Licence_No__c` as optional extras. Checked against
PreProd2:

- `AccountId` is **not createable** for this permission set.
- There is **no postal licence field on Case** in the org at all.

Salesforce rejects an unknown field outright, so sending either on the strength
of the documentation would fail every callback. We send neither. If you would
like the case linked to the company record, the permission set needs `AccountId`
createable — tell us and we will send it, as we already hold the Account id for
a signed-in applicant.

One smaller note, in case it saves someone else the hour: `SELECT Id, Name,
DeveloperName FROM RecordType WHERE SobjectType='Case'` does **not** return the
Callback type for this user — it returns five others. The Case describe does,
with `available: true`. Access to the RecordType object is a different grant from
access to the record type.
