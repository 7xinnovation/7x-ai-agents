/**
 * «سأجلب» reads as physically fetching something (Emirates Post, 21 September).
 *
 * Their Arabic reviewer, having read the live transcripts:
 *
 *   «سأعرض»  best for the customer — it says the numbers will be displayed
 *   «سأتحقق»  correct, but describes CHECKING availability, not presenting it
 *   «سأسترجع» technically accurate, sounds like a system talking
 *   «سأجلب»   correct, least natural — reads as physically bringing something
 *
 * Two different places, two different verbs, and the distinction is theirs: the
 * assistant's own sentence is presenting, so it shows; the status line beside a
 * tool round appears WHILE the lookup runs, so it checks.
 *
 * Run from apps/web:  npx tsx scripts/test-arabic-verbs-2026-09-21.ts
 */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : ` — ${JSON.stringify(got)}`}`); }
};
const exp = readFileSync(new URL("../app/embed/[agent]/Experience.tsx", import.meta.url), "utf8");
const prompt = readFileSync(new URL("../../../packages/core/src/ai/prompt.ts", import.meta.url), "utf8");

/** Just the status labels, so a «جلب» in a comment is not mistaken for copy. */
const labels = exp.slice(exp.indexOf("function toolStatusLabel"), exp.indexOf("* In-chat secure payment card"));
const arabic = [...labels.matchAll(/"([؀-ۿ][^"]*)"/g)].map((m) => m[1]!);

console.log("\nThe status line, which appears while the lookup is still running");
check("there are Arabic labels to check", arabic.length >= 5, arabic.length);
check("none of them says «جلب»", !arabic.some((s) => s.includes("جلب")), arabic.filter((s) => s.includes("جلب")));
check("they say «التحقق» — checking, which is what is happening", arabic.filter((s) => s.includes("التحقق")).length >= 4, arabic);
// Tracking a shipment is genuinely tracking, and the working line is generic.
check("...without rewriting the ones that were already right", arabic.some((s) => s.includes("تتبّع")) && arabic.some((s) => s.includes("جارٍ العمل على طلبك")), arabic);
check("every label is still a progress form", arabic.filter((s) => s.startsWith("جارٍ")).length >= 6, arabic);

console.log("\nThe assistant's own sentence, which IS presenting");
check("the rule is in the prompt", /ARABIC VERBS FOR SHOWING SOMETHING/.test(prompt));
check("it asks for «سأعرض لك»", /سأعرض لك/.test(prompt));
check("...and says not to use «سأجلب» for it", /Do NOT use «سأجلب»/.test(prompt));
check("...and keeps «سأتحقق» for a real check", /«سأتحقق»/.test(prompt));
check("...and explains why «سأسترجع» is not it either", /«سأسترجع»/.test(prompt));
check("the reason is recorded, not just the instruction", /physically fetching something/.test(prompt));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
