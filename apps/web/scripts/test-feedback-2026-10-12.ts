/**
 * Post Live Feedback Round — what 12 October 2026 changed, checked.
 *
 * FB-1889 the assistant is Mira; FB-1803 enquiries stay in the chat; FB-1831 a
 * ready prompt for the two-step renewal; FB-1710 the PO Box FAQ in the knowledge
 * base. Static checks over the repository and the scripts' own exports; the
 * database scripts are exercised on fixtures, not on a database.
 *
 * Run from apps/web:  npx tsx scripts/test-feedback-2026-10-12.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renameText, renameDefinition } from "./rename-aisha-to-mira-2026-10-12";
import { applyFeedback, rewriteChunk, GREETING, READY_PROMPTS, ENQUIRY_MARKER, JOURNEY_NEW, JOURNEY_OLD } from "./nxn-post-live-feedback-2026-10-12";
import { EN, AR, faqFor } from "./add-nxn-pobox-faq-kb-2026-10-12";
import { enquiriesStayInChat, linkGuard } from "../lib/locateGuard";

const here = dirname(fileURLToPath(import.meta.url));
const src = (p: string) => readFileSync(resolve(here, p), "utf8");
let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${n}${ok ? "" : " — got: " + JSON.stringify(got)?.slice(0, 200)}`);
};

console.log("\nFB-1889 — Mira");
check("whole-word rename, both scripts and the Arabic", renameText("Hello, I'm Aisha. AISHA عائشة Aishas") === "Hello, I'm Mira. MIRA ميره Aishas");
{
  const { def, changes } = renameDefinition({ name: "EPGL Dialog", greeting: { en: "Hello, I'm Aisha.", ar: "مرحباً، أنا عائشة." }, persona: "You are Aisha.", journeys: [{ key: "x", guidance: "Aisha says", title: { en: "t", ar: "t" } }] });
  check("the greeting, persona and guidance are renamed; the deployment name is not", def.greeting.en === "Hello, I'm Mira." && def.greeting.ar === "مرحباً، أنا ميره." && def.persona === "You are Mira." && def.journeys[0].guidance === "Mira says" && def.name === "EPGL Dialog" && changes.length === 4, changes);
}
const exp = src("../app/embed/[agent]/Experience.tsx");
check("the header shows the Mira wordmark", /src="\/mira-onlight\.svg" alt="Mira"/.test(exp) && !/aisha-onlight/.test(exp) && /const MIRA_BLUE/.test(exp));
check("both wordmarks exist and carry the Arabic name", existsSync(resolve(here, "../public/mira-onlight.svg")) && existsSync(resolve(here, "../public/mira-ondark.svg")) && /ميره/.test(src("../public/mira-onlight.svg")));
check("the voice is Mira too", /You are Mira, the spoken voice/.test(src("../app/api/nxn/voice/speak/route.ts")));
check("the 30 September seed script seeds the current name", /const NEW_NAME = \{ en: "Mira", ar: "ميره" \}/.test(src("./epgl-aisha-and-renewal-docs-2026-09-30.ts")));

console.log("\nFB-1803 — enquiries stay in the chat");
{
  const persona = "Intro.\n\nCALLBACKS AND ENQUIRIES — when the customer asks for a callback, give them Emirates Post's enquiry form: [Raise an enquiry](https://www.emiratespost.ae/contact-us/raise-an-enquiry). Say plainly that it opens Emirates Post's own enquiry page and that the team replies from there. Offer the link INSTEAD of claiming to have arranged the callback yourself. Before handing it over, try once to actually answer them: most \"I want to speak to someone\" comes after something went wrong that you can still fix.\n\nOutro.";
  const { def, changes } = applyFeedback({ persona, greeting: { en: "Welcome", ar: "مرحباً" }, journeys: [{ key: "personal_po_box_renewal", guidance: `Before. ${JOURNEY_OLD} Never link to www-stg.` }] });
  check("the persona's enquiry paragraph is replaced whole, intro and outro kept", def.persona.startsWith("Intro.") && def.persona.includes("Outro.") && def.persona.includes(ENQUIRY_MARKER) && !/emiratespost\.ae\/(?:ar\/)?contact-us/.test(def.persona) && !/CALLBACKS AND ENQUIRIES —/.test(def.persona), def.persona.slice(0, 300));
  check("...and the greeting-button paragraph is added once", (def.persona.match(/THE GREETING BUTTONS \(FB-1831/g) ?? []).length === 1);
  check("the journey sentence is rewritten and nothing else moves", def.journeys[0].guidance === `Before. ${JOURNEY_NEW} Never link to www-stg.`, def.journeys[0].guidance);
  check("the greeting introduces Mira with the four service buttons, in both languages", def.greeting.en === GREETING.en && def.greeting.ar === GREETING.ar && /```buttons\n- Rent a new PO Box\n- Renew my PO Box\n- Manage my PO Box\n- Ask a question\n```/.test(GREETING.en) && /أنا ميره/.test(GREETING.ar));
  check("the ready prompt is set", JSON.stringify(def.readyPrompts) === JSON.stringify(READY_PROMPTS));
  const again = applyFeedback(def);
  check("idempotent: a second pass changes nothing", again.changes.length === 0, again.changes);
  check("the first pass reports every change", changes.length === 6, changes);
  const reworded = applyFeedback({ ...def, persona: def.persona.replace("an email address only if they offer one", "an email address") });
  check("a reworded enquiry paragraph is re-applied in place, once", reworded.changes.length === 1 && reworded.changes[0] === "persona: enquiry paragraph reworded" && reworded.def.persona.includes("an email address only if they offer one, never asked for a second time") && (reworded.def.persona.match(/ENQUIRIES, COMPLAINTS AND CALLBACKS ARE TAKEN HERE/g) ?? []).length === 1, reworded.changes);
}
check("knowledge-base sentences that quoted the page now point at the chat", !/raise-an-enquiry/.test(rewriteChunk("For that, raise an enquiry at https://www.emiratespost.ae/contact-us/raise-an-enquiry or call 600 599 999.", "en")) && !/raise-an-enquiry/.test(rewriteChunk("يُرجى رفع استفسار عبر https://www.emiratespost.ae/ar/contact-us/raise-an-enquiry أو الاتصال على 600 599 999.", "ar")) && /here in the chat/.test(rewriteChunk("raise an enquiry at https://www.emiratespost.ae/contact-us/raise-an-enquiry", "en")));
check("the corporate chunk's AED 25 becomes the confirmed AED 30, in both languages", /AED 30 \(the figure/.test(rewriteChunk("Optional key delivery by courier costs AED 25, disclosed before the customer chooses.", "en")) && /30 درهماً/.test(rewriteChunk("توصيل المفتاح الاختياري بالمندوب رسومه 25 درهماً، وتُعرض قبل اختيار العميل.", "ar")));
check("a link the model still writes becomes a sentence that keeps the customer here", enquiriesStayInChat("Use [Raise an enquiry](https://www.emiratespost.ae/contact-us/raise-an-enquiry) please.") === "Use ask me here and I will raise the enquiry for you in the chat please." && !/emiratespost\.ae\/ar\/contact-us/.test(enquiriesStayInChat("https://www.emiratespost.ae/ar/contact-us/raise-an-enquiry", "ar")));
{
  const g = linkGuard("en");
  const out = g.push("See [Raise an enquiry](https://www.emiratespost.ae/contact-us/") + g.push("raise-an-enquiry) for help, and then some more words to push the buffer past the hold length.") + g.flush();
  check("...and the stream guard now runs in English, across a split link", !/raise-an-enquiry/.test(out) && /ask me here/.test(out), out);
}
const tools = src("../../../packages/core/src/ai/tools.ts");
check("request_escalation is the in-chat enquiry, by its own description", /name: "request_escalation",\s*description:\s*"Raise the customer's enquiry, complaint or callback request with the team FROM INSIDE THIS CONVERSATION/.test(tools) && /Enquiry recorded with reference \$\{reference\}/.test(tools));
const reg = src("../lib/registry.ts");
check("the enquiry is recorded and referenced even without an ops mailbox", /action: "enquiry_recorded"/.test(reg) && /enquiry_no_mailbox/.test(reg) && !/cannot arrange a callback"\)/.test(reg) && /const reference = `ENQ-\$\{randomUUID\(\)/.test(reg));

console.log("\nFB-1831 — a ready prompt, two steps");
const ONE_TAP_OPENER = /(renew (?:my )?po box\s*\d+[\s\S]{0,80}?(?:one more|another) year|جدّ?د صندوق البريد\s*\d+[\s\S]{0,60}?لسنة إضافية)/i;
const route = src("../app/api/chat/route.ts");
check("the route still recognises the opener the prompt produces", /const ONE_TAP_OPENER = \/\(renew \(\?:my \)\?po box\\s\*\\d\+\[\\s\\S\]\{0,80\}\?\(\?:one more\|another\) year\|جدّ\?د صندوق البريد\\s\*\\d\+\[\\s\\S\]\{0,60\}\?لسنة إضافية\)\/i;/.test(route));
check("the filled-in prompt IS the one-tap opener, in English and Arabic", ONE_TAP_OPENER.test(READY_PROMPTS[0]!.prompt.en.replace("[number]", "50500").replace("[emirate]", "Dubai")) && ONE_TAP_OPENER.test(READY_PROMPTS[0]!.prompt.ar.replace("[الرقم]", "50500").replace("[الإمارة]", "دبي")));
check("the schema, the public type and both assemblies carry readyPrompts", /readyPrompts: z\.array\(z\.object\(\{ label: LocalizedString, prompt: LocalizedString \}\)\)\.optional\(\)/.test(src("../../../packages/config/src/agent.ts")) && /readyPrompts\?: \{ label: LocalizedString; prompt: LocalizedString \}\[\];/.test(src("../app/embed/[agent]/types.ts")) && /readyPrompts: d\.readyPrompts,/.test(src("../app/embed/[agent]/page.tsx")) && /readyPrompts: d\.readyPrompts,/.test(src("../app/api/agents/[agent]/route.ts")));
check("tapping a ready prompt fills the composer and selects the first blank, it does not send", /const prefillComposer = useCallback\(\(text: string\) => \{\s*setInput\(text\);/.test(exp) && /el\.setSelectionRange\(open, close \+ 1\)/.test(exp) && /onClick=\{\(\) => prefillComposer\(tr\(p\.prompt, locale\)\)\}/.test(exp) && /ref=\{composerRef\}/.test(exp));
check("...with a label in both languages and its own style", /readyPrompt: "Ready to send — just fill in the blanks"/.test(exp) && /readyPrompt: "جاهزة للإرسال — أكمل الفراغات فقط"/.test(exp) && /\.dlg-starter\.is-ready em \{/.test(src("../app/globals.css")));

console.log("\nFB-1710 — the PO Box FAQ");
const enParas = EN.split(/\n\s*\n/).filter(Boolean), arParas = AR.split(/\n\s*\n/).filter(Boolean);
check("eleven topics, in both languages, each one retrieval-sized", enParas.length === 11 && arParas.length === 11 && [...enParas, ...arParas].every((p) => p.length <= 1200), [enParas.length, arParas.length, Math.max(...[...enParas, ...arParas].map((p) => p.length))]);
check("the figures agree with the live system: key delivery AED 30, the phone line, Noqodi named", /AED 30/.test(EN) && /30 درهماً/.test(AR) && /600 599 999/.test(EN) && /600 599 999/.test(AR) && /Noqodi \(UAE Pay\)/.test(EN) && /نقودي \(UAE Pay\)/.test(AR) && !/AED 25/.test(EN));
check("no answer sends the customer to a website to raise an enquiry", !/raise-an-enquiry|contact-us/.test(EN + AR) && /never sent to another website/.test(EN) && /لن تُحال أبداً إلى موقع آخر/.test(AR));
check("where Noqodi is switched off the FAQ names the card alone, eleven topics still", !/Noqodi|نقودي/.test(faqFor(false).en + faqFor(false).ar) && faqFor(false).en.split(/\n\s*\n/).length === 11 && faqFor(false).ar.split(/\n\s*\n/).length === 11 && /Renew button/.test(faqFor(false).en) && faqFor(true).en === EN);
check("the FAQ's menu wording is gone; the chat's own steps are described", !/Select:/.test(EN) && /Renew button/.test(EN) && /appears automatically — there is no separate linking step/.test(EN));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
