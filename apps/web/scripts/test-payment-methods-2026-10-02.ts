/**
 * A toggle per agent for which ways to pay it offers (2026-10-02).
 *
 * "A toggle to turn on/off the payment methods, so later when we put UAEPay in,
 * we only want it on staging of EPGL."
 *
 * Per agent means per environment, because the definition lives in the database
 * and never travels with a merge. So UAEPay can be live on EPGL staging while
 * production offers card and Virtual IBAN, and switching it on later is a
 * toggle rather than a deploy.
 *
 * TWO HALVES, and the second is the one that makes it a toggle rather than a
 * suggestion: the model is told what to offer, and request_payment REFUSES a
 * payment by a method that is switched off.
 *
 * Run from apps/web:  npx tsx scripts/test-payment-methods-2026-10-02.ts
 */
import { readFileSync } from "node:fs";
import { AgentDefinition } from "@dialog/config";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`); }
};
const schema = readFileSync(new URL("../../../packages/config/src/agent.ts", import.meta.url), "utf8");
const tools = readFileSync(new URL("../../../packages/core/src/ai/tools.ts", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/chat/route.ts", import.meta.url), "utf8");
const editor = readFileSync(new URL("../app/admin/[slug]/Editor.tsx", import.meta.url), "utf8");

/** The smallest theme the schema accepts, so these parses are about payments. */
const THEME = {
  brandName: "X",
  colors: {
    primary: "#1330F0", primaryForeground: "#FFFFFF", surface: "#FFFFFF", surfaceMuted: "#F4F6FB",
    text: "#0B1020", textMuted: "#5B6478", border: "#E2E6F0", success: "#0F9D58", warning: "#E8A100", danger: "#D23F31",
  },
  launcher: { position: "bottom-right", label: "" },
};

console.log("\nThe list is part of the agent, so it is part of the environment");
check("it is on the definition", /paymentMethods: z\s*\n?\s*\.array\(/.test(schema));
check("...with a key, a label and a switch", /key: z\.string\(\),\s*\n\s*label: LocalizedString,\s*\n\s*enabled: z\.boolean\(\)\.default\(true\),/.test(schema));
// Every agent predates this field. A missing list must not switch their
// payments off.
check("...and an empty list restricts nothing", /AN EMPTY LIST MEANS NO RESTRICTION/.test(schema));
check("...said again where it is read", /An empty list is every agent that predates the toggle/.test(route));
{
  const parsed = AgentDefinition.safeParse({
    slug: "x", tenantSlug: "t", name: "X", persona: "p", locales: ["en"],
    greeting: { en: "hi" }, theme: THEME,
  });
  check("a definition with no list still parses", parsed.success, parsed.success ? undefined : parsed.error.issues[0]);
  check("...defaulting to an empty one", parsed.success && Array.isArray(parsed.data.paymentMethods) && parsed.data.paymentMethods.length === 0);
}
{
  const parsed = AgentDefinition.safeParse({
    slug: "x", tenantSlug: "t", name: "X", persona: "p", locales: ["en"],
    greeting: { en: "hi" }, theme: THEME,
    paymentMethods: [{ key: "uaepay", label: { en: "UAEPay" } }],
  });
  // Adding a method without saying so switches it ON: you added it to offer it.
  check("a method defaults to on", parsed.success && parsed.data.paymentMethods[0]!.enabled === true);
}

console.log("\nThe model is told what to offer, every turn");
check("built from the definition, not a fixed prompt", /function withPaymentMethods\(context: string \| undefined, def: AgentDefinition\)/.test(route));
check("...and handed over with the rest of the context", /customerContext: withPaymentMethods\(customerContext, agent\.definition\)/.test(route));
check("...naming only what is on", /Offer ONLY these, and all of them/.test(route));
// A method that is off must not be described as coming soon, or as having
// failed — it is simply not available here.
check("...and what to say about one that is off", /never mention \$\{off\.length === 1 \? "it" : "them"\} as coming soon/.test(route));
check("...with the no-methods case handled", /NO PAYMENT METHOD IS AVAILABLE on this agent right now/.test(route));

console.log("\nAnd a payment by a method that is off is REFUSED");
check("checked in request_payment", /const offered = Array\.isArray\(agent\.paymentMethods\) \? agent\.paymentMethods : \[\];/.test(tools));
check("...an unknown or disabled key stops it", /if \(!known \|\| known\.enabled === false\)/.test(tools));
check("...telling the customer what IS offered", /What it does offer: \$\{live\.join\(", "\)\}/.test(tools));
// Nothing was charged, so nothing failed. This is the sentence that stops a
// refusal being reported as a payment problem.
check("...and that nothing was charged", /NOTHING has been charged and nothing is wrong with their application/.test(tools));
check("...while an empty list still allows everything", /if \(offered\.length && chosenMethod\)/.test(tools));
// The two questions are asked in order and are not the same question: may we
// take this method at all, and then through which gateway.
check("...and the availability check comes before the gateway choice",
  tools.indexOf("PAYMENT METHOD NOT AVAILABLE") < tools.indexOf("const pay = adapters.paymentFor"));

console.log("\nThe admin tab is a list of switches, and nothing else");
check("there is a tab", /"Payment methods"/.test(editor) && /tab === "Payment methods"/.test(editor));
check("...each method is a switch", /role="switch"/.test(editor) && /aria-checked=\{on\}/.test(editor));
// No key field, no label field, no note field, no add, no remove: the three
// that exist, on or off. Anything else is a form pretending to be a setting.
for (const gone of ["patchMethod", "+ Another", "Remove", "Add a method"]) {
  check(`  no "${gone}"`, !editor.includes(gone), gone);
}
// Nobody should have to remember that the card option is spelled "gateway".
check("the three that exist are listed", /const KNOWN_METHODS: PaymentMethod\[\] = \[/.test(editor));
check("...including one the agent has that we do not know", /methods\.filter\(\(m\) => !KNOWN_METHODS\.some\(\(k\) => k\.key === m\.key\)\)/.test(editor));
// With no list nothing is restricted, so every switch is on and says so.
check("...all on where no list is set", /enabled: stored \? stored\.enabled !== false : methods\.length === 0/.test(editor));
// Writing only the one that moved would turn an unrestricted agent into one
// offering a single method, which is not what flipping one switch means.
check("...and flipping one writes them all", /paymentMethods: allMethods\.map\(\(m\) => \(\{ \.\.\.m, enabled: m\.key === key \? enabled : m\.enabled !== false \}\)\)/.test(editor));
check("UAEPay arrives switched off", /key: "uaepay"[\s\S]{0,80}enabled: false/.test(editor));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
