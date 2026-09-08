/**
 * The widget opens in the language the page is already in.
 *
 * Both sites serve Arabic from their own URLs with <html lang="ar">, so the
 * reader has already chosen a language by the time the loader runs. Asking the
 * host to also set data-locale is asking them to keep two things in step, and
 * one of them will drift.
 *
 * Run from apps/web:  npx tsx scripts/test-embed-locale-2026-09-08.ts
 */
export {};

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, got?: unknown) {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`); }
}

const { readFileSync } = await import("node:fs");
const src = readFileSync(new URL("../../../packages/embed/src/index.ts", import.meta.url), "utf8");

// The loader is a browser module; lift the resolver out and run it against a
// stubbed document rather than booting a DOM.
const body = /function pickLocale\(explicit: string \| undefined\): string \{([\s\S]*?)\n\}/.exec(src)?.[1];
if (!body) throw new Error("pickLocale not found — has it been renamed?");
const LOCALES = ["en", "ar"];
const make = (lang: string | null) => {
  const document = { documentElement: { getAttribute: (n: string) => (n === "lang" ? lang : null) } };
  const js = body.replace(/\s+as\s+readonly string\[\]/g, "").replace(/!/g, "").replace(/\?\?\s*""/g, '|| ""');
  return new Function("explicit", "document", "LOCALES", js) as (e: string | undefined, d: unknown, l: string[]) => string;
};
const pick = (explicit: string | undefined, lang: string | null) => make(lang)(explicit, { documentElement: { getAttribute: (n: string) => (n === "lang" ? lang : null) } }, LOCALES);

console.log("\nThe page decides when the host says nothing");
check('lang="ar" opens in Arabic', pick(undefined, "ar") === "ar", pick(undefined, "ar"));
check('lang="en" opens in English', pick(undefined, "en") === "en", pick(undefined, "en"));
check('lang="ar-AE" is Arabic', pick(undefined, "ar-AE") === "ar", pick(undefined, "ar-AE"));
check('lang="en-GB" is English', pick(undefined, "en-GB") === "en", pick(undefined, "en-GB"));
check('lang="AR" is Arabic — case does not matter', pick(undefined, "AR") === "ar", pick(undefined, "AR"));
check('lang="ar_AE" with an underscore still works', pick(undefined, "ar_AE") === "ar", pick(undefined, "ar_AE"));
check("whitespace is trimmed", pick(undefined, "  ar  ") === "ar", pick(undefined, "  ar  "));

console.log("\nAn explicit data-locale still wins");
check("data-locale=ar on an English page", pick("ar", "en") === "ar", pick("ar", "en"));
check("data-locale=en on an Arabic page", pick("en", "ar") === "en", pick("en", "ar"));

console.log("\nAnything unusable falls back to English, never to nothing");
check("no lang attribute at all", pick(undefined, null) === "en", pick(undefined, null));
check("an empty lang", pick(undefined, "") === "en", pick(undefined, ""));
check("a language we do not have", pick(undefined, "fr") === "en", pick(undefined, "fr"));
check("a language we do not have, regional", pick(undefined, "de-DE") === "en", pick(undefined, "de-DE"));
check("junk", pick(undefined, "!!") === "en", pick(undefined, "!!"));

console.log("\nAnd it is actually wired in");
check("readConfig uses it", /locale: pickLocale\(d\.locale\)/.test(src));
check("the iframe carries the locale it picked", /locale=\$\{cfg\.locale\}/.test(src));
check("the documented default is described", /data-locale is optional/.test(src));

console.log("\nA language switch that does not reload the page");
{
  const exp = readFileSync(new URL("../app/embed/[agent]/Experience.tsx", import.meta.url), "utf8");
  check("the loader watches <html lang>", /attributeFilter: \["lang"\]/.test(src));
  check("it tells the panel rather than reloading it", /action: "locale", locale: next/.test(src));
  check("it targets the app's own origin, not '*'", /new URL\(cfg\.host\)\.origin/.test(src));
  check("a pinned data-locale is not overridden by the page", /readConfig\(\)\.locale !== next/.test(src));
  check("src is only rewritten while nothing is open", /mode === "closed" && !opened/.test(src));
  check("opening the panel marks it unsafe to reload", /if \(next !== "closed"\) opened = true/.test(src));
  check("the app applies the locale it is sent", /m\.action === "locale"[\s\S]{0,120}?setLocale\(m\.locale\)/.test(exp));
  check("...and only for a locale it has", /m\.locale === "en" \|\| m\.locale === "ar"/.test(exp));
  check("a token still requires a permitted origin", /typeof m\.uaePassToken !== "string"\) return;\s*if \(!permitted\.has\(e\.origin\)\) return;/.test(exp));
}

console.log("\nThe panel does not fight its own stylesheet");
check("fit() knows the CSS breakpoint", /const COMPACT = "\(max-width:640px\),\(max-height:520px\)"/.test(src));
check("...and it is the same one the CSS uses", /@media \(max-width:640px\),\(max-height:520px\)/.test(src));
check("inline sizing is cleared when the CSS goes full-bleed", /matchMedia\(COMPACT\)\.matches\) \{\s*clearSize\(\)/.test(src));
check("the size is written with important", /setProperty\(prop, `\$\{px\}px`, "important"\)/.test(src));
check("there is a diagnose() for when it still does not fit", /dlg\.diagnose = diagnose/.test(src));
check("...which names a transformed ancestor breaking position:fixed", /fixedPositioningBrokenBy/.test(src));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
