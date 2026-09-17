/**
 * The mobile app bug list, 11 September — the ones that are about running
 * inside a WebView rather than a browser (8, 9, 10, 11, 14).
 *
 * None of these reproduce on a desktop, and most of them are a page assuming it
 * has something a WebView does not give it: a parent frame, an opener, a window
 * it may close, a print sheet, a microphone it is allowed to open. So the
 * checks are about what the code does when those are absent — which is the only
 * state the app is ever in.
 *
 * Run from apps/web:  npx tsx scripts/test-native-webview-2026-09-17.ts
 */
import { readFileSync } from "node:fs";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, got?: unknown) {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`); }
}

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const exp = read("../app/embed/[agent]/Experience.tsx");
const md = read("../app/embed/[agent]/Markdown.tsx");
const bridge = read("../app/embed/[agent]/nativeBridge.ts");
const voice = read("../app/embed/[agent]/useVoiceChat.ts");
const extReturn = read("../app/api/payments/ext-return/route.ts");
const receipt = read("../app/api/receipt/[reference]/route.ts");

console.log("\nIssue 11 — the app CRASHED when the mic was tapped");
// iOS kills a process that reaches for the microphone with no
// NSMicrophoneUsageDescription. getUserMedia exists in the WebView either way,
// so the feature test could not tell; the page found out by taking the app down.
check("there is a native capability gate", /export function nativeVoiceAllowed/.test(bridge));
check("a browser is unaffected by it", /if \(!isNative\(\)\) return true;/.test(bridge));
check("...and a WebView must opt in explicitly", /__dialogNativeVoice\?: unknown[\s\S]{0,120}=== true/.test(bridge));
check("the mic button consults it", /nativeVoiceAllowed\(\)/.test(voice));
check("...as part of `supported`, so nothing else has to remember", /const supported =[\s\S]{0,600}?nativeVoiceAllowed\(\)/.test(voice));

console.log("\nIssue 8 — the payment window never came back");
check("the return page tells a native host too", /window\.ReactNativeWebView\.postMessage/.test(extReturn));
check("...and follows an app deep link when one is configured", /NATIVE_RETURN_URL/.test(extReturn));
check("it stops claiming to be returning them if it is not", /msg\.textContent = /.test(extReturn));
check("...and offers a way back instead", /done\.style\.display = "inline-block"/.test(extReturn));
check(
  "the chat treats the app coming back to the foreground as the return",
  /document\.addEventListener\("visibilitychange", onVisible\)/.test(md)
);
check("...only while a payment window is open", /if \(!opened \|\| returned \|\| !isNative\(\)\) return;/.test(md));
check("...and only in the app, because a desktop tab switch is not a return", /!isNative\(\)/.test(md));

console.log("\n...and the button that replaced it did nothing either (17 September)");
// "When I click on back to chat nothing happens, only when I click on the X on
// the top left." It called the same close() that had already failed a second
// earlier. A button that cannot work is worse than no button.
check("the button is only offered when a deep link can carry it", /if \(appLink\) \{[\s\S]{0,260}?done\.style\.display = "inline-block"/.test(extReturn));
check("otherwise the page names the control the browser drew", /tapX/.test(extReturn));
check("...in both languages", /اضغط/.test(extReturn));
check("and reaching that point is proof, not a guess", /it is proof[\s\S]{0,80}cannot/.test(extReturn));

console.log("\nIssue 9 — Print / Save as PDF did nothing");
check("the button no longer calls print and hopes", !/onclick="window\.print\(\)"/.test(receipt));
check("it finds out whether the sheet opened", /beforeprint/.test(receipt) && /matchMedia\("print"\)/.test(receipt));
check("a native host is offered the job", /action: "print"/.test(receipt));
check("and the customer is told where the control is when nothing opened", /printHint/.test(receipt));
check("...in both languages", /لحفظ هذا الإيصال/.test(receipt));

console.log("\nIssue 10 — a new chat signed the customer out");
check("a native sign-in is remembered as one", /const nativeIdentity = useRef\(false\)/.test(exp));
check("redeeming a handoff sets it", /nativeIdentity\.current = true;/.test(exp));
check("a new chat asks the app for another code", /postNative\(\{ action: "signin-needed", reason: "new-chat" \}\)/.test(exp));
check("...rather than dropping them to guest straight away", /if \(uaePass\.current\) return;/.test(exp));
check("and gives up honestly if the app cannot help", /nativeIdentity\.current = false;\s*setAuthenticated\(false\);/.test(exp));
check("a code arriving from the app is redeemed", /e\.action === "handoff" && e\.handoff/.test(exp));
check("the event shape carries it", /handoff\?: string;/.test(bridge));
check("signing in asks the app first", /postNative\(\{ action: "signin-needed", reason: "customer-asked" \}\)/.test(exp));
check("the control that caused it no longer looks like reload", /<NotePencil size=\{16\}/.test(exp));

console.log("\nIssue 14 — English left behind after a language switch");
check(
  "the status line keeps the EVENT, not the sentence",
  /const \[toolEvent, setToolEvent\] = useState/.test(exp) && !/setToolStatus/.test(exp)
);
check("...and is translated at render time", /toolEvent \? toolStatusLabel\(toolEvent, locale === "ar"\) : null/.test(exp));
for (const [what, re] of [
  ["the voice bar", /t\.voiceConnecting/],
  ["the mic button", /aria-label=\{voice\.active \? t\.voiceStop : t\.voiceStart\}/],
  ["the send button", /aria-label=\{t\.send\}/],
  ["the payment card", /const p = PAY_STR\[locale === "ar" \? "ar" : "en"\]/],
] as const) {
  check(`${what} speaks the customer's language`, re.test(what === "the payment card" ? md : exp));
}
check("every new English string has an Arabic twin", (() => {
  const en = exp.slice(exp.indexOf("  en: {"), exp.indexOf("  ar: {"));
  const ar = exp.slice(exp.indexOf("  ar: {"));
  const keys = (s: string) => new Set([...s.matchAll(/^\s{4}(\w+):/gm)].map((m) => m[1]!));
  const missing = [...keys(en)].filter((k) => !keys(ar).has(k));
  return missing.length === 0 || (console.log(`         missing in ar: ${missing.join(", ")}`), false);
})());

console.log("\nRenting a new box, for a customer who already has forty (17 September)");
{
  const route = read("../app/api/chat/route.ts");
  const prompt = read("../../../packages/core/src/ai/prompt.ts");
  check("the pulse closes with renting among the options", /ALWAYS include renting a NEW box among the options/.test(route));
  check("...and does not fold renting into renewing", /never fold renting into renewing/.test(route));
  check(
    "the rule also holds on every later turn, not just the pulse",
    /A NEW one is not an EXISTING one/.test(prompt)
  );
  check(
    "...and says plainly not to answer it with their existing boxes",
    /Never answer it by listing the boxes they already have/.test(prompt)
  );
}

console.log("\nThe account pulse, which is the longest wait in the product (issue 5)");
check("the assistant speaks before it looks", /FIRST, before calling any tool, write ONE short line of greeting/.test(read("../app/api/chat/route.ts")));
check("and the account lookup finally has a label", /boxes_for_customer\|companies_for_customer\|account/.test(exp));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
