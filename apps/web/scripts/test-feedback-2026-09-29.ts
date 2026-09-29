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

console.log("\nFB-1792 — the boxes are in the panel, the count is in the chat");
/**
 * An account with forty-six boxes printed forty-six rows into the conversation
 * — box, bundle, expiry, status — above a side panel reading "Nothing to
 * assemble yet". The lookup behind it has always returned the whole row and
 * thrown all but the number away, because its only caller was the ownership
 * gate.
 */
check("the lookup keeps the whole row now", /const accountBoxRows = async \(\): Promise<CustomerPoBox\[\] \| null>/.test(route));
check("...and the ownership gate still gets its numbers from it", /const rows = await accountBoxRows\(\);\s*\n\s*return rows \? rows\.map/.test(route));
check("...one lookup, not two", /if \(ownedBoxesCache\) return ownedBoxesCache\.rows;/.test(route));
check("the rows are written onto the case", /\[ACCOUNT_BOXES_KEY\]: rows\.map/.test(route));
check("...for Emirates Post only, and only when signed in", /agent\.definition\.tenantSlug === "nxn" && authenticated\) \{\s*\n\s*const rows = ownedBoxesCache/.test(route));
// The pulse is where the lookup runs; after that the panel keeps what it has
// rather than re-fetching every turn.
check("...fetched on the pulse, reused after it", /ownedBoxesCache\?\.rows \?\? \(isPulse \? await accountBoxRows\(\) : null\)/.test(route));
check("an expired box is marked as one", /status: b\.expired \? "Expired" : String\(b\.status \?\? ""\)/.test(route));

check("the panel reads them off the case, never fetches", /const raw = \(caseState\?\.data as Record<string, unknown> \| undefined\)\?\.__account_boxes;/.test(exp));
check("...above the case builder, where they asked for it", exp.indexOf('className="dlg-boxes"') < exp.indexOf('className="dlg-case-head"'));
check("...with the count on the header", /<span className="dlg-boxes-count">\{accountBoxes\.length\}<\/span>/.test(exp));
check("...in both languages", /yourBoxes: "Your PO Boxes"/.test(exp) && /yourBoxes: "صناديق البريد الخاصة بك"/.test(exp));
check("...and nothing renders when there are none", /\{accountBoxes\.length \? \(/.test(exp));
check("a long list scrolls without taking the application with it", /max-height: 264px;/.test(css));
check("an expired box is findable at a glance", /\.dlg-boxes-list li\.is-expired \{/.test(css));

console.log("\nFB-1792 — and the pulse stops drawing tables");
check("it states the number", /Say HOW MANY boxes are on the account — the number, in one sentence/.test(nxnPulse));
check("...then only what needs something doing", /ONLY the boxes that need something: expired, expiring soon/.test(nxnPulse));
check("...and never a table", /do NOT draw a table of them/.test(nxnPulse));
check("...pointing at the panel once", /the full list is in the panel beside us/.test(nxnPulse));
// "All fine" is a sentence, not a list of forty-six boxes proving it.
check("nothing outstanding is said, not proved", /rather than listing boxes to prove it/.test(nxnPulse));

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

console.log("\nFB-1795 — a two-option choice reads as one thing");
const md = readFileSync(new URL("../app/embed/[agent]/Markdown.tsx", import.meta.url), "utf8");
const schema = readFileSync(new URL("../../../packages/config/src/agent.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/embed/[agent]/page.tsx", import.meta.url), "utf8");
check("exactly two options stack", /const asPair = Boolean\(stacked\) && labels\.length === 2;/.test(md));
// Three or more are a set of choices, and a set of choices is what chips are
// for — stacking six makes a menu out of a question.
check("...three or more stay chips", /labels\.length === 2/.test(md) && !/labels\.length >= 2/.test(md));
check("...full width, in the order they are meant to be read", /\.dlg-chat-buttons\.is-pair \{\s*\n\s*flex-direction: column;/.test(css));
check("...and each is a 44px target", /\.dlg-chat-buttons\.is-pair \.dlg-chat-btn \{[\s\S]{0,120}min-height: 44px;/.test(css));
// The renderer is shared, so this is a setting rather than a deploy: one
// tenant's feedback is not a reason to change another tenant's screens.
check("it is per agent, not global", /stackedChoices: z\.boolean\(\)\.optional\(\)/.test(schema));
check("...reaching the widget", /stackedChoices: d\.stackedChoices/.test(page));
check("...and passed to both renderers", /stackChoices=\{agent\.stackedChoices\}/.test(exp) && (exp.match(/stackChoices=\{agent\.stackedChoices\}/g) ?? []).length === 2);
check("...through the typewriter too, which wraps the other", /stackChoices=\{stackChoices\} \/>/.test(md));
check("off by default, so nothing changes for an agent that did not ask", !/stackedChoices: z\.boolean\(\)\.default\(true\)/.test(schema));

console.log("\nSigning out of us is not signing out of UAE PASS");
/**
 * "I signed out and when I signed in, my UAE PASS was already signed in."
 * Exactly so — UAE PASS is single sign-on, our sign-out ends OUR session, and
 * the browser keeps theirs. The next tap walks straight back in as the same
 * person, which is the one thing somebody who signed out to change Emirates ID
 * does not want.
 */
const uaepass = readFileSync(new URL("../lib/uaepass.ts", import.meta.url), "utf8");
const loginRoute = readFileSync(new URL("../app/api/uaepass/login/route.ts", import.meta.url), "utf8");
check("the authorize call can force a fresh login", /if \(opts\.forceLogin\) u\.searchParams\.set\("prompt", "login"\);/.test(uaepass));
check("...driven by an explicit switch, not by default", /const forceLogin = req\.nextUrl\.searchParams\.get\("switch"\) === "1";/.test(loginRoute));
check("...and passed through", /buildAuthorizeUrl\(resolveRedirectUri\(origin\), state, tenant, \{ forceLogin \}\)/.test(loginRoute));
// A first sign-in still gets the benefit of an existing session — that is what
// single sign-on is for. Only the person who asked to change accounts is asked
// to authenticate again.
check("a sign-out arms it", /switchAccount\.current = true;/.test(exp));
check("...the next sign-in spends it", /const swap = switchAccount\.current \? "&switch=1" : "";\s*\n\s*switchAccount\.current = false;/.test(exp));
check("...and an ordinary first sign-in does not carry it", /\$\{mock\}\$\{swap\}/.test(exp));
// The belt to prompt=login's braces: the only thing that genuinely clears the
// SSO cookie rather than asking the IdP to ignore it.
check("the UAE PASS logout endpoint is available to callers", /export function buildLogoutUrl/.test(uaepass));
check("...and refuses to build one for an unconfigured tenant", /if \(!uaePassConfigured\(tenant\)\) return null;/.test(uaepass));

// prompt=login asks UAE PASS to IGNORE a session it still holds. They do not
// honour it: "I literally clicked sign out and when I clicked sign in, it
// signed me in instantly." Only a top-level navigation on their origin can
// clear a cookie there.
const logoutRoute = readFileSync(new URL("../app/api/uaepass/logout/route.ts", import.meta.url), "utf8");
check("signing out opens UAE PASS's own logout", /openExternal\(`\/api\/uaepass\/logout\?agent=\$\{encodeURIComponent\(agent\.slug\)\}`/.test(exp));
check("...only where UAE PASS is the way in", /if \(agent\.uaePassEnabled\) \{/.test(exp));
check("...redirecting to their endpoint, not ours", /buildLogoutUrl\(`\$\{origin\}\/uaepass\/done`/.test(logoutRoute));
check("...and coming back to a page that closes itself", /window\.close\(\)/.test(readFileSync(new URL("../app/uaepass/done/page.tsx", import.meta.url), "utf8")));
// An unconfigured tenant must still get its window closed rather than an error.
check("nothing to log out of still closes the window", /NextResponse\.redirect\(target \?\? `\$\{origin\}\/uaepass\/done`\)/.test(logoutRoute));
check("prompt=login stays as the belt to that braces", /switchAccount\.current = true;/.test(exp));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
