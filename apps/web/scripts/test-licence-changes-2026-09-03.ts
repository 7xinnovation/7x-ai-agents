/**
 * Renewal WITH CHANGES, detected rather than judged (2026-09-03).
 *
 * The client gave two confirmations for a renewal. A plain one issues the
 * licence within a working day; one where the customer changed a trade licence
 * detail goes to the Licensing team and is NOT issued tomorrow. Which message
 * gets sent was left to the model to work out, and being wrong means promising a
 * customer a licence that is not coming.
 *
 * It is also the moment the uploaded licence stops being evidence: the copy that
 * was read to fill "company name" still shows the OLD name.
 *
 * Run from apps/web:
 *   npx tsx scripts/test-licence-changes-2026-09-03.ts
 */
import { licenceContradiction, documentThatSupplied, DOC_FIELDS_KEY, LICENCE_CHANGED_KEY } from "@dialog/core";
import type { CaseState } from "@dialog/config";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => {
  console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : extra ?? "");
  ok ? pass++ : fail++;
};

const state = (data: Record<string, unknown>) => ({ data } as unknown as CaseState);

const RENEWAL = state({
  company_name: "YI FANG TAIWAN FRUIT TEA L.L.C",
  trade_license_number: "CN-1234567",
  contact_email: "ops@example.com",
  [DOC_FIELDS_KEY]: {
    updated_trade_license: ["company_name", "trade_license_number"],
    form_9: ["leviable_income_q1"],
  },
});

// 1. The case the client raised: the company name is changed on a renewal.
{
  const r = licenceContradiction(RENEWAL, "company_name", "YIFANG CAFE MIDDLE EAST L.L.C");
  check("changing the company name is detected", r !== null, r);
  check("...and names the document to replace", r?.documentKey === "updated_trade_license", r);
  check("...and remembers what the licence said", r?.previous === "YI FANG TAIWAN FRUIT TEA L.L.C", r);
}

// 2. Only fields the LICENCE supplied count. Changing an email is not a change
//    to the trade licence, and must not route the customer to the Licensing team.
{
  check("changing a contact email is not a licence change",
    licenceContradiction(RENEWAL, "contact_email", "new@example.com") === null);
  check("a field from another document is not a licence change",
    licenceContradiction(RENEWAL, "leviable_income_q1", "500000") === null);
  check("a field no document supplied is not a licence change",
    licenceContradiction(RENEWAL, "accountant_name", "Someone") === null);
}

// 3. Not a change at all.
{
  check("re-saving the same value is not a change",
    licenceContradiction(RENEWAL, "company_name", "YI FANG TAIWAN FRUIT TEA L.L.C") === null);
  check("whitespace is not a change",
    licenceContradiction(RENEWAL, "company_name", "  YI FANG TAIWAN FRUIT TEA L.L.C  ") === null);
  check("filling an EMPTY field is not a change",
    licenceContradiction(state({ [DOC_FIELDS_KEY]: { updated_trade_license: ["company_name"] } }), "company_name", "ANY NAME") === null);
}

// 4. The licence slot is recognised whatever the journey calls it -- new licence
//    applications say trade_license, renewals say updated_trade_license.
{
  for (const key of ["trade_license", "updated_trade_license", "initial_approval"]) {
    const s = state({ company_name: "OLD NAME", [DOC_FIELDS_KEY]: { [key]: ["company_name"] } });
    check(`${key} counts as the licence`, licenceContradiction(s, "company_name", "NEW NAME")?.documentKey === key);
  }
  const moa = state({ company_name: "OLD NAME", [DOC_FIELDS_KEY]: { moa: ["company_name"] } });
  check("the MOA is not the trade licence", licenceContradiction(moa, "company_name", "NEW NAME") === null);
}

// 5. The lookup underneath.
{
  check("finds the supplying document", documentThatSupplied(RENEWAL, "trade_license_number") === "updated_trade_license");
  check("returns null for an unsupplied field", documentThatSupplied(RENEWAL, "accountant_name") === null);
  check("survives a case with no documents", documentThatSupplied(state({}), "company_name") === null);
  check("survives a malformed map", documentThatSupplied(state({ [DOC_FIELDS_KEY]: "nonsense" }), "company_name") === null);
}

// 6. The flag exists and is the thing the confirmation wording keys on, so the
//    choice is not the model's to remember.
{
  check("the flag key is stable", LICENCE_CHANGED_KEY === "__licence_changed");
  check("...and is bookkeeping, so it never reaches Salesforce or the case panel",
    LICENCE_CHANGED_KEY.startsWith("__"));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
