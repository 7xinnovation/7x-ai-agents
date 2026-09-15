/**
 * FB-1722, properly this time.
 *
 * "An old version of the MOA was uploaded but the system did not detect the
 * change in the license name." Reproduced on 15 September: the current trade
 * licence, then the 2020 MOA, accepted without a word. The superseded-name rule
 * written on the 11th never disagreed with it — it never ran. The audit says
 * what that upload returned:
 *
 *   extracted: [partner_1_passport_no, partner_2_passport_no,
 *               partner_3_passport_no, owner_passport_no]
 *
 * Four passport numbers and no company name. An empty set of names matches
 * everything.
 *
 * Run from apps/web:  npx tsx scripts/test-unverifiable-document-2026-09-15.ts
 */
import { entityMismatch } from "../lib/docIdentity";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : `\n         ${JSON.stringify(got)}`}`); }
};

const APPLICATION = {
  company_name: "YI FANG TAIWAN FRUIT TEA L.L.C",
  company_name_ar: "اي فانغ تايوان فروت للشاي ش.ذ.م.م",
  trade_name_en: "YI FANG TAIWAN FRUIT TEA L.L.C",
};
/** What that MOA upload actually yielded. */
const THE_OLD_MOA = {
  owner_passport_no: "Z8G229333",
  partner_1_passport_no: "Z8G229333",
  partner_2_passport_no: "HK6357227",
  partner_3_passport_no: "720035369",
};

console.log("\nThe document that could not be checked");
{
  const r = entityMismatch(APPLICATION, THE_OLD_MOA, { documentKey: "moa" });
  check("it no longer passes in silence", r !== null, r);
  check("...but it is not refused either — a poor scan is ordinary", r?.severity === "confirm", r?.severity);
  check("the reason says the check did not happen", /could NOT be checked against this application/.test(r?.reason ?? ""), r?.reason);
  check("...and forbids claiming it was", /do not say it was verified/.test(r?.reason ?? ""));
  check("...and names what to confirm it against", /YI FANG TAIWAN FRUIT TEA/.test(r?.reason ?? ""));
  check("...and says what a rename would look like", /renamed/.test(r?.reason ?? ""));
}

console.log("\nOnly where a company name is always printed");
{
  for (const k of ["moa", "trade_license", "updated_trade_license", "form_9", "audited_financial_statement"])
    check(`${k} must carry one`, entityMismatch(APPLICATION, THE_OLD_MOA, { documentKey: k })?.severity === "confirm", k);
  // These do not name a company, and asking about every one would be noise.
  for (const k of ["partner_1_emirates_id", "partner_2_passport", "lease_contract", undefined])
    check(`${String(k)} is left alone`, entityMismatch(APPLICATION, THE_OLD_MOA, { documentKey: k as string }) === null, k);
}

console.log("\nNothing that worked before has changed");
{
  check("a document that DOES name the company is still checked", entityMismatch(APPLICATION, { company_name: "YI FANG TAIWAN FRUIT TEA L.L.C" }, { documentKey: "moa" }) === null);
  const other = entityMismatch(APPLICATION, { company_name: "TFM EXPRESS SHIPPING L.L.C" }, { documentKey: "form_9" });
  check("...and another company's is still refused outright", other?.severity === "block", other?.severity);
  check("a matching licence number still settles it", entityMismatch(
    { ...APPLICATION, trade_license_number: "697670" },
    { trade_license_number: "697670" },
    { documentKey: "moa" }
  ) === null);
  // The very first document of an application has nothing to be checked against.
  check("the first document is not interrogated", entityMismatch({}, THE_OLD_MOA, { documentKey: "moa" }) === null);
}

console.log("\nThe one that actually caused FB-1722");
{
  // The real audit line from the third reproduction, 15 September:
  //   held     "YI FANG TAIWAN FRUIT TEA L.L.C"
  //   document "YIFANG CAFE MIDDLE EAST L.L.C"
  //   verdict  clear
  const held = { ...APPLICATION, trade_license_number: "697670" };
  const oldMoa = {
    company_name: "YIFANG CAFE MIDDLE EAST L.L.C",
    company_name_ar: "اي فانغ كافيه ميدل ايست ذ.م.م",
    trade_license_number: "697670",
  };
  const r = entityMismatch(held, oldMoa, { documentKey: "moa" });
  check("the same licence number no longer excuses a different name", r !== null, r);
  check("...and it is raised as a possible rename", /RENAMED/.test(r?.reason ?? ""), r?.reason);
  check("...but never refused — it IS this company", r?.severity === "confirm", r?.severity);
  check("...and the model may not call it verified", /do not describe the document as verified/.test(r?.reason ?? ""));
  check("...and the other-registered-name explanation is left open", /other registered name/.test(r?.reason ?? ""));
  // The 3 September fix, which this must not undo.
  check("the same company under the same name is still silent", entityMismatch(
    held,
    { company_name: "YI FANG TAIWAN FRUIT TEA", trade_license_number: "697670" },
    { documentKey: "moa" }
  ) === null);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
