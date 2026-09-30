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

/**
 * The first pass at FB-1791 went to 44px targets and 20px icons — past the 24px
 * minimum, short of the 48px recommendation. Emirates Post restated the
 * standard, so the assertions live in "as they restated it" below and this
 * section is gone rather than left asserting a number we have since moved off.
 */

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

console.log("\nFB-1795 — a two-option choice reads as one thing");
const md = readFileSync(new URL("../app/embed/[agent]/Markdown.tsx", import.meta.url), "utf8");
const schema = readFileSync(new URL("../../../packages/config/src/agent.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/embed/[agent]/page.tsx", import.meta.url), "utf8");
check("exactly two options, and only a CONFIRMATION, stack",
  /const asPair = Boolean\(stacked\) && labels\.length === 2 && DECLINES\.test\(labels\[1\] \?\? ""\);/.test(md));
/**
 * The first rule stacked EVERY two-option prompt, which is what FB-1795 asked
 * for read literally and wrong in practice: "Rent a new personal PO Box / Ask a
 * question about services" is not a confirmation, it is two things a customer
 * might want, and full width it reads as a wall.
 *
 * A confirmation's second option DECLINES. A menu's offers something else.
 */
{
  const decl = /const DECLINES =\s*\n?\s*(\/[\s\S]*?\/[a-z]*);/.exec(md);
  check("the decline is what tells them apart", Boolean(decl));
  const body = decl ? decl[1]! : "";
  const cut = body.lastIndexOf("/");
  const re = decl ? new RegExp(body.slice(1, cut), body.slice(cut + 1)) : /$^/;
  for (const l of ["No, I meant something else", "No, skip", "Not now", "Cancel", "Don't add one", "لا، شكراً", "ليس الآن"]) {
    check(`  "${l}" declines`, re.test(l));
  }
  for (const l of ["Ask a question about services", "Rent a new personal PO Box", "Bank transfer (Virtual IBAN)", "Choose a different branch", "Yes, rent a new one"]) {
    check(`  "${l}" does not`, !re.test(l));
  }
}
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

console.log("\nThe host page keeps offering the token they signed out of");
/**
 * box-stg.emiratespost.ae runs our relay: it reads the portal's own token and
 * posts it into the widget, repeatedly, because that is how a customer already
 * signed in to Emirates Post arrives here signed in.
 *
 * Signing out of the chat does not sign them out of the portal, so the token is
 * still there and still being offered. `signedOut` blocked it — until they
 * pressed Sign in, which lifted the flag. The relay's next poll landed before
 * UAE PASS was anywhere near and they were back in as the same person. Three
 * reports of "it signed me in instantly", while I was fixing UAE PASS.
 */
check("the token itself is refused, not the channel", /const dismissedHostToken = useRef<string \| null>\(null\);/.test(exp));
check("...remembered at sign-out", /if \(uaePass\.current\) \{\s*\n\s*dismissedHostToken\.current = uaePass\.current;/.test(exp));
check("...and refused on the relay's path", /if \(isDismissed\(token\)\) return;/.test(exp));
check("...on both intake paths", (exp.match(/if \(isDismissed\(token\)\) return;/g) ?? []).length === 2);
// Pressing Sign in is a request to choose an identity, not consent to the
// previous one — which is exactly what lifting `signedOut` there amounted to.
check("...even after they have pressed Sign in", exp.indexOf("signedOut.current = false;") < exp.lastIndexOf("isDismissed"));
// A sign-out a refresh undoes is not a sign-out: the host's token survives the
// reload, so the refusal has to as well.
check("it survives a reload", /window\.localStorage\.setItem\(dismissedKey, fingerprint\(uaePass\.current\)\)/.test(exp));
check("...as a fingerprint, not the token", /function fingerprint\(token: string\): string \{/.test(exp));
// The whole reason they signed out: to come back as somebody else.
check("a DIFFERENT token is still taken", /A different token: they have signed in somewhere as somebody/.test(exp));
check("...and clears the refusal with it", /if \(stored\) \{ try \{ window\.localStorage\.removeItem\(dismissedKey\); \}/.test(exp));

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
/**
 * AND THE HOST PORTAL IS SKIPPED WHEN IT IS ARMED.
 *
 * Emirates Post's agent has a hostLoginUrl, so in a browser signIn returned at
 * that branch and never reached the UAE PASS one — making prompt=login and
 * &switch=1 dead code on the very agent they were written for. Worse, the
 * portal is still signed in, so opening it handed back the identity the
 * customer had just signed out of.
 */
check("...and the portal is skipped while it is",
  /!\(switchAccount\.current && agent\.uaePassEnabled && agent\.uaePassOwnFlow\)/.test(exp));
/**
 * But only where OUR UAE PASS callback is one the tenant's client accepts.
 * Emirates Post's production client is registered to their own portal, so
 * skipping it sent the customer to UAE PASS with an unregistered redirect and
 * they got "Sorry! Looks like something went wrong at our end".
 */
const uaepassLib = readFileSync(new URL("../lib/uaepass.ts", import.meta.url), "utf8");
check("...and whether our callback is accepted is computed, not assumed",
  /export function uaePassRedirectsToUs\(origin: string, tenant\?: string\): boolean/.test(uaepassLib));
check("...from the registered redirect's origin", /new URL\(registered\)\.origin === new URL\(origin\)\.origin/.test(uaepassLib));
// Nothing registered in config: we have always used our own callback.
check("...defaulting to ours where nothing is registered", /if \(!registered\) return true;/.test(uaepassLib));
check("...and reaching the widget", /uaePassOwnFlow: uaePassRedirectsToUs\(origin, d\.tenantSlug\)/.test(readFileSync(new URL("../app/embed/[agent]/page.tsx", import.meta.url), "utf8")));
/**
 * And the flag survives an abandoned attempt. Spending it on the first click
 * meant a second click went back through the portal — which signed them in as
 * the person they had just signed out of.
 */
check("the switch is not spent by merely opening the door",
  /const swap = switchAccount\.current \? "&switch=1" : "";\s*\n(?!\s*switchAccount\.current = false;)/.test(exp));
check("...it is spent when they are actually signed in",
  /if \(authenticated\) switchAccount\.current = false;/.test(exp));
check("...so the UAE PASS branch is actually reachable after a sign-out",
  exp.indexOf("const hostLoginUsable") < exp.indexOf('const swap = switchAccount.current ? "&switch=1" : "";'));
// An ordinary first sign-in still goes through the portal — that is the right
// door for somebody already signed in to Emirates Post.
check("...but an ordinary sign-in still uses the portal", /THE PORTAL IS THE THING HOLDING THE IDENTITY THEY JUST SIGNED OUT OF/.test(exp));
// It used to be spent HERE, on the click. That was the second-click bug — see
// "the switch is not spent by merely opening the door" below.
check("...the next sign-in carries it", /const swap = switchAccount\.current \? "&switch=1" : "";/.test(exp));
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
// On production UAE PASS ignored our redirect_uri and sent the browser to the
// URI registered against the Emirates Post client — their portal dashboard —
// so our self-closing page never ran and the window sat there saying
// "Welcome EMRE!" to somebody who had just signed out.
check("the window is closed by us, not by where it landed", /if \(win\) window\.setTimeout\(\(\) => \{ try \{ win\.close\(\); \}/.test(exp));
check("...and that is written down where the next person will wonder", /WHERE UAE PASS SENDS THE BROWSER IS NOT OURS TO DECIDE/.test(logoutRoute));
check("prompt=login stays as the belt to that braces", /switchAccount\.current = true;/.test(exp));

console.log("\nFB-1800 — the display face is for headlines only");
// The arrows pointed at "Your application" and "Nothing to assemble yet" — a
// panel title and an empty state, neither of which is a headline. A display
// face set at 13-15px is being asked to do a job it was not cut for.
check("the panel title is no longer set in it", !/\.dlg-case-head h2,/.test(css));
check("...nor the empty state", !/\.dlg-empty h4 \{\s*\n\s*font-family: var\(--c-font-heading/.test(css));
check("the brand name keeps it — that is the headline", /\.dlg-brand-name \{\s*\n\s*font-family: var\(--c-font-heading/.test(css));
check("...and Arabic still overrides it", /\.dlg-root\[dir="rtl"\] \.dlg-brand-name \{/.test(css));
check("the reason is written down", /HEADLINES ONLY \(FB-1800\)/.test(css));

console.log("\nFB-1791 — the standard as they restated it");
check("targets are 48px, the recommendation not the floor", /\.dlg-chip \{[\s\S]{0,260}height: 48px;/.test(css));
check("...square at 48 when icon-only", /\.dlg-chip\.icon-only \{\s*\n\s*width: 48px;/.test(css));
check("icons are 24px, the minimum they gave", !/size=\{20\} weight=\{iconWeight\}/.test(exp) && /size=\{24\} weight=\{iconWeight\}/.test(exp));

console.log("\nFB-1796 — start over, said as start over");
check("the pen is gone", !/NotePencil/.test(exp));
check("...replaced with a start-over icon", /<ArrowCounterClockwise size=\{24\} weight=\{iconWeight\} \/>/.test(exp));
check("...still labelled, which is where a phone reads it", /aria-label=\{t\.reset\}/.test(exp));

console.log("\nFB-1797 — the map frames the branches, not the customer");
const map = readFileSync(new URL("../app/embed/[agent]/ChatMap.tsx", import.meta.url), "utf8");
// Choose Abu Dhabi from Dubai and fitBounds zoomed out to cover both, opening
// on a stretch of desert between them.
check("the view centres on a branch", /const center = \{ lat: branches\[0\]!\.lat, lng: branches\[0\]!\.lng \};/.test(map));
check("...and the customer's pin only joins the bounds if they are near", /if \(nearby\) bounds\.extend\(\[userLoc\.lng, userLoc\.lat\]\);/.test(map));
check("...with 'near' defined, not assumed", /const NEAR_KM = 60;/.test(map));
check("their pin is still drawn either way", /setText\(t\.youAreHere\)/.test(map));
// "Nearest branches to you" described the sort order and was read as the
// contents, with Abu Dhabi's branches under it.
check("the heading names the emirate instead of claiming proximity", /\{nearby \? t\.nearest : emirateName \? t\.inEmirate\(emirateName\) : t\.branches\}/.test(map));
check("...in both languages", /inEmirate: \(e: string\) => `Branches in \$\{e\}`/.test(map) && /الفروع في/.test(map));
check("distance stays on every row", /t\.km\(b\.dist\.toFixed\(1\)\)/.test(map));

console.log("\nFB-1801 — search an area to pick a branch");
check("a search box appears once the list is long", /\{branches\.length > 6 \? \(/.test(map));
check("...matching the branch name as shown", /branches\.filter\(\(b\) => label\(b\)\.toLowerCase\(\)\.includes\(needle\)/.test(map));
// Six is a sensible preview of a list nobody asked to filter, and a wall when
// somebody did.
check("...and the six-row cap lifts while searching", /const topN = needle \? matched\.slice\(0, 20\) : matched\.slice\(0, 6\);/.test(map));
check("no match says so rather than showing nothing", /\{needle && !matched\.length \? <div className="dlg-map-status">\{t\.noMatch\}<\/div> : null\}/.test(map));
check("...in both languages", /searchArea: "Search by area or branch name"/.test(map) && /ابحث بالمنطقة أو باسم الفرع/.test(map));
check("it is disabled once a branch is chosen", /disabled=\{!!selected\}/.test(map));

console.log("\nA list of equals has no recommended answer");
// "Don't have Abu Dhabi a different colour on the emirate selection, all should
// be the same." The first option was painted as the primary action whatever the
// question, so "Which emirate?" came back with Abu Dhabi in solid blue — a
// recommendation nobody made, for a choice with no better answer.
check("only a pair gets a primary", /const hasPrimary = labels\.length === 2;/.test(md));
check("...applied to the first of the two", /className=\{`dlg-chat-btn\$\{hasPrimary && i === 0 \? " primary" : ""\}`\}/.test(md));
check("...so three or more are all the same", !/\{`dlg-chat-btn\$\{i === 0 \? " primary" : ""\}`\}/.test(md));

console.log("\nThe console's mail is not a customer's mail");
/**
 * Staging deliberately cannot email customers — the providers were removed so a
 * test could not reach a real applicant. Admin invitations went with them, and
 * an administrator could not add a colleague.
 */
const email = readFileSync(new URL("../lib/email.ts", import.meta.url), "utf8");
const invite = readFileSync(new URL("../lib/inviteEmail.ts", import.meta.url), "utf8");
const users = readFileSync(new URL("../app/api/admin/users/route.ts", import.meta.url), "utf8");
check("the console sends as its own tenant", /export const ADMIN_TENANT = "admin";/.test(email));
check("...used by the invitation", /tenant: ADMIN_TENANT \}\);/.test(invite));
check("...and by the check that decides whether to show the link", /emailConfigured\(ADMIN_TENANT\)/.test(users));
// A tenant only falls back to the SHARED account, and on staging there is no
// shared account to fall back to — so agent email stays off.
check("a tenant's own keys are looked for first", /const resend = process\.env\[`RESEND_API_KEY\$\{suffix\}`\]/.test(email));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
