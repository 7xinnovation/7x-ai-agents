/**
 * Arabic conversations were showing English in the parts WE write.
 *
 * Reported 9 September: the "Total" row on a summary, "(UAE time)" on the hold
 * deadline, the sentence sent back on the customer's behalf after paying, the
 * enquiry link going to the English page, and toggles whose thumb slid the wrong
 * way. All of these are ours — none is the model choosing a language.
 *
 * Run from apps/web:  npx tsx scripts/test-arabic-strings-2026-09-09.ts
 */
import { arabicLinks, linkGuard } from "../lib/locateGuard";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, got?: unknown) {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`); }
}

const { readFileSync } = await import("node:fs");
const md = readFileSync(new URL("../app/embed/[agent]/Markdown.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const intg = readFileSync(new URL("../lib/integrations.ts", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/chat/route.ts", import.meta.url), "utf8");

console.log("\nThe enquiry link follows the conversation");
check("an Arabic reply gets the Arabic page", arabicLinks("See https://www.emiratespost.ae/contact-us/raise-an-enquiry", "ar").includes("/ar/contact-us/raise-an-enquiry"));
check("an English reply is untouched", arabicLinks("See https://www.emiratespost.ae/contact-us/raise-an-enquiry", "en").includes("emiratespost.ae/contact-us/raise-an-enquiry"));
check("...and does not gain /ar/", !arabicLinks("https://www.emiratespost.ae/contact-us/raise-an-enquiry", "en").includes("/ar/"));
check("the FAQ moves with it", arabicLinks("https://www.emiratespost.ae/faq", "ar") === "https://www.emiratespost.ae/ar/faq");
check("an already-Arabic link is left alone", arabicLinks("https://www.emiratespost.ae/ar/faq", "ar") === "https://www.emiratespost.ae/ar/faq");

console.log("\n...even when the URL is split across the stream");
{
  const text = "لديك سؤال؟ https://www.emiratespost.ae/contact-us/raise-an-enquiry — تفضل.";
  const run = (size: number) => {
    const g = linkGuard("ar");
    let out = "";
    for (let i = 0; i < text.length; i += size) out += g.push(text.slice(i, i + size));
    return out + g.flush();
  };
  for (const size of [1, 3, 7, 40, 999]) {
    check(`chunked every ${size} chars`, run(size).includes("/ar/contact-us/raise-an-enquiry"), run(size).slice(0, 90));
  }
  check("nothing is lost in the process", run(5).includes("تفضل"));
}
{
  const g = linkGuard("en");
  check("English streams through untouched", g.push("abc") + g.flush() === "abc");
}

console.log("\nStrings we write ourselves");
check('"Total" has an Arabic form', /lang === "ar" \? "الإجمالي" : "Total"/.test(md));
check('"UAE time" has an Arabic form', /بتوقيت الإمارات/.test(intg));
check("the post-payment message has an Arabic form", /لقد أتممت الدفع على صفحة بريد الإمارات/.test(md));
check("...and is chosen by locale, not hard-coded", /PAID_BACK\[locale === "ar" \? "ar" : "en"\]/.test(md));
check("the pay block is given the locale", /<ChatPay[^>]*locale=\{lang\}/.test(md));

console.log("\nThe toggle travels the right way in Arabic");
check("there is an RTL rule", /\[dir="rtl"\] \.dlg-toggle\.is-on \.dlg-toggle-thumb/.test(css));
check("...and it moves the other way", /\[dir="rtl"\][\s\S]{0,120}?translateX\(-17px\)/.test(css));
check("the LTR behaviour is unchanged", /\.dlg-toggle\.is-on \.dlg-toggle-thumb \{\s*transform: translateX\(17px\);/.test(css));

console.log("\nWired into the turn");
check("the link guard runs on the stream", /const links = linkGuard\(body\.locale\)/.test(route));
check("...and is flushed at the end", /links\.flush\(\)/.test(route));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
