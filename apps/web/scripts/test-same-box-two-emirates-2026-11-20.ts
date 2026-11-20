/**
 * BUG-212 (2026-11-20): a customer with PO Box 72002 in Dubai AND 72002 in
 * Sharjah was shown one box. The two lookups were merged on the number alone.
 *
 * Run from apps/web:  npx tsx scripts/test-same-box-two-emirates-2026-11-20.ts
 */
import { readFileSync } from "node:fs";
import { mergeCustomerPoBoxes } from "../lib/gsbLookup";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`); }
};

const dxb = { boxNumber: "72002", emirateCode: "DXB", emirateName: "Dubai", expiryDate: "2026-06-29" };
const shj = { boxNumber: "72002", emirateCode: "SHJ", emirateName: "Sharjah", expiryDate: "2027-01-10" };

{
  const out = mergeCustomerPoBoxes([dxb, shj], []);
  check("same number, two emirates, one list → two boxes", out.length === 2, out);
}
{
  const out = mergeCustomerPoBoxes([dxb], [shj]);
  check("one from each lookup → two boxes", out.length === 2, out);
  check("...Dubai kept", out.some((b) => b.emirateCode === "DXB"));
  check("...Sharjah kept", out.some((b) => b.emirateCode === "SHJ"));
}
{
  const out = mergeCustomerPoBoxes([dxb], [{ ...dxb, expiryDate: undefined, branch: "Al Jumeirah" }]);
  check("the same box from both lookups is still one", out.length === 1, out);
  check("...the first source wins", out[0]!.expiryDate === "2026-06-29");
  check("...the second fills blanks", out[0]!.branch === "Al Jumeirah");
}
{
  const out = mergeCustomerPoBoxes([dxb, shj], [{ boxNumber: "72002", branch: "x" }]);
  check("a row with no emirate joins a box rather than adding a third", out.length === 2, out);
}
{
  const out = mergeCustomerPoBoxes([{ boxNumber: "72002" }], [shj]);
  check("...and the emirate arrives from the other lookup", out.length === 1 && out[0]!.emirateCode === "SHJ", out);
}
{
  const out = mergeCustomerPoBoxes([dxb, { boxNumber: "450293", emirateCode: "DXB" }], []);
  check("different numbers stay apart", out.length === 2);
}

const conv = readFileSync(new URL("../lib/conversation.ts", import.meta.url), "utf8");
check("past-conversation boxes are keyed on number AND emirate too", /const key = `\$\{box\}\|\$\{\(emirate \?\? ""\)\.trim\(\)\.toLowerCase\(\)\}`;/.test(conv));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
