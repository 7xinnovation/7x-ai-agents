/**
 * The Day 2 items from the 8 September bug log that were still open.
 *
 * Run from apps/web:  npx tsx scripts/test-buglist-day2-2026-09-09.ts
 */
export {};

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, got?: unknown) {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`); }
}

const { readFileSync } = await import("node:fs");
const exp = readFileSync(new URL("../app/embed/[agent]/Experience.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/chat/route.ts", import.meta.url), "utf8");
const field = readFileSync(new URL("../app/api/case/field/route.ts", import.meta.url), "utf8");

console.log("\n#6 — the source chips say what they are");
check("a label is rendered", /dlg-sources-label/.test(exp));
check("...from the existing translated string", /\{t\.sources\}/.test(exp));
check("the chips carry a tooltip too", /title=\{t\.sources\}/.test(exp));
check("and the label has a style", /\.dlg-sources-label \{/.test(css));

console.log("\n#2 — Recent Activity reads like a sentence");
check("the raw-reference example is called out", /NXN-B295AF15/.test(route));
check("...with what it should say instead", /You added an authorised agent to box/.test(route));
check("the reference is kept, at the end", /put it at the end in brackets, never at the front/.test(route));

console.log("\n#13 — a settled case cannot be edited");
check("the panel stops offering pencils", /const settled =[\s\S]{0,200}?if \(settled\) return set;/.test(exp));
check("...on submission", /caseState\?\.status === "submitted"/.test(exp));
check("...and on payment", /caseState\?\.payment\?\.status === "paid"/.test(exp));
check("it re-evaluates when either changes", /caseState\?\.status, caseState\?\.payment\?\.status\]/.test(exp));
check("THE SERVER enforces it too", /case_already_settled/.test(field));
check("...because hiding a control is not enforcing a rule", /hiding a control is not enforcing a rule/.test(field));
check("a pre-submission correction still works", /A correction before submission is the point of the pencil/.test(exp));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
