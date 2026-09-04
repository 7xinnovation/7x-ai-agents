/**
 * Internal identifiers must not reach the customer — and everything else must.
 *
 * Run from apps/web:  npx tsx scripts/test-internal-ids-2026-09-04.ts
 */
import { stripInternalIds, internalIdFilter } from "../lib/internalIds";

let pass = 0;
let fail = 0;
const eq = (name: string, got: string, want: string) => {
  if (got === want) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`); }
};

console.log("\nWhole strings");
eq("the reported leak",
  stripInternalIds("Naif Post Office (officeId: 214) confirmed. Now fetching available box numbers."),
  "Naif Post Office confirmed. Now fetching available box numbers.");
eq("two ids in one bracket",
  stripInternalIds("Naif Post Office (officeId 214, mainOfficeId 209) has boxes."),
  "Naif Post Office has boxes.");
eq("equals form", stripInternalIds("Dubai (EmirateCode=DXB) branches:"), "Dubai branches:");
eq("inline pair", stripInternalIds("Naif Post Office, officeId: 214, is open."), "Naif Post Office is open.");
eq("a real parenthetical survives",
  stripInternalIds("MyHome (delivered to your door) costs AED 695."),
  "MyHome (delivered to your door) costs AED 695.");
eq("a mixed bracket survives",
  stripInternalIds("Naif Post Office (open until 8pm, officeId 214)."),
  "Naif Post Office (open until 8pm, officeId 214).");
eq("box numbers are not ids", stripInternalIds("Box 902015 is reserved."), "Box 902015 is reserved.");
eq("prices untouched", stripInternalIds("AED 765.00 (total)"), "AED 765.00 (total)");

eq("a markdown link survives",
  stripInternalIds("Read the [Terms and Conditions](https://www.emiratespost.ae/en/terms-and-conditions) first."),
  "Read the [Terms and Conditions](https://www.emiratespost.ae/en/terms-and-conditions) first.");
eq("a map block is untouched", stripInternalIds("```map\nemirate: DXB\nbundle: MYHOME3\n```"), "```map\nemirate: DXB\nbundle: MYHOME3\n```");
eq("a cards block is untouched",
  stripInternalIds("```cards\n- title: MyBox\n  price: AED 300 / year\n  pricenote: + AED 70 one-time registration fee\n```"),
  "```cards\n- title: MyBox\n  price: AED 300 / year\n  pricenote: + AED 70 one-time registration fee\n```");
eq("a pay block keeps its url", stripInternalIds("```pay\nurl: https://paypage.sandbox.ngenius-payments.com/v2?code=abc\n```"), "```pay\nurl: https://paypage.sandbox.ngenius-payments.com/v2?code=abc\n```");

console.log("\nStreaming, split every way");
const cases: [string, string][] = [
  ["Naif Post Office (officeId: 214) confirmed.", "Naif Post Office confirmed."],
  ["MyHome (delivered to your door) is AED 695.", "MyHome (delivered to your door) is AED 695."],
  ["Branch (officeId 214) and hall (officeId 244) listed.", "Branch and hall listed."],
  ["No brackets here at all.", "No brackets here at all."],
  ["Unclosed (bracket that never closes and just keeps going", "Unclosed (bracket that never closes and just keeps going"],
  ["Read the [Terms](https://example.com/tc) first.", "Read the [Terms](https://example.com/tc) first."],
  ["```map\nemirate: DXB\nbundle: MYHOME3\n```", "```map\nemirate: DXB\nbundle: MYHOME3\n```"],
];
for (const [input, want] of cases) {
  for (const size of [1, 2, 3, 5, 13, 200]) {
    const f = internalIdFilter();
    let out = "";
    for (let i = 0; i < input.length; i += size) out += f.push(input.slice(i, i + size));
    out += f.flush();
    eq(`chunk ${size}: ${input.slice(0, 28)}…`, out, want);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
