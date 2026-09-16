/**
 * "No Data Found" is an answer, not an error.
 *
 * Reported 16 September on a renewal: "The registry lookup hit an error just
 * now, so I can't fetch your licences automatically" — and the registry had
 * answered, promptly and correctly, with status 102: No Data Found. That Emirates
 * ID simply has nothing against it in the Ministry of Economy registry, which is
 * ordinary: a licence held through a partner, or issued by another emirate's
 * authority, does not appear there.
 *
 * The two readings send the conversation to different places. A failure means
 * try again later. An answer means the licence is held some other way, and the
 * thing to do is ask for it — AND offer the box to upload it, which is the other
 * half of the same report: "no option to upload, I have to ask it to give me the
 * document".
 *
 * Run from apps/web:  npx tsx scripts/test-registry-no-data-2026-09-16.ts
 */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : `\n         ${JSON.stringify(got)}`}`); }
};

const moe = readFileSync(new URL("../lib/moeLicences.ts", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/chat/route.ts", import.meta.url), "utf8");

console.log("\nThe registry's own verdict is read as a verdict");
check("102 is recognised as 'nothing on file'", /const NO_DATA_STATUS = new Set\(\["102"\]\)/.test(moe));
check("...and returns rather than throwing", /if \(r\.statusCode && NO_DATA_STATUS\.has\(r\.statusCode\)\) return;/.test(moe));
// The caution that surrounds this must survive: any OTHER non-success code with
// nothing returned is still a refusal, because "you own no companies" is the one
// thing a customer must never be told on a registry that did not answer.
check("every other refusal still throws", /!SUCCESS_STATUS\.has\(r\.statusCode\) && !r\.licences\.length/.test(moe));
check("...and a shape change is still a failure", /in a shape this parser does not recognise/.test(moe));
check("100 and 101 are still the successes", /SUCCESS_STATUS = new Set\(\["100", "101"\]\)/.test(moe));

console.log("\nAn empty answer offers both ways to continue");
{
  const at = route.indexOf("NOTHING IS REGISTERED to that Emirates ID");
  const block = route.slice(Math.max(0, at - 800), at + 900);
  check("the empty answer exists", at > 0);
  check("it does not claim a failure", /do not say the lookup failed/i.test(block), block.slice(0, 200));
  check("it offers the number OR the document", /BOTH ways to continue/.test(block));
  check("...with a real upload block", /upload with key: \$\{docKey\}/.test(block));
  check("...keyed to the journey in play", /renew.*\? "updated_trade_license" : "trade_license"/.test(block));
}

console.log("\nAnd a genuine failure does the same rather than dead-ending");
{
  const at = route.indexOf("moe_licence_lookup_failed");
  const block = route.slice(at, at + 2400);
  check("a lookup failure still says nothing about their licence", /says nothing about whether the customer holds a licence/.test(block));
  check("...and now offers the upload too", /BOTH ways to continue/.test(block) && /upload with key: \$\{docKey\}/.test(block));
  // A daily cap is not a fault, and a customer told "something went wrong" about
  // a quota is being told the wrong thing.
  check("a daily cap is named as a cap", /HIT ITS DAILY LIMIT/.test(block));
  check("...detected from the gateway's own words", /Maximum number of allowed invocations/.test(block));
  check("...and never explained to the customer in technical terms", /without technical detail/.test(block));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
