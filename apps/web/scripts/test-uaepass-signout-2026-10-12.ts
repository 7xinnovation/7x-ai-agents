/**
 * The UAE PASS session is ended at sign-out — raised as a security issue on
 * 12 October 2026 ("the UAE PASS session must be killed at sign out").
 *
 * Static checks on the shape of the fix, so the properties that make it hold
 * cannot drift: the window opens before anything is awaited, UAE PASS is the
 * first hop and the one we wait for, the done page reports and returns, the
 * server forces a fresh login after any sign-out, and the app is told where
 * the logout lives. Run from apps/web: npx tsx scripts/test-uaepass-signout-2026-10-12.ts
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = (p: string) => readFileSync(resolve(here, p), "utf8");
let passed = 0, failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name}`, detail ?? ""); }
}

const exp = src("../app/embed/[agent]/Experience.tsx");
const done = src("../app/uaepass/done/page.tsx");
const logout = src("../app/api/uaepass/logout/route.ts");
const login = src("../app/api/uaepass/login/route.ts");
const callback = src("../app/api/uaepass/callback/route.ts");
const signout = src("../app/api/embed/signout/route.ts");
const uaepass = src("../lib/uaepass.ts");

console.log("\nThe window, and when it opens");
const fn = exp.slice(exp.indexOf("const signOut = useCallback(async () => {"), exp.indexOf("}, [agent.slug, agent.uaePassEnabled, agent.hostLoginUrl, agent.hostLogoutUrl, locale]);"));
check("signOut exists with the dependencies it reads", fn.length > 1000);
const openAt = fn.indexOf("opened = openExternal(uaePassLogout, SIGNOUT_WINDOW);");
const code = fn.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const openAtInCode = code.indexOf("opened = openExternal(uaePassLogout, SIGNOUT_WINDOW);");
const firstAwait = code.search(/\bawait\b/);
check("the window opens on UAE PASS's logout BEFORE the first await — inside the click, as Safari and iOS require", openAtInCode > 0 && firstAwait > openAtInCode, { openAtInCode, firstAwait });
check("...and before our own session request is sent", openAt < fn.indexOf('fetch("/api/embed/signout"'));
check("that request is keepalive, so a tab that navigates away still delivers it", /fetch\("\/api\/embed\/signout", \{\s*method: "POST",\s*keepalive: true,/.test(fn));
check("where UAE PASS is not configured the portal is opened first instead", /else if \(hostOrigin\) \{\s*opened = openExternal\(hostSignoutUrl, SIGNOUT_WINDOW\);\s*onPortalAlready = opened !== null;/.test(fn));

console.log("\nUAE PASS first, observed rather than timed");
check("the widget listens for the done page before anything can answer", /const heardDone = \(e: MessageEvent\) => \{\s*if \(e\.origin !== window\.location\.origin\) return;/.test(fn) && /m\.action === "uaepass-logged-out"\) uaePassDone = true;/.test(fn));
check("it waits for that report, a closed window, or eight seconds — whichever comes first", /if \(uaePassDone \|\| opened!\.closed \|\| Date\.now\(\) - started > 8000\) \{ resolve\(\); return; \}/.test(fn));
check("...and says in the console which of the three it was", /UAE PASS session ended \(reported by \/uaepass\/done\)/.test(fn) && /did not report back within 8s/.test(fn));
check("only then does the same window go to the portal, then the portal's logout, then close", /toPortal\(opened\);\s*$/.test(fn) && /const toPortal = \(win: ExternalWindow \| null\) => \{\s*if \(!hostOrigin \|\| !win\) \{ toHostLogout\(win\); return; \}/.test(fn) && /window\.setTimeout\(\(\) => closeWindow\(win\), 2000\);/.test(fn));
check("a window the customer closed has issued the logout and is left alone", /if \(opened!\.closed\) return;/.test(fn));
check("the old 3.5-second close and the old last-hop toUaePass are gone", !/3500/.test(fn) && !/toUaePass/.test(fn));

console.log("\nThe done page");
check("it tells the window that opened it, on our origin only", /window\.opener\.postMessage\(\{ source: "dialog", action: "uaepass-logged-out" \}, window\.location\.origin\);/.test(done));
check("opened as the tab itself, it carries the tab back to the widget's own path", /window\.sessionStorage\.getItem\("dlg-signout-return"\)/.test(done) && /if \(!told && back && \/\^\\\/\(\?!\\\/\)\/\.test\(back\)\) \{\s*window\.location\.replace\(back\);/.test(done));
check("...a path on this origin only, never a scheme or another host", (() => { const re = /^\/(?!\/)/; return re.test("/embed/nxn-dialog?locale=en&cid=1") && !re.test("//evil.example/x") && !re.test("https://evil.example") && !re.test("javascript:alert(1)"); })());

console.log("\nWhen no window can open");
check("a tab of its own goes to UAE PASS's logout itself and remembers the way back", /const standalone = !isNative\(\) && window\.top === window\.self;/.test(fn) && /window\.sessionStorage\.setItem\("dlg-signout-return", back\)/.test(fn) && /window\.location\.assign\(uaePassLogout\);/.test(fn));
check("a frame says so plainly and relies on the server's prompt=login", /the sign-out window was blocked, so the UAE PASS session was NOT ended from here/.test(fn));

console.log("\nThe server's belt: the next sign-in asks again");
check("the logout route sets uaepass_relogin for a day, HttpOnly", /res\.cookies\.set\("uaepass_relogin", "1", RELOGIN_COOKIE\);/.test(logout) && /httpOnly: true,[\s\S]{0,120}maxAge: 60 \* 60 \* 24,/.test(logout));
check("so does our own sign-out route — the app's path opens no window", /res\.cookies\.set\("uaepass_relogin", "1", RELOGIN_COOKIE\);/.test(signout));
check("the login route forces a fresh UAE PASS login on it", /const forceLogin = req\.nextUrl\.searchParams\.get\("switch"\) === "1" \|\| req\.cookies\.get\("uaepass_relogin"\)\?\.value === "1";/.test(login) && /if \(opts\.forceLogin\) u\.searchParams\.set\("prompt", "login"\);/.test(uaepass));
check("a completed sign-in spends it, on both return paths", (callback.match(/if \(\(params\.uaepass \?\? "ok"\) === "ok"\) res\.cookies\.delete\("uaepass_relogin"\);/g) ?? []).length === 2);

console.log("\nThe app and the logout URL");
check("the native host is told where UAE PASS's logout is", /postNative\(\{ source: "dialog-native", action: "signed-out", uaePassLogoutUrl: agent\.uaePassEnabled \? uaePassLogoutUrl : null \}\);/.test(fn));
check("the logout URL is UAE PASS's own, returning to /uaepass/done", /new URL\(`\$\{c\.base\}\/idshub\/logout`\);\s*u\.searchParams\.set\("redirect_uri", redirectTo\);/.test(uaepass) && /buildLogoutUrl\(`\$\{origin\}\/uaepass\/done`/.test(logout));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
