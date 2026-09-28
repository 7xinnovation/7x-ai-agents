/**
 * The sign-in button, inside the app (2026-09-25).
 *
 * "This button on mobile does not work as it opens the web and does not
 * redirect." Correct, and not fixable inside the WebView: the portal owns its
 * own UAE PASS client and leaves the token in its own localStorage, and in the
 * app there is no host page and no loader to read it.
 *
 * The widget already asks the app to do it — { action: "signin-needed" } — and
 * their app is not listening. Their developer asked for a URL he already
 * intercepts. Both are sent now.
 *
 * Run from apps/web:  npx tsx scripts/test-native-login-2026-09-25.ts
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

console.log("\nBoth ways of asking, so whichever the app implements works");
check("the documented message is still sent", /postNative\(\{ action: "signin-needed", reason: "customer-asked" \}\)/.test(exp));
// Anchored on the call, not on the line it sits on: it gained a `tried.push`
// above it when the button started reporting itself.
check("...and the URL the app intercepts, when one is configured", /askNativeToSignIn\(agent\.nativeLoginUrl,/.test(exp));
check("neither runs outside a native host", /if \(isNative\(\)\) \{/.test(exp) && /if \(!isNative\(\)/.test(bridge));
check("an app answering neither is where it was", /is exactly where it was/.test(exp));

console.log("\nAnd a scheme nothing handles cannot eat the conversation");
// Navigating the WebView itself to an unhandled scheme replaces the chat with
// an error page and there is no way back — the same failure, from the other side.
check("it fires in a hidden iframe, not the top window", /document\.createElement\("iframe"\)/.test(bridge));
check("...hidden from sight and from screen readers", /style\.display = "none"/.test(bridge) && /aria-hidden/.test(bridge));
check("...and removed again", /frame\.remove\(\)/.test(bridge));
/**
 * Their developer confirmed he intercepts every request, main frame or not, and
 * it still did nothing — so the subframe navigation never reached him. That is
 * the known limit of the iframe trick on WKWebView, and TestFlight is iOS.
 */
check("the main frame is tried only after the subframe gets no answer", /if \(answered\(\)\) return;[\s\S]{0,120}window\.location\.href = url/.test(bridge));
check("...after the iframe, not instead of it", bridge.indexOf("createElement(\"iframe\")") < bridge.indexOf("window.location.href = url"));
check("...and never once something has answered", /askNativeToSignIn\(agent\.nativeLoginUrl, \(\) => authenticatedRef\.current\)/.test(exp));
// Flattened first: the sentence wraps across comment lines.
const bridgeProse = bridge.replace(/\s*\n\s*\*\s?/g, " ");
check("the platform difference is written down", /does not reliably hand a SUBFRAME navigation/.test(bridgeProse));
check("a host that throws is not an error the customer sees", /catch \{/.test(bridge));
check("the reason for the iframe is written down", /replaces the conversation with an error page/.test(bridge));

console.log("\nAnd a button that does nothing says so");
// "When I click the login button nothing happens on the mobile version." All
// three requests had fired correctly and the app acted on none of them.
check("a timer starts when the button is tapped", /nativeAskTimer\.current = window\.setTimeout/.test(exp));
check("...and says the app did not answer", /Sign-in could not be started inside the app/.test(exp));
check("...in both languages", /تعذّر بدء تسجيل الدخول داخل التطبيق/.test(exp));
check("...telling them the one thing they can do", /sign in from the app, then come back/.test(exp));
/**
 * Three ways this fails silently — a host that ignores us, a pop-up that never
 * opens, a scheme nothing handles — and the timer used to cover only the first.
 */
check("it covers the browser too, not just the app", /The sign-in window did not open/.test(exp));
check("...and says which of the two it was", /inApp \? "in-app" : "browser"/.test(exp));
check("every attempt is recorded", /tried\.push\("asked the app"\)/.test(exp) && /tried\.push\(`opened \$\{agent\.nativeLoginUrl\}`\)/.test(exp));
// Inside the app openExternal cannot open anything — it posts to the host — so
// claiming it opened reads as our failure and misdirects the diagnosis.
check("...and does not claim to have opened what it only asked for", /asked the app to open UAE PASS/.test(exp));
check("...while a browser still says opened", /"opened UAE PASS"/.test(exp));
check("...and the list is shown with the message", /tried\.join\(", "\)/.test(exp));
// An app that answers slowly must never be told it did not.
check("a late answer cancels it", /if \(authenticated && nativeAskTimer\.current\)/.test(exp));
check("...and clears the message with it", /setAuthReason\(null\)/.test(exp));
check("the timer reads auth as it stands, not as it was rendered", /authenticatedRef\.current/.test(exp));

console.log("\nThe setting");
check("it is declared", /nativeLoginUrl: z/.test(schema));
// A custom scheme is not a URL by zod's definition, which is why it cannot
// simply reuse hostLoginUrl.
check("...not as a URL, because a scheme is not one", /expected a scheme like app:\/\/login/.test(schema));
check("...and is bounded, so nothing arbitrary is navigated to", /\{0,200\}/.test(schema));
check("it reaches the widget", /nativeLoginUrl: d\.nativeLoginUrl/.test(page));
check("what the app sends BACK is unchanged", /short-lived handoff code/.test(schema));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
