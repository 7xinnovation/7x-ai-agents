/**
 * The sentence beside the card (2026-09-06).
 *
 * The card said AED 1,300.00 and the paragraph under it said "The confirmed
 * total from Emirates Post is AED 1,270.00" — minimumAmount, which is the box
 * before the customer added a courier to it. The card was right. Prose was the
 * one surface with no guard on it.
 *
 * Run from apps/web:
 *   npx tsx scripts/test-prose-total-2026-09-06.ts
 */
import { proseTotalGuard, correctStatedTotals } from "@/lib/proseTotal";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => {
  console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : extra ?? "");
  ok ? pass++ : fail++;
};
/** A byte at a time, because that is how it arrives. */
const run = (text: string, expected: number | null) => {
  const g = proseTotalGuard(() => expected);
  let out = "";
  for (const ch of text) out += g.push(ch);
  return out + g.flush();
};

// ── the reported sentence ───────────────────────────────────────────────────
const NOTE = "Note: the key delivery fee of AED 30 is shown in your summary. The confirmed total from Emirates Post is AED 1,270.00. Emirates Post customer service will contact you to arrange the key delivery.";
const fixed = run(NOTE, 1300);
check("the stated total becomes the real one", /AED 1,300\.00/.test(fixed), fixed);
check("...and 1,270 is gone", !/1,270/.test(fixed), fixed);
check("the line item beside it is untouched", /key delivery fee of AED 30\b/.test(fixed), fixed);
check("the rest of the sentence survives", /customer service will contact you/.test(fixed));

// ── the shapes it says it in ────────────────────────────────────────────────
check("'total is AED x'", run("Your total is AED 1270.00 today.", 1300) === "Your total is AED 1300.00 today.");
check("'you will pay AED x'", /AED 1300\.00/.test(run("You will pay AED 1270.00 on the next page.", 1300)));
check("'the amount due is AED x'", /AED 1300\.00/.test(run("The amount due is AED 1270.", 1300)));
check("commas are kept when they were there", run("Total: AED 1,270.00", 1300) === "Total: AED 1,300.00");
check("and not invented when they were not", run("Total: AED 1270.00", 1300) === "Total: AED 1300.00");

// ── what it must not touch ──────────────────────────────────────────────────
check("a right total is left exactly as written", run("Your total is AED 1,300.00.", 1300) === "Your total is AED 1,300.00.");
check("a line item is not a total", run("The registration fee is AED 70.00.", 1300) === "The registration fee is AED 70.00.");
check("a rental line is not a total", run("Box rental (5 years): AED 1,200.00", 1300) === "Box rental (5 years): AED 1,200.00");
check("an agent's rate is not a total", run("Each further agent adds AED 250.00.", 1300) === "Each further agent adds AED 250.00.");
check(
  "a figure too far from the word is left alone",
  run("Total for the year, once the branch has confirmed the paperwork and issued the key to you: AED 1270.00", 1300).includes("1270.00")
);
check("with no reservation nothing is corrected", run("Your total is AED 999.00.", null) === "Your total is AED 999.00.");
check("prose with no money in it is passed through", run("Everything looks right, shall I continue?", 1300) === "Everything looks right, shall I continue?");

// ── it is a stream, and nothing may be dropped ──────────────────────────────
const long = `${NOTE}\n\nAnd here is a second paragraph, long enough to be pushed out well before the end of the message arrives.`;
check("a long message keeps every byte", run(long, 1300).length === correctStatedTotals(long, 1300).length, run(long, 1300).length);
check("...and is corrected once, not twice", (run(long, 1300).match(/1,300\.00/g) ?? []).length === 1);
const chunky = (() => {
  const g = proseTotalGuard(() => 1300);
  let out = "";
  for (const part of ["The confirmed to", "tal from Emirates Post is A", "ED 1,270.00 today."]) out += g.push(part);
  return out + g.flush();
})();
check("a phrase split across chunks is still caught", /AED 1,300\.00/.test(chunky), chunky);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
