# EPGL 2.0 — their catalogue against our journey, field by field

*20 October 2026. What the new regulation asks for, what `epgl-dialog` collects
today, and therefore what has to be built. Their side is the live NewLaw
catalogue (`generatedOn` 2026-10-19, 10 products, 21 distinct application fields,
18 document types). Our side is the `new_license` journey as deployed on
staging: 3 steps, 96 fields, 19 document slots.*

---

## 1. The shape of the gap, in one paragraph

Our journey collects **who the company is**. Their 2.0 catalogue asks for that
*and* for **what the company is declaring about its operations** — weight
ceilings, tracking, consignment notes, insurance cover, fleet size, food and
medicine handling, cold chain, intermediation model, outsourced activities.
Essentially none of that second half exists in the journey today. The company
half maps across almost cleanly.

So this is not a migration. It is the existing company intake, kept, plus a new
product-dependent declarations step that did not exist in 1.x.

## 2. Their 21 application fields

| their field | type | required in | ours today | what it needs |
|---|---|---|---|---|
| `Product_Code` | string | 10/10 | — | **New.** The product the applicant picked. Needs a licence-type/option step ahead of everything else — the PRD's "licence type, licence option". |
| `applicationId__c` | string | 10/10 | — | **Blocked.** See §5. |
| `Signatory_UAE_PASS_Id` | string | 10/10 | `owner_*` / UAE PASS sign-in | **Partly.** We have the signed-in identity; we do not record it as the signatory Contact reference. |
| `Declared_Tier__c` | picklist | 0/10 | — | **New.** General / Specialised / Projects and Establishments. Defaults from the product. Restricted picklist. |
| `Declared_Scope__c` | picklist | 0/10 | — | **New.** Domestic / Domestic and International. Defaults from the product. |
| `Declarations_Accepted_On__c` | datetime | 0/10 | `declaration_accepted`, `declaration_accepted_at` | **Have it.** Rename on the way out. |
| `Form_Data` | object | 0/10 | — | **New**, but free. Anything without a dedicated field, as JSON. |
| `Declared_Max_Shipment_Weight_Kg__c` | number | 6/6 CEP30 | — | **New.** Above the ceiling is a rejection, so validate before submitting. |
| `Affirms_Shipment_Tracking__c` | boolean | 6/6 CEP30 | — | **New.** Article 14 operational standard. |
| `Affirms_Consignment_Notes__c` | boolean | 6/6 CEP30 | — | **New.** Article 14 operational standard. |
| `Insurance_Coverage_AED__c` | number | optional | — | **New.** Conditional on the insurance certificate being supplied. |
| `Declared_Vehicle_Count__c` | number | optional | — | **New.** Conditional on the fleet declaration being supplied. |
| `Declares_Food_Delivery__c` | boolean | FOODMED | — | **New.** Drives the municipal food safety clearance document. |
| `Declares_Medicine_Delivery__c` | boolean | FOODMED | — | **New.** Drives the pharmaceutical authorisation *and* cold-chain documents. |
| `Cold_Chain_Capability__c` | boolean | optional | — | **New.** |
| `Temperature_Sensitive_Categories__c` | multipicklist | optional | — | **New.** Semicolon-delimited, 8 values. |
| `Intermediation_Model__c` | string | INTERMED | — | **New.** Free text. |
| `Intermediation_Parties__c` | picklist | INTERMED | — | **New.** Consignors / Operators / Both. |
| `Data_Handling_Confirmed__c` | boolean | INTERMED | — | **New.** |
| `Principal_Licence_Number` | string | OUTSOURCE | — | **New.** The PRINCIPAL's CEP licence — see §4. |
| `Outsourced_Activities__c` | multipicklist | OUTSOURCE | `activity_codes` | **Partly.** We collect activity codes; theirs is a restricted set (CEP30, FOODMED, INTERMED, LOCKERS, OUTSOURCE). |

**Score: 2 of 21 already collected, 2 partly, 17 new.** All 17 are
product-dependent, which is the point — they belong in one new step whose
contents are driven by `Product_Code`.

## 3. Documents

We have 19 slots; they define 18 types. They barely overlap, because ours are
per-partner identity documents and theirs are operational declarations.

**Ours that map:** `trade_license` → *Trade Licence / Initial Name Approval*,
`lease_contract` → *Lease Contract*.

**Ours with nowhere to go:** `moa`, and all 16 `partner_N_passport` /
`partner_N_emirates_id` slots. Salesforce have agreed to add passport, Emirates
ID and MOA types to every product — until they do, these have no home and the
PRD still requires them attached.

**Theirs we do not collect at all (16):** Beneficial Ownership Declaration
(required on all 10), Operational Standards Self-declaration and Insurance
Certificate and Operational Fleet Declaration (the 6 CEP30 products), SME
Licence (the 4 SME products), Municipal Food Safety Clearance / Pharmaceutical
Handling Authorisation / Cold-chain Capability Declaration / Storage Premises
Declaration (FOODMED), Data Handling Declaration / Intermediation Model
Declaration / Operator Contracts (INTERMED), Locker-PUDO Site Locations and
Contracts / Liability and Indemnity Declaration (LOCKERS), Principal Licensee
Contract (OUTSOURCE).

Three of those are **conditional**, not always required: the food safety
clearance appears only when `Declares_Food_Delivery__c` is true, and the
pharmaceutical authorisation and cold-chain declaration only when
`Declares_Medicine_Delivery__c` is true. Our `condition` field type already
expresses this, so it is configuration rather than code.

**Limits:** 10 MB, PDF only, base64 inside the composite. We have committed to
25 MB for MOAs and passports and Emirates IDs are usually images. Open with
them; they think an API from a previous project may cover it.

## 4. Eligibility rules we have to enforce before submitting

- **OUTSOURCE involves two companies.** `Principal_Licence_Number` is the
  *principal's* CEP licence — a third party, the operator doing the hiring
  (their example: Fast Riders applies, Aramex is the principal). Salesforce
  check it is active. `requiresCepLicence: true` is about the *applicant*,
  checked from their own trade licence. So the applicant needs its own CEP
  licence **and** must supply an active principal's number. Both, not either.
- **LOCKERS also sets `requiresCepLicence: true`**, and its note says the
  principal number may be omitted "when applied for together with a CEP
  application". Salesforce's answer was that a different licence type or permit
  is a separate request, which does not quite explain the note. Low priority —
  park it until a combined application is actually wanted.
- **`Declared_Max_Shipment_Weight_Kg__c` above the ceiling is rejected.**
  Validate in the conversation, not at the composite.
- **Three products are conditional-issuance:** FOODMED (physical inspection),
  INTERMED (desk verification), LOCKERS (physical inspection). The applicant
  must be told a licence can be issued conditionally and an inspection follows.
- **Payment threshold 20,000 AED** and SLAs of 30 statutory / 1 operational
  working days come from catalogue `parameters` — read them, do not hard-code.

## 5. The one thing blocking the build

`applicationId__c` keys the composite, pricing, status and information-request
endpoints. All four 404 without it. Their catalogue describes it as "Portal
application id, unique per company", their composite example supplies it, and
the field is `string(255)` — not unique, not an external id. Their written
answer was that Salesforce mints it and nothing is needed from us.

Until that is settled we cannot write the retry path for a submission, so it is
the first thing to resolve. Asked again in `EPGL-STATUS-PUSH-2026-10-20.md` §7.

## 6. Suggested build order

1. Licence type and option step → `Product_Code`, `Declared_Tier__c`,
   `Declared_Scope__c`. Everything else is conditional on it.
2. Catalogue-driven declarations step, generated from `applicationFields` per
   product rather than hand-written per product — 10 products share 21 fields,
   and hand-writing them is how `lib/integrations.ts` grew its patchers.
3. Document slots from `documents[]`, with `requiredWhen` mapped to our
   `condition`.
4. Pricing call before payment; it is authoritative and already matches the
   catalogue and the fee spreadsheet.
5. Status polling as a backstop, then the push endpoint when the secret arrives.

**Do not repeat `apps/web/lib/integrations.ts`.** Fifteen server-side patchers
correcting field names the model got wrong is the cost of mapping by hand
against a spec that moved. The catalogue is machine-readable and live — drive
the fields from it.
