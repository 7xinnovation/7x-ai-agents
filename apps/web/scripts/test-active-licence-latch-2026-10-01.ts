/**
 * Holding *a* licence is not holding *the* licence (2026-10-01).
 *
 * "This was fucking working. 0015f is the one I submitted with, which is
 * postal licence 377, and when I try again now it's not working."
 *
 * Right, and it was ours. Under trade licence 1196781 EPGL hold several
 * accounts and TWO of them carry a licence record: postal licence 377 (Active)
 * and 479 (Inactive). `latchLicensedCompany` gave up the moment the signed-in
 * account carried ANY licenseRecordId:
 *
 *   if (!c || String(c.licenseRecordId ?? "").trim()) return "";
 *
 * So landing on the inactive record meant keeping it — and a renewal addressed
 * to that record asks to give it the live company's name, which their
 * duplicate rule refuses:
 *
 *   Rolled back due to allOrNone=true: A company with the same name already
 *   exists. Please choose a different name and try again.
 *
 * The ACTIVE-first rule written for exactly this sat three lines below and was
 * never reached. Nothing about the documents and nothing about EPGL: which
 * account the conversation resolves to.
 *
 * Run from apps/web:  npx tsx scripts/test-active-licence-latch-2026-10-01.ts
 */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`); }
};
const route = readFileSync(new URL("../app/api/chat/route.ts", import.meta.url), "utf8");

console.log("\nThe lookup runs whatever the current record holds");
check("no early return on having a licence record", !/if \(!c \|\| String\(c\.licenseRecordId \?\? ""\)\.trim\(\)\) return "";/.test(route));
check("...only on having no company at all", /if \(!c\) return "";/.test(route));
check("...and still nothing to do without a trade licence", /if \(!licence\) return "";/.test(route));

console.log("\nThe real registry data this failed on");
{
  /**
   * Read from the live lookup, not invented. Two licensed records and NEITHER
   * says Active, so a rule that only knows that word refused to choose — and
   * refusing left the renewal on an account named after the applicant.
   */
  const DEAD = /^(inactive|expired|cancelled|canceled|closed|rejected|terminated|revoked|withdrawn|suspended)\b/i;
  interface Row { accountId: string; licenseRecordId?: string; licenseStatus?: string }
  const pick = (all: Row[]): Row | null => {
    const licensed = all.filter((x) => String(x.licenseRecordId ?? "").trim());
    const active = licensed.filter((x) => /^active\b/i.test(String(x.licenseStatus ?? "").trim()));
    if (active.length === 1) return active[0]!;
    const live = licensed.filter((x) => !DEAD.test(String(x.licenseStatus ?? "").trim()));
    if (live.length === 1) return live[0]!;
    if (licensed.length === 1) return licensed[0]!;
    return null;
  };
  const REGISTRY: Row[] = [
    { accountId: "0015f00000ic9okAAA", licenseRecordId: "a12FW001yuIav1YYAR", licenseStatus: "Draft" },
    { accountId: "001FW00B34EmqMWYEZ" },
    { accountId: "001NM000009zr3pYAA", licenseRecordId: "a12NM000003mE2DYAU", licenseStatus: "Inactive" },
  ];
  check("trade licence 1196781 resolves to the 377 holder", pick(REGISTRY)?.accountId === "0015f00000ic9okAAA", pick(REGISTRY));
  // The account with no licence record at all — the one named EMRE KARAYALCIN —
  // is never a candidate.
  check("...never the unlicensed record", pick(REGISTRY)?.accountId !== "001FW00B34EmqMWYEZ");
  const rows = (...r: Row[]): Row[] => r;
  check("Active still wins outright where one says Active", pick(rows(
    { accountId: "A", licenseRecordId: "1", licenseStatus: "Active" },
    { accountId: "B", licenseRecordId: "2", licenseStatus: "Draft" },
  ))?.accountId === "A");
  check("two live licences stay ambiguous", pick(rows(
    { accountId: "A", licenseRecordId: "1", licenseStatus: "Draft" },
    { accountId: "B", licenseRecordId: "2", licenseStatus: "Submitted" },
  )) === null);
  check("...and two ACTIVE ones too", pick(rows(
    { accountId: "A", licenseRecordId: "1", licenseStatus: "Active" },
    { accountId: "B", licenseRecordId: "2", licenseStatus: "Active" },
  )) === null);
  check("a lone licensed record is used whatever it says", pick(rows(
    { accountId: "A", licenseRecordId: "1", licenseStatus: "Inactive" },
  ))?.accountId === "A");
  check("no licensed record, no pick", pick(rows({ accountId: "A" })) === null);
}

console.log("\nAnd ACTIVE decides which of them it is");
const pick = route.slice(route.indexOf("const pickLicensedCompany"), route.indexOf("const latchLicensedCompany"));
check("active is preferred", /const active = licensed\.filter\(\(x\) => \/\^active\\b\/i\.test/.test(pick));
// Two LIVE licences under one trade licence is a real ambiguity and stays the
// customer's to resolve — this never guesses between them.
check("...then the one that is not finished", /const live = licensed\.filter\(\(x\) => !DEAD_LICENCE\.test/.test(pick));
// Inverted rather than extended: the words that mean "live" are theirs to grow
// and ours to be surprised by; the handful that mean "over" is small and stable.
check("...ruling out by what is over, not in by what is live", /const DEAD_LICENCE = \/\^\(inactive\|expired\|cancelled/.test(route));
check("...otherwise nothing is latched", /return null;/.test(pick));

console.log("\nThe move is only ever to a different account");
check("same account is a no-op", /if \(!pick \|\| pick\.accountId === c\.accountId\) return "";/.test(route));
check("...and it is recorded", /action: "epgl_account_redirected_to_licensed"/.test(route));
check("...with both ids in the audit", /was: c\.accountId \?\? null,\s*\n\s*now: licensed\[0\]!\.accountId \?\? null,/.test(route));

console.log("\nAnd the note says what is true now");
// The old wording claimed the sign-in's record held no licence. It may hold a
// lapsed one, which is the case that broke this.
check("a lapsed licence is described as one", /it may hold none, or hold a lapsed one/.test(route));
check("...and it is not presented to the customer as a fault", /do not describe this to the customer as a problem/.test(route));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
