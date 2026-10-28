/**
 * What the assistant asks for, and how many things at once (28 October 2026).
 *
 * Three findings from one run through the new-licence journey:
 *
 *  1. Told the company we guessed was not theirs, it asked "What's the trade
 *     licence number for the company you're applying for?" — a typed number
 *     from someone holding the document it is printed on, which would have
 *     filled fifteen fields.
 *  2. A reply listed the three documents still needed, then asked "What's the
 *     maximum shipment weight you'll be carrying (in kg)?", with a file picker
 *     underneath. Two different asks, one message, and whichever is answered
 *     the other is left hanging.
 *  3. The product badges carry three eligibility classes and wrap to three
 *     lines inside a pill with 2.5px of vertical padding.
 *
 * Run from apps/web:  npx tsx scripts/test-epgl-ask-shape-2026-10-28.ts
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => { console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : extra ?? ""); ok ? pass++ : fail++; };
const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(resolve(here, p), "utf8");
const route = read("../app/api/chat/route.ts");
const prompt = read("../../../packages/core/src/ai/prompt.ts");
const css = read("../app/globals.css");

// ---- 1. the fallback is the document, not the number ------------------------
check("there is one sentence for it, not three copies",
  (route.match(/const ASK_FOR_THE_LICENCE_DOCUMENT =/g) ?? []).length === 1);
check("it refuses the typed number first", /do NOT ask the customer to type a trade licence number/.test(route));
check("...and asks for the licence itself instead", /ask them to upload the trade licence itself/.test(route));
check("...and emits the block, so there is something to press",
  /emit the upload block for trade_license in that same reply/.test(route));
check("...naming the journey's real slot key", /trade_license\b/.test(route));
check("a typed number is still allowed when they cannot upload",
  /Only if they say they cannot upload it should you take the number as text/.test(route));
check("the company-is-not-ours branch uses it", (() => {
  const i = route.indexOf("If they say it is a different company");
  return i !== -1 && route.slice(i, i + 900).includes("ASK_FOR_THE_LICENCE_DOCUMENT");
})());
check("...and still looks the company up once the number is known", (() => {
  const i = route.indexOf("If they say it is a different company");
  return i !== -1 && route.slice(i, i + 1100).includes("COMPANY_TOOL");
})());
check("the no-company-on-the-login branch uses it", (() => {
  const i = route.indexOf("their login is not linked to a company record");
  return i !== -1 && route.slice(i, i + 300).includes("ASK_FOR_THE_LICENCE_DOCUMENT");
})());
check("the registry-found-nothing branch uses it", (() => {
  const i = route.indexOf("nothing is registered to that ID");
  return i !== -1 && route.slice(i, i + 200).includes("ASK_FOR_THE_LICENCE_DOCUMENT");
})());
check("no branch still ends on 'ask for the trade licence number'",
  !/ask for the trade licence number as (normal|usual)/.test(route));
check("the reason is written down where the next person will look",
  /fifteen fields on this journey/.test(route) && /The typed\s*\n\s+\* number yields one/.test(route));

// ---- 2. one ask per message --------------------------------------------------
const rule = prompt.slice(prompt.indexOf("- ONE ASK PER MESSAGE"), prompt.indexOf("- If a document was rejected"));
check("the rule is no longer only about confirmations",
  /not a confirmation, not a question of your own/.test(rule));
check("...and a document counts as an ask", /A DOCUMENT IS AN ASK/.test(rule));
check("the run that prompted it is quoted, so the rule is not abstract",
  /maximum shipment weight you'll be carrying \(in kg\)/.test(rule));
check("...including what it leaves the customer with", /the other is left hanging/.test(rule));
check("a step holding both fields and documents is named as the common case",
  /a step that holds both fields and documents/.test(rule));
check("...and is explicitly not the customer's problem", /the step's shape is not the customer's problem/.test(rule));
check("it says which one to keep and where the other goes",
  /Pick ONE/.test(rule) && /put the other in your next message/.test(rule));
check("the original confirmation case survives in it",
  /Does this look right\?/.test(rule) && /Yes\/No buttons AND a file picker/.test(rule));

// ---- 3. the badge ------------------------------------------------------------
const badge = css.slice(css.indexOf(".dlg-card-opt-badge {"), css.indexOf(".dlg-card-opt-badge.is-selected"));
check("the badge has room top and bottom", /padding: 4px 10px;/.test(badge));
check("...and is no longer a pill a wrapped line curves into", /border-radius: 10px;/.test(badge));
check("...with leading set for the lines it wraps to", /line-height: 1\.4;/.test(badge));
check("...and wrapped text starts at the edge it should", /text-align: start;/.test(badge));
check("the pill radius variable is gone from this rule", !/var\(--r-pill\)/.test(badge));
check("the colours are untouched", /color-mix\(in srgb, var\(--c-primary\) 10%, var\(--c-surface\)\)/.test(badge));
check("the selected state still overrides them", /\.dlg-card-opt-badge\.is-selected \{\n\s+color: var\(--c-primary-fg\);/.test(css));
check("why it changed is recorded next to it", /UAE-NATIONAL-OWNED SME \/ NON-UAE SME \//.test(badge));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
