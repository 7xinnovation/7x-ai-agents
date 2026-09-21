/**
 * Our own filing system, cited at the customer (EPGL widget, 21 September).
 *
 *   "Internal source references (e.g. 'EPGL Agentic AI KB §4', 'EPGL Licensing
 *    Guide §7/§1') are displayed to the end user in the chat. A similar issue
 *    was raised on the website agent as well."
 *
 * These are the names WE gave the knowledge documents. An applicant cannot open
 * either, so the citation is noise at best and an invitation to ask for a
 * document that is not theirs to read at worst. The answer is the answer.
 *
 * Run from apps/web:  npx tsx scripts/test-source-refs-2026-09-21.ts
 */
import { stripInternalIds } from "../lib/internalIds";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : ` — ${JSON.stringify(got)}`}`); }
};

console.log("\nThe two forms that were reported");
{
  const a = stripInternalIds("The renewal fee is AED 100,700 (EPGL Agentic AI KB §4).");
  check("a bracketed citation goes", a === "The renewal fee is AED 100,700.", a);
  const b = stripInternalIds("Per EPGL Licensing Guide §7/§1, the AFS is required.");
  check("an announced one goes, sentence intact", b === "The AFS is required.", b);
}

console.log("\nThe other shapes it turns up in");
for (const [inp, want] of [
  ["You need Form 9 (see EPGL Licensing Guide §7).", "You need Form 9."],
  ["The fee is AED 100,700 EPGL Agentic AI KB §4 and covers one year.", "The fee is AED 100,700 and covers one year."],
  ["Renewals run annually §3.", "Renewals run annually."],
  ["Reference: EPGL Knowledge Base §2, the licence lasts a year.", "The licence lasts a year."],
  ["(EPGL Licensing Guide §7/§1)", ""],
] as const) {
  const out = stripInternalIds(inp);
  check(JSON.stringify(inp.slice(0, 46)), out === want, { out, want });
}

console.log("\nWhat it must never touch");
for (const t of [
  "Your licence expires on 18-09-2026.",
  "The company is ECONOMIC ADVANTAGE INFORMATION TECHNOLOGY CONSULTANTS.",
  "Box 450367 (MyHome Flex, Al Barsha) is yours.",
  "Total: AED 100,700.00",
  "The renewal fee is AED 100,700 and covers twelve months.",
  "Postal activities: Letters & Post Items Delivery, Documents Delivery.",
  "Your reference is LR-37533 — quote it if you call.",
  "Guide price is AED 300 a year.",
  "أنشطة بريدية: تسليم الرسائل والبريد.",
]) check(JSON.stringify(t.slice(0, 50)), stripInternalIds(t) === t, stripInternalIds(t));

console.log("\nA number is never part of a document's name");
// "AED 100,700 EPGL Agentic AI KB §4" once matched from the 700 onwards and
// produced "AED 100,and covers one year."
for (const t of ["AED 100,700 EPGL Agentic AI KB §4 applies.", "12 EPGL Licensing Guide §1 applies."]) {
  const out = stripInternalIds(t);
  check(`the figure survives: ${JSON.stringify(t.slice(0, 34))}`, /100,700|^12 /.test(out), out);
}

console.log("\nAnd the internal ids it was already removing still go");
for (const [inp, want] of [
  ["Naif Post Office (officeId: 214) confirmed.", "Naif Post Office confirmed."],
  ["I could not hold that box (ERROR_GETTING_RATE_TYPE_DETAILS).", "I could not hold that box."],
] as const) {
  const out = stripInternalIds(inp);
  check(JSON.stringify(inp.slice(0, 40)), out === want, { out, want });
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
