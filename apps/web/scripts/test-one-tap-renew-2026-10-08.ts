/**
 * One tap to renew (2026-10-08): the signed-in two-tap renewal, end to end on
 * fixtures and by reading the code it depends on.
 *
 * Run from apps/web:  npx tsx scripts/test-one-tap-renew-2026-10-08.ts
 */
import { readFileSync } from "node:fs";
import { applyOneTap, FAST_PATH, MARKER, TOP_RULE, TOP_MARKER, REWORDINGS, NOTE_REWORDINGS, CONSENT_FIELDS, PAYMENT_FIELD } from "./nxn-one-tap-renew-2026-10-08";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : ` — got ${JSON.stringify(got).slice(0, 300)}`}`); }
};
const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

console.log("\nThe journey config: fields back, sentences conditional, fast path once");
const fixture = () => ({
  slug: "nxn-dialog",
  journeys: [
    {
      key: "personal_po_box_renewal",
      guidance: `Head. ${REWORDINGS[0]![0]}Middle. Stage 4 Payment: ${REWORDINGS[1]![0]}Tail.`,
      steps: [{ key: "identify", fields: [{ key: "po_box_number", type: "text" }, { key: "renewal_period", type: "enum" }, { key: "terms_accepted", type: "boolean" }] }],
      submission: { apiFlow: { saveTool: "s", confirmTool: "c", notes: `GUEST RENEWAL, MAPPED (2026-09-02): ${NOTE_REWORDINGS[0]![0]}\nORDER.\n${NOTE_REWORDINGS[1]![0]}\nPAYMENT: the save returns a payment URL.` } },
    },
    {
      key: "corporate_po_box_renewal",
      guidance: `Corp. ${REWORDINGS[0]![0]}End.`,
      steps: [{ key: "identify", fields: [{ key: "po_box_number", type: "text" }] }],
      submission: { apiFlow: { notes: `${NOTE_REWORDINGS[1]![0]}` } },
    },
    { key: "personal_po_box_rental", guidance: "Rental untouched.", steps: [{ fields: [] }] },
  ],
});
{
  const { def, changes } = applyOneTap(fixture());
  const p = def.journeys[0], c = def.journeys[1], r = def.journeys[2];
  const keys = p.steps[0].fields.map((f: any) => f.key);
  check("save-card and auto-renew switches are back on the personal step", keys.includes("save_card_consent") && keys.includes("auto_renew_consent"), keys);
  check("...not required, so a guest is never blocked by them", p.steps[0].fields.filter((f: any) => CONSENT_FIELDS.some((c) => c.key === f.key)).every((f: any) => f.validation.required === false));
  const pm = p.steps[0].fields.find((f: any) => f.key === "payment_method");
  check("the way to pay is a field, recorded from the tap, with both ways", pm && pm.validation.required === false && JSON.stringify(pm.options.map((o: any) => o.value)) === JSON.stringify(["gateway", "uaepay"]) && pm.options[1].label.en === "Pay with Noqodi (UAE Pay)", pm);
  check("...and PAYMENT_FIELD names the card the same way as everywhere else", PAYMENT_FIELD.options[0]!.label.en === "Pay with Card");
  check("...and not added to the corporate renewal", !c.steps[0].fields.some((f: any) => f.key === "save_card_consent"));
  check("'without sign-in' became 'for a GUEST' on both renewals", /For a GUEST \(not signed in\), do NOT offer/.test(p.guidance) && /For a GUEST \(not signed in\), do NOT offer/.test(c.guidance) && !/runs WITHOUT sign-in/.test(p.guidance + c.guidance));
  check("the saved card sentence names the signed-in customer", /signed-in customer's saved card is attached to the save/.test(p.guidance));
  check("the notes no longer say the journey is for guests only", /for every customer, signed in or not/.test(p.submission.apiFlow.notes) && !/NOT signed in, so it uses/.test(p.submission.apiFlow.notes));
  check("...and offer the switches to a signed-in customer", /A SIGNED-IN customer is offered both as switches/.test(p.submission.apiFlow.notes) && /A SIGNED-IN customer is offered both/.test(c.submission.apiFlow.notes));
  check("the fast path is on the personal renewal, once, at the end", p.guidance.endsWith(FAST_PATH) && (p.guidance.match(new RegExp(MARKER.replace(/[()]/g, "\\$&"), "g")) ?? []).length === 2);
  check("...and the short rule is at the very top, once", p.guidance.startsWith(TOP_RULE) && (p.guidance.match(new RegExp(TOP_MARKER.replace(/[()]/g, "\\$&"), "g")) ?? []).length === 1);
  check("...which forbids the echo-back question, saves in the one reply and names both ways to pay", /Never answer it with a question — not "just to confirm"/.test(TOP_RULE) && /CALLS THE SAVE TOOL/.test(TOP_RULE) && /label: Pay AED <total> with Card/.test(TOP_RULE) && /Pay AED <total> with Noqodi \(UAE Pay\) instead/.test(TOP_RULE) && /GUEST: [\s\S]*with Card` alone/.test(TOP_RULE));
  check("...and the text between is intact", p.guidance.includes("Head. For a GUEST") && /Middle\. Stage 4 Payment: At payment: a guest has no card on file/.test(p.guidance) && /Tail\./.test(p.guidance));
  check("...not on the corporate renewal", !c.guidance.includes(MARKER));
  check("the rental is untouched", r.guidance === "Rental untouched.");
  check("every change is named", changes.length >= 7, changes);
  const again = applyOneTap(def);
  check("a second run changes nothing", again.changes.length === 0, again.changes);
  const edited = JSON.parse(JSON.stringify(def)); edited.journeys[0].guidance = edited.journeys[0].guidance.replace("ONE TAP: nothing is asked", "ONE TAP: nothing is asked (old)");
  const fixed = applyOneTap(edited);
  check("a drifted fast path is rewritten rather than stacked", fixed.changes.some((x) => /rewritten/.test(x)) && fixed.def.journeys[0].guidance.endsWith(FAST_PATH) && (fixed.def.journeys[0].guidance.match(/ONE TAP: nothing is asked/g) ?? []).length === 1);
  const drifted2 = JSON.parse(JSON.stringify(def)); drifted2.journeys[0].guidance = drifted2.journeys[0].guidance.replace("is a COMPLETE, CONFIRMED request", "is a COMPLETE, CONFIRMED request (old)");
  const fixed2 = applyOneTap(drifted2);
  check("a drifted top rule is rewritten in place, once", fixed2.changes.some((x) => /at the top rewritten/.test(x)) && fixed2.def.journeys[0].guidance.startsWith(TOP_RULE) && (fixed2.def.journeys[0].guidance.match(/COMPLETE, CONFIRMED request/g) ?? []).length === 1);
}

console.log("\nWhat the fast path tells the model");
check("one year on the current bundle, priced once, no term question", /pricing tool ONCE for one year on the current bundle \(isBundleChanged false/.test(FAST_PATH) && /do not ask how long, do not ask how to pay, and do not offer upgrades/.test(FAST_PATH) && !/one card per term/.test(FAST_PATH));
check("...because the customer's own message states it", /the term and the bundle in it are COLLECTED — one year, the bundle the box is on now, no add-on added or removed/.test(FAST_PATH));
check("the subscriber is recorded from Details, not asked", /record SILENTLY with collect_field — renewal_period 1_YEAR, payment_method gateway, and the subscriber fields[\s\S]{0,200}from the details response/.test(FAST_PATH));
check("the one reply is summary + the payment page on the pay button + Noqodi instead, no switches", /CALL THE SAVE TOOL in this same reply/.test(FAST_PATH) && /reply ONCE with: the \`\`\`summary block[\s\S]*\`\`\`pay block \(\`label: Pay AED <total> with Card\`/.test(FAST_PATH) && /\`\`\`buttons block with the single choice \`Pay AED <total> with Noqodi \(UAE Pay\) instead\`/.test(FAST_PATH) && /No switches, no checkbox, no question/.test(FAST_PATH));
check("the one-tap save keeps auto-renewal as it is and saves no card unasked", /saveCreditCard false and isAutomaticSubscriptionEnabled exactly as the box has it today/.test(FAST_PATH));
check("a Noqodi-instead tap never records the renewal twice", /"PAY WITH NOQODI \(UAE PAY\) INSTEAD" tapped[\s\S]*do NOT call the save tool again[\s\S]*do NOT call the confirm tool/.test(FAST_PATH));
check("a refused save ends in a plain sentence, not a retry", /If the save tool fails or is refused, show the summary and say plainly[\s\S]*no pay block, no retry, no second save/.test(FAST_PATH));
check("the ordinary block (different term) still offers TWO buttons", /\`\`\`toggles block \(title: Before payment; default: on; checkboxes: terms_accepted[\s\S]*confirm: Pay AED <total> with Card \| Pay AED <total> with Noqodi \(UAE Pay\)[\s\S]*TWO buttons for a SIGNED-IN customer/.test(FAST_PATH));
check("the tap IS the choice: card goes to Emirates Post's page, Noqodi to our checkout then the save records", /THE TAP IS THE CHOICE OF HOW TO PAY[\s\S]*"with Card": record collect_field\(payment_method, gateway\)[\s\S]*"with Noqodi \(UAE Pay\)": record collect_field\(payment_method, uaepay\), then call request_payment[\s\S]*call the save tool ONCE to record the renewal — unless it was already saved in this conversation — IGNORE the payment URL[\s\S]*do NOT call the confirm tool/.test(FAST_PATH));
check("a guest gets the card button alone and is told Noqodi needs the sign-in", /confirm line is \`confirm: Pay AED <total> with Card\` alone, with one sentence that paying with Noqodi \(UAE Pay\) needs them to sign in/.test(FAST_PATH));
check("...and a way to a longer term or another bundle, one sentence, no question", /to renew for longer or move to a different bundle, they only have to say so\. No switches, no checkbox, no question/.test(FAST_PATH) && /IF THEY ASK FOR A DIFFERENT TERM OR BUNDLE/.test(FAST_PATH));
check("renewal_period is recorded as one year, and the way to pay as card for the save", /renewal_period 1_YEAR, payment_method gateway/.test(FAST_PATH));
check("the terms are accepted by paying on the one tap, and ticked in the ordinary block", /By paying you accept the \[Terms and Conditions\]/.test(FAST_PATH) && /collect_field\(terms_accepted, true\) — they accepted the terms by paying/.test(FAST_PATH) && /checkboxes: terms_accepted/.test(FAST_PATH));
check("auto-renew is switched on only through the tool, and honestly", /call nxn_set_auto_renew[\s\S]*if that call fails, say it could not be switched on, never that it is/.test(FAST_PATH));
check("a guest keeps the ordinary collection but the same-as-now opener still suppresses the upsell", /A GUEST \(not signed in\) is NOT on the signed-in shortcuts/.test(FAST_PATH) && /SAME-AS-NOW OPENER RULE applies to everyone[\s\S]*do NOT show upgrade cards, bundle choices or duration cards, whatever the upgrade rule earlier in this guidance says; it is overridden here/.test(FAST_PATH));
check("an opening message that names the box skips the greeting, the list, the term and the upsell", /Do not greet at length, do not read their account out, do not list their boxes, do not ask which box, do not ask how long, do not ask how to pay, and do not offer upgrades/.test(FAST_PATH));

console.log("\nThe code beside it");
const md = src("../app/embed/[agent]/Markdown.tsx");
check("a toggles block can carry several confirm buttons, split on |", /confirmLabels: string\[\];/.test(md) && /tConfirms = meta\[2\]!\.split\("\|"\)/.test(md) && /confirmLabels\.map\(\(label\) => \(/.test(md) && /onSelect\(`\$\{summary\}\. \$\{label\}\.`\)/.test(md));
const prompt = src("../../../packages/core/src/ai/prompt.ts");
check("the backend-gateway prompt knows the Noqodi order: pay on our checkout, then save, never their confirm", /PAYING WITH NOQODI \(UAE PAY\) INSTEAD: if the customer's recorded payment_method is "uaepay"[\s\S]*Call request_payment FIRST[\s\S]*to RECORD the order[\s\S]*do NOT call \$\{f\.confirmTool\}/.test(prompt));
check("...and never a second time after the one-tap save", /unless \$\{f\.saveTool\} has ALREADY returned a reference earlier in this conversation/.test(prompt));
const routeSrc = src("../app/api/chat/route.ts");
check("the backend-gateway flag follows the chosen method", /backendGateway:[\s\S]{0,1200}confirmTool\)\) &&\s*String\(session\.state\.data\.payment_method \?\? ""\)\.toLowerCase\(\) !== "uaepay",/.test(routeSrc));
check("...a Noqodi renewal's save waits for the money like an internal-checkout one", /\(!j\.submission\?\.apiFlow\?\.confirmTool \|\| String\(session\.state\.data\.payment_method \?\? ""\)\.toLowerCase\(\) === "uaepay"\) &&/.test(routeSrc));
check("...and request_payment charges the price Emirates Post quoted for the term", /const priced = apiTools\.getLastPriced\(\);\s*return typeof priced\?\.amount === "number" && priced\.amount > 0 \? priced\.amount : null;/.test(routeSrc));
check("the mock persona carries the UAT test Emirates ID so Noqodi takes its payment locally", /MOCK_PERSONA_EID = "784199983926421"/.test(src("../lib/mockPersona.ts")) && /emiratesId: MOCK_PERSONA_EID/.test(src("../app/api/uaepass/callback/route.ts")) && /rememberVerifiedEmiratesId\(session\.caseId, MOCK_PERSONA_EID\)/.test(routeSrc));
check("the server recognises the one-tap opener and directs the turn itself, per sign-in state", /const ONE_TAP_OPENER = \/\(renew \(\?:my \)\?po box/.test(routeSrc) && /function withOneTapOpener\(context: string \| undefined, message: string \| undefined, def: AgentDefinition, authenticated: boolean, state: OneTapState\)/.test(routeSrc) && /withOneTapOpener\(withPaymentMethods\(customerContext, agent\.definition\), effectiveMessage, agent\.definition, authenticated, session\.state\)/.test(routeSrc) && /Do NOT ask anything — not \\"just to confirm\\"/.test(routeSrc) && /with Card` ALONE/.test(routeSrc));
const reSrc = /const ONE_TAP_OPENER = \/(.*)\/i;/.exec(routeSrc)?.[1];
const oneTap = reSrc ? new RegExp(reSrc, "i") : null;
check("...and it matches the pill, the pulse button and the Arabic opener, not a plain renewal", !!oneTap && oneTap.test("Renew my PO Box 50500 in Dubai for one more year, same bundle and options.") && oneTap.test("Renew PO Box 50500 for another year") && oneTap.test("جدّد صندوق البريد 50500 في دبي لسنة إضافية، بنفس الباقة والخيارات.") && !oneTap.test("I want to renew my PO Box"));
check("the signed-in directive saves in the same turn and puts the payment page on the pay button", /CALL THE SAVE TOOL NOW/.test(routeSrc) && /```pay block with `label: Pay AED <total> with Card` and the paymentUrl the save returned/.test(routeSrc) && /single choice `Pay AED <total> with Noqodi \(UAE Pay\) instead`/.test(routeSrc) && /show no switches and no checkbox/.test(routeSrc));
check("the Noqodi-instead tap is directed: terms by the tap, request_payment, no second save", /const NOQODI_INSTEAD = \/with noqodi \\\(uae pay\\\) instead/.test(routeSrc) && /The renewal is ALREADY RECORDED with Emirates Post under reference \$\{recorded\}: do NOT call the save tool again/.test(routeSrc) && /record collect_field\(terms_accepted, true\) and collect_field\(payment_method, uaepay\), then call request_payment/.test(routeSrc));
check("a Noqodi payment settled after the one-tap save is told the order already exists", /function paymentSettledDirective\(agent: AgentDefinition, journeyKey: string \| null, state\?: OneTapState\)/.test(routeSrc) && /The renewal was ALREADY RECORDED with Emirates Post before they paid, under reference \$\{recorded\}\. Do NOT call \$\{saveTool\} again/.test(routeSrc) && /paymentSettledDirective\(agent\.definition, session\.state\.journeyKey, session\.state\)/.test(routeSrc));
const mockSrc = src("../lib/mockPersona.ts");
check("the mock persona's save and confirm are simulated, so the card path can be seen on a laptop", /t\.includes\("guest_renewal_save"\)[\s\S]*paypage-uat\.ngenius-payments\.com/.test(mockSrc) && /t\.includes\("guest_renewal_confirmpayment"\)[\s\S]*isPaymentSuccess: true/.test(mockSrc) && /simulated: true/.test(mockSrc));
const toolsSrc = src("../../../packages/core/src/ai/tools.ts");
check("a gateway that does not answer is a tool error, not a dead turn", /try \{\s*res = await pay\.adapter\.initiate\(actx, \{[\s\S]*\} catch \(e\) \{[\s\S]*PAYMENT COULD NOT BE STARTED[\s\S]*NOTHING has been charged/.test(toolsSrc));
check("Noqodi without a verified Emirates ID is refused before the gateway, naming the way forward", /pay\.binding\?\.provider === "uaepay" && !payerDetails\(state\)\.emiratesId[\s\S]{0,400}NOQODI \(UAE PAY\) NEEDS A SIGN-IN/.test(toolsSrc));
check("...and the guidance says the guest gets the card button alone", /A GUEST \(not signed in\) is NOT on the signed-in shortcuts above[\s\S]*confirm line is \`confirm: Pay AED <total> with Card\` alone/.test(FAST_PATH));
const integ0 = src("../lib/integrations.ts");
check("a renewal save after a Noqodi payment is reported as RECORDED, not as unpaid", /THE RENEWAL IS RECORDED\. The customer has ALREADY PAID on our Noqodi \(UAE Pay\) checkout/.test(integ0) && /\(opts\.backendGateway\s*\?\s*`\\n\\nTHE ORDER EXISTS AND IS NOT PAID/.test(integ0));
check("...and the last quoted renewal price is readable by the chat route", /getLastPriced: \(\) => lastPriced,/.test(integ0));
const integ = src("../lib/integrations.ts");
check("a signed-in renewal save carries the saved card", /if \(!opts\.authenticated\) \{[\s\S]{0,400}\} else if \(opts\.savedCard && !pay\.savedCard\) \{/.test(integ));
check("...the five fields the spec defines, from the lookup", /pay\.savedCard = \{\s*cardToken: card\.cardToken,\s*maskedPan: card\.maskedPan \?\? "",\s*expiry: card\.expiry \?\? "",\s*scheme: card\.scheme \?\? "",\s*cardholderName: card\.cardholderName \?\? "",\s*\};\s*patched = true;\s*\}\s*\}\s*if \(patched\) \{\s*body\.paymentProperties = pay;/.test(integ));
check("...while a guest's flags are still forced off", /if \(!opts\.authenticated\) \{\s*\/\/ A guest has no account[\s\S]{0,200}pay\.saveCreditCard = false;\s*pay\.isAutomaticSubscriptionEnabled = false;/.test(integ));
check("a refused saved card is retried without it on the renewal too", /\/\(rental_save\|guest_renewal_save\)\$\/i\.test\(toolName\) &&\s*\/error from payment gateway\/i/.test(integ));

const exp = src("../app/embed/[agent]/Experience.tsx");
check("a start intent type and an opener in the customer's language", /export type StartIntent = \{ journey\?: string; box\?: string; emirate\?: string; force\?: boolean \}/.test(exp) && /export function renewalOpener\(i: StartIntent, locale: Locale\): string/.test(exp));
check("...Arabic and English openers name the box, the term and 'same as now'", /جدّد صندوق البريد \$\{box\}[\s\S]{0,80}لسنة إضافية، بنفس الباقة والخيارات/.test(exp) && /Renew my PO Box \$\{box\}[\s\S]{0,60}for one more year, same bundle and options\./.test(exp));
check("...emirate names map to the codes the API wants", /dubai: "DXB", "دبي": "DXB"/.test(exp) && /"umm al quwain": "UAQ"/.test(exp));
check("the widget accepts initialStart", /initialStart\?: StartIntent;/.test(exp));
check("...and sends it once the session has resumed, replacing the pulse", /if \(!startIntent \|\| !resumed \|\| streaming\) return;[\s\S]{0,900}if \(authenticated\) pulsed\.current = true;\s*void send\(renewalOpener\(startIntent, locale\)\);/.test(exp));
check("...but a later sign-in still gets its pulse", /One who signs in later still gets the pulse/.test(exp));
check("...on a restored conversation too — a URL intent is sent once per tab", /if \(!startIntent\.force\) \{\s*const key = `dlg-start:\$\{agent\.slug\}[\s\S]{0,200}window\.sessionStorage\.getItem\(key\)\) return;\s*window\.sessionStorage\.setItem\(key/.test(exp) && !/messages\.length > 0\) \{ setStartIntent/.test(exp));
check("the host's start message is gated like the token when origins are set", /if \(m\.action === "start"\) \{\s*if \(permitted\.size && !permitted\.has\(e\.origin\)\) return;\s*setStartIntent\(\{ journey: m\.journey, box: m\.box, emirate: m\.emirate, force: true \}\);/.test(exp));
check("each box in the panel has a Renew action", /className="dlg-box-renew"[\s\S]{0,300}void send\(renewalOpener\(\{ box: b\.box, emirate: b\.emirate \}, locale\)\);/.test(exp));
check("...named in both languages", /renewBox: "Renew",/.test(exp) && /renewBox: "تجديد",/.test(exp));
check("...and it closes the mobile panel so the chat is seen", /setMobileCaseOpen\(false\);\s*void send\(renewalOpener\(\{ box: b\.box/.test(exp));

const page = src("../app/embed/[agent]/page.tsx");
check("the embed URL carries journey, box and emirate", /journey\?: string; box\?: string; emirate\?: string/.test(page) && /initialStart=\{initialStart\}/.test(page));
const loader = src("../../../packages/embed/src/index.ts");
check("window.Dialog.start opens the panel on the request", /dlg\.start = \(intent: \{ journey\?: string; box\?: string; emirate\?: string \}\) =>/.test(loader) && /action: "start", \.\.\.intent/.test(loader) && /setMode\("widget"\);/.test(loader));
check("...riding on the iframe URL before the panel has ever opened", /if \(mode === "closed" && !opened\) \{\s*frame\.src = frame\.src\.replace\(\/&\(journey\|box\|emirate\)=\[\^&\]\*\/g, ""\) \+ params;/.test(loader));
const css = src("../app/globals.css");
check("the Renew pill is styled, and red on a lapsed box", /\.dlg-box-renew \{/.test(css) && /\.dlg-boxes-list li\.is-expired \.dlg-box-renew \{/.test(css));
const route = src("../app/api/chat/route.ts");
check("the pulse offers the expiring box's renewal as one button, for another year", /offer its renewal as ONE ```buttons choice — \\"Renew PO Box <number> for another year\\"/.test(route));

check("coming back from the payment page is directed: no second save, one confirm", /const PAID_BACK = \/completed the payment on the emirates post page/.test(routeSrc) && /PAID_BACK\.test\(message\) && state\.gatewayPayment\?\.reference/.test(routeSrc) && /do NOT call the save tool again: a second save opens a second order\. ` \+/.test(routeSrc) && /call the confirm tool ONCE for that order and nothing else/.test(routeSrc));
check("...and the guidance says the same", /AFTER THE PAY BUTTON: [\s\S]*do NOT call the save tool again[\s\S]*call the confirm tool ONCE/.test(FAST_PATH));
check("an Arabic conversation gets Arabic pay labels, which the Noqodi-instead regex still catches", /ادفع AED <total> بالبطاقة/.test(routeSrc) && /ادفع AED <total> بالبطاقة/.test(FAST_PATH) && /نقودي\[\\s\\S\]\{0,40\}بدلاً/.test(routeSrc) && new RegExp((/const NOQODI_INSTEAD = \/(.*)\/i;/.exec(routeSrc) ?? [])[1] ?? "$^", "i").test("ادفع AED 695.00 عبر نقودي (UAE Pay) بدلاً من ذلك"));
check("the backend-gateway flag is decided by the agent's flows when no journey is set yet", /session\.state\.journeyKey\s*\? Boolean\([\s\S]{0,200}confirmTool\)\s*: \(agent\.definition\.journeys \?\? \[\]\)\.some\(\(j\) => j\.submission\?\.apiFlow\?\.saveTool && j\.submission\?\.apiFlow\?\.confirmTool\)\)/.test(routeSrc));

// 12 October: the rough edges the live runs showed.
check("the return and settled turns never flip auto-renewal unasked", (routeSrc.match(/[Dd]o NOT call nxn_set_auto_renew in this reply: the box keeps its auto-renewal as it is, and that tool is called only when they tap the button or ask\./g) ?? []).length === 2);
check("...and the guidance says the same, for both ways to pay", /do NOT call nxn_set_auto_renew before they tap it/.test(FAST_PATH) && /without calling nxn_set_auto_renew until they tap/.test(FAST_PATH));
check("the Noqodi-instead reply is one sentence, not the directive's and the tool's", /Your whole reply is ONE short sentence that the secure payment is ready below — the request_payment result asks for the same sentence, so write it once, not twice/.test(routeSrc));
check("the receipt link is announced where it lands: under the reply", /its download link is added under your reply for you, so do not write one and do not say it is above/.test(routeSrc) && /The receipt link is added under your reply for you — do not write one of your own, do not say it is above/.test(integ) && /The receipt download link is added under your reply for you: do not write one, and do not say it is above/.test(FAST_PATH));
check("the mock persona's auto-renewal tap is simulated and audited, so it can be tested locally", /if \(uaePassMockAllowed\(\) && session\.userRef === MOCK_PERSONA_SUB\) \{\s*const enabled = input\.enabled === true;\s*await audit\(\{ \.\.\.a, actor: "system", action: "mock_auto_renew"/.test(routeSrc));

check("a save that arrives without the subscriber is completed from the conversation, and what is still missing is named", /opts\.renewalSubscriber\(\)/.test(integ) && /action: "renewal_kyc_filled"/.test(integ) && /missing the \$\{missing\.join\(", "\)\}/.test(integ) && /let patched = kycFilled\.length > 0;/.test(integ) && /renewalSubscriber:\s*agent\.definition\.tenantSlug === "nxn"/.test(routeSrc) && /s\("subscriber_first_name"\)/.test(routeSrc));
check("...and the directive and the guidance both name the save body", /with customerKYC \{ firstName, lastName, email, mobileNumber \} carrying the same subscriber values, paymentProperties\.saveCreditCard false/.test(routeSrc) && /with customerKYC \{ firstName, lastName, email, mobileNumber \} carrying those same subscriber values, paymentProperties\.saveCreditCard false/.test(FAST_PATH));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
