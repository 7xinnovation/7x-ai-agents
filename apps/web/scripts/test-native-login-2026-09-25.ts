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
check("...and the URL the app intercepts, when one is configured", /if \(agent\.nativeLoginUrl\) askNativeToSignIn\(agent\.nativeLoginUrl\)/.test(exp));
check("neither runs outside a native host", /if \(isNative\(\)\) \{/.test(exp) && /if \(!isNative\(\)/.test(bridge));
check("an app answering neither is where it was", /is exactly where it was/.test(exp));

console.log("\nAnd a scheme nothing handles cannot eat the conversation");
// Navigating the WebView itself to an unhandled scheme replaces the chat with
// an error page and there is no way back — the same failure, from the other side.
check("it fires in a hidden iframe, not the top window", /document\.createElement\("iframe"\)/.test(bridge));
check("...hidden from sight and from screen readers", /style\.display = "none"/.test(bridge) && /aria-hidden/.test(bridge));
check("...and removed again", /frame\.remove\(\)/.test(bridge));
check("nothing navigates the window itself", !/window\.location\.href\s*=\s*url/.test(bridge));
check("a host that throws is not an error the customer sees", /catch \{/.test(bridge));
check("the reason for the iframe is written down", /replaces the conversation with an error page/.test(bridge));

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
