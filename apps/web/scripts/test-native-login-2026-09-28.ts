/**
 * The sign-in button, inside the app — one request, and only one (2026-09-28).
 *
 * "This button on mobile does not work as it opens the web and does not
 * redirect." Not fixable inside the WebView: the portal owns its own UAE PASS
 * client and leaves the token in its own localStorage, and in the app there is
 * no host page and no loader to read it. The widget has to ask the app.
 *
 * On 25 September it asked THREE ways, because we did not know which the app
 * implemented: the documented postMessage, a custom scheme (`app://login`) for
 * an app with a URL interceptor and no message handler, and then UAE PASS.
 * Their developer has since built the handler and reported what the other two
 * cost:
 *
 *     onMessage works fine. But seems like you are still trying to redirect to
 *     app://login ... Error opening URL: app://login. Unable to open URL.
 *
 * So the scheme is gone — an unhandled one is a native error dialog on iOS, not
 * a silent fallback — and so is falling through to UAE PASS, which would have
 * opened a browser behind the app's own sign-in screen for a single tap.
 *
 * And the failure banner he photographed ("Sign-in could not be started inside
 * the app") was a six-second timer over a sign-in that was working. Signing in
 * inside the app is a journey; six seconds is a pop-up's patience, not a
 * customer's.
 *
 * Run from apps/web:  npx tsx scripts/test-native-login-2026-09-28.ts
 */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`); }
};
const bridge = readFileSync(new URL("../app/embed/[agent]/nativeBridge.ts", import.meta.url), "utf8");
const exp = readFileSync(new URL("../app/embed/[agent]/Experience.tsx", import.meta.url), "utf8");
const schema = readFileSync(new URL("../../../packages/config/src/agent.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/embed/[agent]/page.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

console.log("\nOne way of asking");
check("the documented message is sent", /postNative\(\{ action: "signin-needed", reason: "customer-asked" \}\)/.test(exp));
check("...only inside a native host", /if \(isNative\(\)\) \{[\s\S]{0,200}postNative\(\{ action: "signin-needed"/.test(exp));
// Nothing between the ask and the return but the line that acknowledges it —
// and, where the fallback is on, UAE PASS and nothing else. No scheme, no
// second control, no third way of asking.
check("...and nothing else is attempted in between",
  !/askNativeToSignIn/.test(exp.slice(exp.indexOf('postNative({ action: "signin-needed"'), exp.indexOf("armSignInFallback(tried);"))));

console.log("\nAnd the scheme that produced a native error is gone");
// "Error opening URL: app://login. Unable to open URL: app://login."
check("nothing navigates to it", !/app:\/\/login/.test(exp.replace(/\/\*\*[\s\S]*?\*\//g, "")));
check("the helper that did is removed", !/export function askNativeToSignIn/.test(bridge));
check("...and is not imported any more", !/askNativeToSignIn/.test(exp));
check("no hidden iframe is left behind", !/document\.createElement\("iframe"\)/.test(bridge));
check("nor a main-frame navigation to a scheme", !/window\.location\.href = url/.test(bridge));
check("the setting no longer reaches the widget", !/nativeLoginUrl/.test(page));
// Kept in the schema so a definition still carrying it parses; nothing reads it.
check("...and is marked disused rather than silently still there", /DISUSED \(28 September\)/.test(schema));
check("why it went is written down where the next person will look", /Unable to open URL/.test(bridge));

console.log("\nNor is UAE PASS opened behind the app's own sign-in");
// Falling through posted open-url as well: the app's sign-in screen AND a
// browser, for one tap.
const nativeBranch = exp.slice(exp.indexOf('if (isNative()) {\n      tried.push("asked the app");'));
check("the native branch returns before the UAE PASS route", nativeBranch.indexOf("return;") < nativeBranch.indexOf("agent.uaePassEnabled"));
check("...and the host portal is still skipped in the app", /const hostLoginUsable = Boolean\(agent\.hostLoginUrl\) && !isNative\(\);/.test(exp));
check("a browser still opens UAE PASS as it did", /openExternal\(`\$\{base\}&popup=1`/.test(exp));

console.log("\nThe tap is acknowledged before the app answers");
// "When I click the sign in still nothing is happening" — a fourth time. The
// request goes out correctly every time; what was missing is the button saying
// so, which never should have depended on the far end.
check("a neutral line appears straight away", /setAuthInfo\(\s*locale === "ar"[\s\S]{0,120}Opening sign-in in the app/.test(exp));
check("...in both languages", /جارٍ فتح تسجيل الدخول في التطبيق/.test(exp));
check("...as information, not as a warning", /dlg-auth-banner is-info/.test(exp));
check("...with nothing to act on", /<div className="dlg-auth-banner is-info">\s*\n\s*<span>\{authInfo\}<\/span>\s*\n\s*<\/div>/.test(exp));
check("...and it is styled apart from the amber one", /\.dlg-auth-banner\.is-info \{/.test(css));
check("signing in clears it", /setAuthReason\(null\);\s*\n\s*setAuthInfo\(null\);\s*\n\s*\}\s*\n\s*\}, \[authenticated\]\);/.test(exp));
check("...and so does the warning taking over", /setAuthInfo\(null\);\s*\n\s*const advice = inApp/.test(exp));

console.log("\nA button that does nothing still says so — later");
check("a timer is armed whichever route was taken", /armSignInFallback\(tried\)/.test(exp));
check("...and says the app did not answer", /Sign-in could not be started inside the app/.test(exp));
check("...in both languages", /تعذّر بدء تسجيل الدخول داخل التطبيق/.test(exp));
check("...telling them the one thing they can do", /sign in from the app, then come back/.test(exp));
check("it covers the browser too", /The sign-in window did not open/.test(exp));
check("...and says which of the two it was", /inApp \? "in-app" : "browser"/.test(exp));
/**
 * The correction. Six seconds is how long a pop-up takes to fail; it is not how
 * long a customer takes to sign in through their app, UAE PASS and an OTP — and
 * the amber banner landed on top of a sign-in that was working.
 */
check("the app is given far longer than a pop-up is", /inApp \? 45000 : 6000/.test(exp));
check("what was tried is still reported, for whoever is testing", /tried\.join\(", "\)/.test(exp));
check('...and "asked the app" is what it says', /tried\.push\("asked the app"\)/.test(exp));
check("a late answer cancels it", /if \(authenticated && nativeAskTimer\.current\)/.test(exp));
check("...and clears the message with it", /setAuthReason\(null\)/.test(exp));
check("the timer reads auth as it stands, not as it was rendered", /authenticatedRef\.current/.test(exp));

console.log("\nWhat the app sends back is unchanged");
check("a token injected at load is still read", /__dialogNativeToken/.test(bridge));
check("...and the short-lived handoff code preferred over it", /__dialogNativeHandoff/.test(bridge));
check("open-url still works, for payments", /action: "open-url"/.test(bridge));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
