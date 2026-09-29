/**
 * Post-live feedback, Emirates Post — the items that needed no interpretation.
 *
 * FB-1792  Account Pulse: greet by first name; drop the recent-activity list.
 * FB-1793  "Icons on top right are not clearly explaining what they mean."
 * FB-1802  "Add logout button from the agent, or activate it."
 * FB-1791  Touch targets and icon sizes.
 *
 * FB-1802 is worth stating plainly: the logout button was already there and
 * already worked. It is the green circle in the header. It has now been
 * reported twice as missing and once — on 19 September — as a sign-IN button
 * that signed somebody out mid-application. Three people saying the same thing
 * about the same control is not three misreadings; an icon with a tooltip is
 * not a control on a phone, which has no tooltips.
 *
 * Run from apps/web:  npx tsx scripts/test-feedback-2026-09-29.ts
 */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`); }
};
const route = readFileSync(new URL("../app/api/chat/route.ts", import.meta.url), "utf8");
const exp = readFileSync(new URL("../app/embed/[agent]/Experience.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const nxnPulse = route.slice(route.indexOf("const PULSE_DIRECTIVE"), route.indexOf("const EPGL_PULSE_DIRECTIVE"));

console.log("\nFB-1792 — the pulse greets by first name");
check("the first name is what is asked for", /Use their FIRST NAME only, not their full legal name/.test(nxnPulse));
// UAE PASS hands over a full legal name, often in capitals.
check("...written as a name, not as it arrives", /never .{0,3}EMRE KARAYALCIN/.test(nxnPulse));
check("...and still never worth a tool call", /do not call a tool to find it/.test(nxnPulse));

console.log("\nFB-1792 — and no recent-activity list");
check("it is forbidden outright", /Do NOT list recent activity, past requests or a history/.test(nxnPulse));
check("...with the reason: the pulse is what needs attention now", /The pulse is what needs attention now/.test(nxnPulse));
check("...and the old list is gone, not merely discouraged", !/add a short .{0,3}Recent activity.{0,3} list/.test(nxnPulse));
// EPGL's pulse is a different service and was not part of this feedback.
check("EPGL's own pulse is untouched", /add a short .{0,3}Recent activity.{0,3} list/.test(route.slice(route.indexOf("const EPGL_PULSE_DIRECTIVE"))));

console.log("\nFB-1793 / FB-1802 — the sign-out control says what it is");
check("it carries a word at every width", /<span className="dlg-chip-tag">\{signOutArmed \? t\.signOutConfirm : authenticated \? t\.signOut : t\.signIn\}<\/span>/.test(exp));
check("...so it is never icon-only", /className=\{`dlg-chip is-auth \$\{authenticated \? "is-on" : ""\}`\}/.test(exp));
check("...in both languages", /signOut: "Sign out"/.test(exp) && /signOut: "تسجيل الخروج"/.test(exp));
// The confirm-on-touch behaviour that stopped a stray tap ending a session
// stays exactly as it was.
check("a touch device still asks before signing out", /if \(!coarsePointer \|\| signOutArmed\) \{ setSignOutArmed\(false\); void signOut\(\); return; \}/.test(exp));
check("...and the server session is what actually ends", /signOutConversation/.test(readFileSync(new URL("../lib/conversation.ts", import.meta.url), "utf8")));

console.log("\nFB-1791 — targets big enough to hit");
check("chips are 44px, not 33", /\.dlg-chip \{[\s\S]{0,200}height: 44px;/.test(css));
check("...icon-only ones are square at 44", /\.dlg-chip\.icon-only \{\s*\n\s*width: 44px;/.test(css));
check("...comfortably past the 24px minimum", !/height: 34px;/.test(css.slice(css.indexOf(".dlg-chip {"), css.indexOf(".dlg-chip.icon-only"))));
for (const icon of ["ShieldSlash", "NotePencil", "ListChecks", "GlobeSimple"]) {
  check(`  ${icon} is 20px, not 16`, new RegExp(`<${icon} size=\\{20\\}`).test(exp));
}
check("the reason is written where the next person will change it", /TOUCH TARGETS BIG ENOUGH TO HIT \(FB-1791, FB-1793\)/.test(css));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
