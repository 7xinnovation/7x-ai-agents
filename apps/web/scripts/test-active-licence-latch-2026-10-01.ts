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

console.log("\nAnd ACTIVE decides which of them it is");
const pick = route.slice(route.indexOf("const pickLicensedCompany"), route.indexOf("const latchLicensedCompany"));
check("active is preferred", /const active = licensed\.filter\(\(x\) => \/\^active\\b\/i\.test/.test(pick));
// Two LIVE licences under one trade licence is a real ambiguity and stays the
// customer's to resolve — this never guesses between them.
check("...exactly one active, or exactly one licensed", /if \(active\.length === 1\) return active\[0\]!;\s*\n\s*if \(licensed\.length === 1\) return licensed\[0\]!;/.test(pick));
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
