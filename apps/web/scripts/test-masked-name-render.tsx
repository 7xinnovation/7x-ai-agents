/**
 * Regression: a masked holder name must survive rendering intact.
 *
 * Guest results star out the holder (FB-1323: "M******* A** ******b"). Those
 * runs of asterisks were being eaten by the markdown emphasis parser, so the
 * customer saw a mangled name — "M***** A ******b" — and could no longer
 * recognise it as their own. Reported from production 2026-08-11.
 *
 * Run from apps/web:  npx tsx scripts/test-masked-name-render.tsx
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "../app/embed/[agent]/Markdown";
import { maskName } from "../lib/pii";

const strip = (h: string) => h.replace(/<[^>]+>/g, "");
const render = (t: string) => strip(renderToStaticMarkup(<Markdown text={t} />));
let fail = 0;
const check = (name: string, got: string, want: string) => {
  const ok = got === want;
  if (!ok) fail++;
  console.log(` ${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n        got  "${got}"\n        want "${want}"`}`);
};

for (const real of ["Omar Abdulla Cassim Ali AlCarim", "Mohammed Ali Alhabib", "Ahmed Al Mansoori", "Fatima"]) {
  const m = maskName(real);
  check(`mask survives in prose: ${real}`, render(`held by ${m}?`), `held by ${m}?`);
  check(`mask survives mid-sentence: ${real}`, render(`Box 2500, held by ${m}, expires soon.`), `Box 2500, held by ${m}, expires soon.`);
}
// Ordinary markdown must be unaffected by the fix.
check("bold still works", render("a **bold** b"), "a bold b");
check("italic still works", render("a *ital* b"), "a ital b");
check("bold after a mask", render("A*** and **bold**"), "A*** and bold");
check("mask after bold", render("**bold** and A***"), "bold and A***");
check("two bolds still pair correctly", render("**one** then **two**"), "one then two");

console.log(fail ? `\n${fail} FAILED` : `\nAll masked-name render checks passed.`);
process.exit(fail ? 1 : 0);
