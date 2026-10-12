/**
 * UI polish shared by the NXN and EPGL widgets (12 October 2026): humanised
 * panel labels and values, option labels carried to the client, a phone-width
 * header, one focus ring and press, reduced motion honoured everywhere.
 * Run from apps/web: npx tsx scripts/test-ui-polish-2026-10-12.ts
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { humanizeKey, humanizeValue } from "../app/embed/[agent]/humanize";

const here = dirname(fileURLToPath(import.meta.url));
const src = (p: string) => readFileSync(resolve(here, p), "utf8");
let passed = 0, failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name}`, detail ?? ""); }
}

console.log("\nLabels and values the customer reads");
check("a raw key reads as words", humanizeKey("contact_name") === "Contact name" && humanizeKey("subscriber_first_name") === "Subscriber first name" && humanizeKey("tradeLicenseNo") === "Trade license no");
check("an enumeration value reads as words", humanizeValue("1_YEAR", "en") === "1 year" && humanizeValue("SIX_MONTHS", "en") === "Six months");
check("a short code stays itself", humanizeValue("DXB", "en") === "DXB" && humanizeValue("AUH", "ar") === "AUH" && humanizeValue("gateway", "en") === "gateway");
check("booleans read as Yes/No in the session language", humanizeValue("true", "en") === "Yes" && humanizeValue("false", "en") === "No" && humanizeValue("true", "ar") === "نعم" && humanizeValue("false", "ar") === "لا");
check("ordinary text is untouched", humanizeValue("Ahmed Al Mansoori", "en") === "Ahmed Al Mansoori" && humanizeValue("12-10-2026 13:09 UTC", "en") === "12-10-2026 13:09 UTC");

console.log("\nThe widget uses them, with the journey's own labels first");
const exp = src("../app/embed/[agent]/Experience.tsx");
check("field labels fall back to humanised keys, not raw keys", /const fieldLabel = useCallback\(\(k: string\) => labelMap\.get\(k\) \?\? humanizeKey\(k\)/.test(exp) && !/labelMap\.get\(k\) \?\? k\b/.test(exp) && !/labelMap\.get\(m\.key\) \?\? m\.key/.test(exp));
check("values show the option's label when the field has options, else the humanised value", /return optionLabels\.get\(k\)\?\.get\(raw\) \?\? humanizeValue\(raw, locale\);/.test(exp) && /\{maskForDisplay\(k, fieldValue\(k, v\)\)\}/.test(exp));
check("options reach the widget from both assemblies and the public type", /options\?: \{ value: string; label: LocalizedString \}\[\];/.test(src("../app/embed/[agent]/types.ts")) && /editable: f\.editable, options: f\.options \}\)\),/.test(src("../app/embed/[agent]/page.tsx")) && /editable: f\.editable, options: f\.options \}\)\),/.test(src("../app/api/agents/[agent]/route.ts")));

console.log("\nThe stylesheet");
const css = src("../app/globals.css");
check("chip labels never wrap", /\.dlg-chip-tag \{[^}]*white-space: nowrap;/.test(css));
check("the header fits a phone: smaller mark, tighter chips, the language chip keeps its word and drops its globe", /@media \(max-width: 599px\) \{[\s\S]{0,900}\.dlg-header-logo \{\s*height: 22px;\s*max-width: min\(96px, 100%\);/.test(css) && /\.dlg-chip\.lang > svg \{\s*display: none;/.test(css) && /\.dlg-chip\.icon-only \{\s*width: 40px;/.test(css));
check("one focus ring and one press for everything tappable, written to yield to a control's own", /\.dlg-root :where\(button, a, \[role="button"\], input, textarea, select, summary\):focus-visible \{\s*outline: 2px solid color-mix\(in srgb, var\(--c-primary\) 75%, transparent\);/.test(css) && /\.dlg-root :where\(button:not\(:disabled\), \[role="button"\]\):active \{\s*transform: translateY\(1px\);/.test(css));
check("reduced motion stills every animation and transition under the widget", /@media \(prefers-reduced-motion: reduce\) \{\s*\.dlg-root \*,\s*\.dlg-root \*::before,\s*\.dlg-root \*::after \{\s*animation-duration: 0\.01ms !important;\s*animation-iteration-count: 1 !important;\s*transition-duration: 0\.01ms !important;/.test(css));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
