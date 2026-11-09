/**
 * "A blue border text box shows up once I click on the agent text box"
 * (Emirates Post, 9 November 2026). The every-control focus ring applied to the
 * composer's field, which a text field shows on a click too; the composer
 * already rings the whole bar.
 *
 * Run from apps/web:  npx tsx scripts/test-composer-focus-2026-11-09.ts
 */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean) => {
  console.log(ok ? `PASS ${l}` : `FAIL ${l}`);
  ok ? pass++ : fail++;
};
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
check("the composer field draws no ring of its own", /\.dlg-input textarea:focus-visible \{\s*outline: none;/.test(css));
check("...and it outranks the every-control rule (comes after it)",
  css.indexOf(".dlg-input textarea:focus-visible") > css.indexOf(".dlg-root :where(button, a, [role=\"button\"], input, textarea, select, summary):focus-visible"));
check("the bar still shows focus", /\.dlg-input:focus-within \{/.test(css));
check("every other control keeps its focus ring",
  /\.dlg-root :where\(button, a, \[role="button"\], input, textarea, select, summary\):focus-visible \{\s*outline: 2px solid/.test(css));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
