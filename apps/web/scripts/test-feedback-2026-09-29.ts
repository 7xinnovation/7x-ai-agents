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

console.log("\nFB-1793 / FB-1802 — signing out lives in a profile menu");
/**
 * "It should be something like where they click on the profile icon and sign
 * out, in case they want to sign in with another Emirates ID on the same
 * session." What was there was one chip that signed you out on a tap, armed
 * itself on a touch screen, and said what it did only in a tooltip — which a
 * phone has not got. Reported twice as a missing logout and once as a sign-IN
 * button that ended somebody's session mid-application.
 */
check("the icon opens a menu rather than acting", /onClick=\{\(\) => setProfileOpen\(\(v\) => !v\)\}/.test(exp));
check("...announced as one", /aria-haspopup="menu"/.test(exp) && /aria-expanded=\{profileOpen\}/.test(exp));
check("...saying who is signed in", /\{t\.signedIn\}<\/span>/.test(exp) && /signedInName \? <strong>\{signedInName\}<\/strong>/.test(exp));
check("...with a name read from the case, never fetched", /for \(const k of \["contact_name", "full_name", "applicant_name", "customer_name"\]\)/.test(exp));
check("sign out is a menu item, in words", /<span>\s*\n\s*\{t\.signOut\}/.test(exp));
// The reason they are here: another Emirates ID on the same screen.
check("...saying why you would", /signOutHint: "to use a different Emirates ID"/.test(exp));
check("...in both languages", /signOutHint: "لاستخدام هوية إماراتية أخرى"/.test(exp));
check("it closes on a click away", /if \(!profileRef\.current\?\.contains\(e\.target as Node\)\) setProfileOpen\(false\);/.test(exp));
check("...and on Escape", /if \(e\.key === "Escape"\) setProfileOpen\(false\);/.test(exp));
// A menu describing a session must not outlive it.
check("...and whenever the session ends by any route", /useEffect\(\(\) => \{ if \(!authenticated\) setProfileOpen\(false\); \}, \[authenticated\]\);/.test(exp));
check("signed out, it is simply the sign-in button", /<button className="dlg-chip is-auth" onClick=\{signIn\}/.test(exp));
check("...and the server session is what actually ends", /signOutConversation/.test(readFileSync(new URL("../lib/conversation.ts", import.meta.url), "utf8")));

console.log("\nFB-1794 — the journey as steps, not a percentage");
check("steps come from the journey's own step titles", /title: \(locale === "ar" \? s\.title\?\.ar : s\.title\?\.en\)/.test(exp));
// A step with nothing required in it has nothing to be waiting for.
check("...counting only steps that require something", /\.filter\(\(s\) => s\.required > 0\)/.test(exp));
check("...done when nothing in it is still missing", /done: required\.length > 0 && required\.every\(\(k\) => !missingSet\.has\(k\)\)/.test(exp));
check("...and the live one is the first that is not", /const currentIndex = steps\.findIndex\(\(s\) => !s\.done\);/.test(exp));
check("only the live step is named, the rest are numbers", /\{state === "now" \? <span className="dlg-step-name">\{s\.title\}<\/span> : null\}/.test(exp));
check("...which is what fits a phone", /max-width: 42vw;/.test(css));
check("a done step is ticked", /state === "done" \? <CheckCircle size=\{15\} weight="fill" \/>/.test(exp));
check("the percentage keeps its place", /<strong>\{progress\.pct\}%<\/strong>/.test(exp));
// One step is not a stepper.
check("a single-step journey keeps the old bar", /\{journeySteps \? \(/.test(exp) && /if \(steps\.length < 2\) return null;/.test(exp));
check("the live step is announced to a screen reader", /aria-current=\{state === "now" \? "step" : undefined\}/.test(exp));
// EPGL shows readiness in the side panel; their UI is not to change on the
// back of Emirates Post's feedback.
check("EPGL's panel readiness is untouched", /SCOPED TO THE TOP BAR ON PURPOSE/.test(css));
check("...because the stepper only renders in the top bar", exp.indexOf("dlg-steps") > exp.indexOf('className="dlg-progress-top"'));

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
