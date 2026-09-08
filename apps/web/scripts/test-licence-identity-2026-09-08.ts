/**
 * Only the licence's printed identity can contradict the licence.
 *
 * licenceContradiction marks the trade licence on file as no longer evidencing
 * the application when a value it supplied changes. That is right for the
 * company name -- the case the client raised -- and wrong for most of what a
 * licence also happens to carry.
 *
 * It bit twice on 8 September. activity_codes: the licence's DED activities
 * ("Coffee Shop, Restaurant") against the postal services being applied for.
 * Then address_street: the licence was read in Arabic, the customer restated the
 * same address in English, and their current trade licence was rejected for it,
 * blocking the submission on an upload that would have changed nothing.
 *
 * Run from apps/web:  npx tsx scripts/test-licence-identity-2026-09-08.ts
 */
import { licenceContradiction, DOC_FIELDS_KEY } from "../../../packages/core/src/ai/tools";
import type { CaseState } from "@dialog/config";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, got?: unknown) {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`); }
}

/** A case whose trade licence supplied everything a real one does. */
const SUPPLIED = [
  "company_name", "company_name_ar", "trade_license_number", "license_expiry_date",
  "regulator", "emirate", "region", "address_street", "po_box", "activity_codes",
  "partner_count", "partner_1_name", "owner_name", "contact_email",
];
const caseWith = (data: Record<string, unknown>) =>
  ({ data: { ...data, [DOC_FIELDS_KEY]: { trade_license: SUPPLIED } } } as unknown as CaseState);

const AR_ADDRESS = "محل رقم R.40.13 ملك هيئة الطرق و المواصلات (محطة برجمان) - المنخول";
const EN_ADDRESS = "Shop No. R.40.13, Roads and Transport Authority Property (BurJuman Station) - Al Mankhool";

console.log("\nThe reported case: the same address, in the other language");
{
  const r = licenceContradiction(caseWith({ address_street: AR_ADDRESS }), "address_street", EN_ADDRESS);
  check("restating the address does NOT reject the licence", r === null, r);
}
{
  const r = licenceContradiction(caseWith({ activity_codes: "Coffee Shop, Restaurant" }), "activity_codes", "Letters, Parcels");
  check("answering the postal activities does not either", r === null, r);
}

console.log("\nThe licence's printed identity still counts");
for (const [key, was, now] of [
  ["company_name", "YI FANG TAIWAN FRUIT TEA L.L.C", "YI FANG TRADING L.L.C"],
  ["company_name_ar", "اي فانغ تايوان", "اي فانغ للتجارة"],
  ["trade_license_number", "697670", "697671"],
  ["license_expiry_date", "2026-11-04", "2027-11-04"],
] as const) {
  const r = licenceContradiction(caseWith({ [key]: was }), key, now);
  check(`${key} changing rejects the licence`, r?.documentKey === "trade_license", r);
  check(`  ...and quotes what the licence still says`, r?.previous === was, r?.previous);
}

console.log("\nEverything else on a licence is context, not identity");
for (const [key, was, now] of [
  ["regulator", "Department of Economic Development", "DED Dubai"],
  ["emirate", "Dubai", "DXB"],
  ["region", "Al Mankhool", "Mankhool"],
  ["po_box", "13422", "13422 Dubai"],
  ["partner_count", "3", "4"],
  ["partner_1_name", "Faisal Eissa", "Faisal Eissa Lutfi Ali Hussain"],
  ["owner_name", "Faisal", "Faisal Eissa"],
] as const) {
  check(`${key} does not`, licenceContradiction(caseWith({ [key]: was }), key, now) === null);
}

console.log("\nThe rules that were already there still hold");
check("contact details are the customer's own", licenceContradiction(caseWith({ contact_email: "a@b.c" }), "contact_email", "d@e.f") === null);
check("an unchanged value is not a change", licenceContradiction(caseWith({ company_name: "ACME" }), "company_name", "ACME") === null);
check("whitespace is not a change", licenceContradiction(caseWith({ company_name: "ACME" }), "company_name", "  ACME  ") === null);
check("a value nothing supplied is not a contradiction", licenceContradiction(caseWith({ company_name: "ACME" }), "something_else", "x") === null);
check("an empty previous value is not a contradiction", licenceContradiction(caseWith({ company_name: "" }), "company_name", "ACME") === null);
{
  // Scoped to the LICENCE: the MOA supplying a name is the MOA's business.
  const moaCase = { data: { company_name: "ACME", [DOC_FIELDS_KEY]: { moa: ["company_name"] } } } as unknown as CaseState;
  check("a field the MOA supplied does not reject the licence", licenceContradiction(moaCase, "company_name", "OTHER") === null);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
