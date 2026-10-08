/**
 * One tap to renew (2026-10-08): the signed-in two-tap renewal, end to end on
 * fixtures and by reading the code it depends on.
 *
 * Run from apps/web:  npx tsx scripts/test-one-tap-renew-2026-10-08.ts
 */
import { readFileSync } from "node:fs";
import { applyOneTap, FAST_PATH, MARKER, REWORDINGS, NOTE_REWORDINGS, CONSENT_FIELDS } from "./nxn-one-tap-renew-2026-10-08";

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
  check("...and not added to the corporate renewal", !c.steps[0].fields.some((f: any) => f.key === "save_card_consent"));
  check("'without sign-in' became 'for a GUEST' on both renewals", /For a GUEST \(not signed in\), do NOT offer/.test(p.guidance) && /For a GUEST \(not signed in\), do NOT offer/.test(c.guidance) && !/runs WITHOUT sign-in/.test(p.guidance + c.guidance));
  check("the saved card sentence names the signed-in customer", /signed-in customer's saved card is attached to the save/.test(p.guidance));
  check("the notes no longer say the journey is for guests only", /for every customer, signed in or not/.test(p.submission.apiFlow.notes) && !/NOT signed in, so it uses/.test(p.submission.apiFlow.notes));
  check("...and offer the switches to a signed-in customer", /A SIGNED-IN customer is offered both as switches/.test(p.submission.apiFlow.notes) && /A SIGNED-IN customer is offered both/.test(c.submission.apiFlow.notes));
  check("the fast path is on the personal renewal, once, at the end", p.guidance.endsWith(FAST_PATH) && (p.guidance.match(new RegExp(MARKER.replace(/[()]/g, "\\$&"), "g")) ?? []).length === 1);
  check("...and the text before it is intact", p.guidance.startsWith("Head. For a GUEST") && /Middle\. Stage 4 Payment: At payment: a guest has no card on file/.test(p.guidance) && /Tail\./.test(p.guidance));
  check("...not on the corporate renewal", !c.guidance.includes(MARKER));
  check("the rental is untouched", r.guidance === "Rental untouched.");
  check("every change is named", changes.length >= 7, changes);
  const again = applyOneTap(def);
  check("a second run changes nothing", again.changes.length === 0, again.changes);
  const edited = JSON.parse(JSON.stringify(def)); edited.journeys[0].guidance = edited.journeys[0].guidance.replace("ONE TAP: nothing is asked", "ONE TAP: nothing is asked (old)");
  const fixed = applyOneTap(edited);
  check("a drifted fast path is rewritten rather than stacked", fixed.changes.some((x) => /rewritten/.test(x)) && fixed.def.journeys[0].guidance.endsWith(FAST_PATH) && (fixed.def.journeys[0].guidance.match(/ONE TAP: nothing is asked/g) ?? []).length === 1);
}

console.log("\nWhat the fast path tells the model");
check("one year on the current bundle, priced once, no term question", /pricing tool ONCE for one year on the current bundle \(isBundleChanged false/.test(FAST_PATH) && /do not ask how long, and do not offer upgrades/.test(FAST_PATH) && !/one card per term/.test(FAST_PATH));
check("...because the customer's own message states it", /the term and the bundle in it are COLLECTED — one year, the bundle the box is on now, no add-on added or removed/.test(FAST_PATH));
check("the subscriber is recorded from Details, not asked", /SILENTLY with collect_field from the details response/.test(FAST_PATH));
check("the one reply is summary + switches + a button that names the amount", /reply ONCE with: the \`\`\`summary block[\s\S]*\`\`\`toggles block[\s\S]*confirm: Pay AED <total>/.test(FAST_PATH));
check("...and a way to a longer term or another bundle, one sentence, no question", /to renew for longer or move to a different bundle, they only have to say so\. Nothing else, and no question/.test(FAST_PATH) && /IF THEY ASK FOR A DIFFERENT TERM OR BUNDLE/.test(FAST_PATH));
check("renewal_period is recorded as one year", /Record renewal_period as 1_YEAR/.test(FAST_PATH));
check("the terms checkbox is still in the block", /checkboxes: terms_accepted/.test(FAST_PATH));
check("auto-renew is switched on only through the tool, and honestly", /call nxn_set_auto_renew[\s\S]*if that call fails, say it could not be switched on, never that it is/.test(FAST_PATH));
check("a guest keeps the ordinary collection but the same-as-now opener still suppresses the upsell", /A GUEST \(not signed in\) is NOT on the signed-in shortcuts/.test(FAST_PATH) && /SAME-AS-NOW OPENER RULE applies to everyone[\s\S]*do NOT show upgrade cards, bundle choices or duration cards, whatever the upgrade rule earlier in this guidance says; it is overridden here/.test(FAST_PATH));
check("an opening message that names the box skips the greeting, the list, the term and the upsell", /Do not greet at length, do not read their account out, do not list their boxes, do not ask which box, do not ask how long, and do not offer upgrades/.test(FAST_PATH));

console.log("\nThe code beside it");
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

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
