/**
 * A partner that is a company has no passport.
 *
 * JNT EXPRESS COURIER SERVICES L.L.C, 16 September: partner 1 on the trade
 * licence is GLOBAL JET EXPRESS AE FZCO, and the extraction was right — a
 * company holding shares in another company is ordinary on a UAE licence. What
 * was wrong is that the journey then asked that company for a passport copy and
 * an Emirates ID, which do not exist, and the renewal could not be finished.
 *
 * Being wrong in the other direction is worse than being wrong in this one: a
 * person mistaken for a company is never asked for the identity documents the
 * application actually needs. So the evidence is the legal form printed on the
 * name, never the shape of the words.
 *
 * Run from apps/web:  npx tsx scripts/test-corporate-partner-2026-09-16.ts
 */
import { corporatePartner, withPartnerTypes } from "../lib/docIdentity";
import { evalCondition } from "@dialog/config";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : `\n         ${JSON.stringify(got)}`}`); }
};

console.log("\nCompanies, by the legal form printed on them");
for (const name of [
  "GLOBAL JET EXPRESS AE FZCO",
  "YI FANG TAIWAN FRUIT TEA L.L.C",
  "PINCHAIN LOGISTICS LLC",
  "CALX INTERNATIONAL AUDITING OF ACCOUNTS L.L.C",
  "Some Holdings Ltd",
  "AL NASER GROUP",
  "شركة جلوبال جيت إكسبريس",
  "بنجين اللوجستية ذ.م.م",
]) check(`"${name}"`, corporatePartner(name), name);

console.log("\nAnd people, who are not");
for (const name of [
  "Khalifa Thani Ali Khalifa Bin Ghalita",
  "Faisal Eissa Lutfi Ali Hussain",
  "Abdelaziz Mohamed Obaid",
  "Valentina Mintah",
  "MA JIFANG",
  "Tang Xinhua",
  "فيصل عيسى لطفى على حسين",
  "Zhao Zhao",
]) check(`"${name}"`, !corporatePartner(name), name);

console.log("\nNothing is decided from nothing");
for (const v of ["", "  ", null, undefined, "AB"]) check(`${JSON.stringify(v)} decides nothing`, !corporatePartner(v));

console.log("\nThe case carries the answer");
{
  const state = withPartnerTypes({
    data: {
      partner_1_name: "GLOBAL JET EXPRESS AE FZCO",
      partner_2_name: "Khalifa Thani Ali Khalifa Bin Ghalita",
      partner_count: "2",
    } as Record<string, unknown>,
  });
  check("the company is marked a company", state.data.partner_1_type === "company", state.data);
  check("the person is marked a person", state.data.partner_2_type === "person", state.data);

  // THE POINT: the identity documents stop applying to the company and keep
  // applying to the person.
  const cond = (n: number) => `partner_count >= ${n} && partner_${n}_type != 'company'`;
  check("no passport is asked of the company", !evalCondition(cond(1), state.data));
  check("...and the person is still asked for theirs", evalCondition(cond(2), state.data));

  // A human's decision outranks the detector: a type already recorded stands.
  const corrected = withPartnerTypes({ data: { partner_1_name: "AL NASER GROUP", partner_1_type: "person" } as Record<string, unknown> });
  check("a recorded type is never overwritten", corrected.data.partner_1_type === "person", corrected.data);
  // And nothing else on the case is touched.
  const untouched = withPartnerTypes({ data: { company_name: "X", partner_1_name: "Valentina Mintah" } as Record<string, unknown> });
  check("only partner types are added", Object.keys(untouched.data).sort().join(",") === "company_name,partner_1_name,partner_1_type");
  check("a case with no partners is returned as it was", withPartnerTypes({ data: { a: 1 } as Record<string, unknown> }).data.a === 1);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
