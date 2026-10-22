/**
 * The browser's CAPTCHA token, from the widget to their endpoint (2026-10-21).
 *
 * Emirates Post supplied the Turnstile site key, which turns the long-standing
 * "a server cannot mint one" into a shape we can actually build: the widget runs
 * in the customer's browser inside our chat, the token travels with the chat
 * request, and `raiseEpCase` picks it up for the one call that needs it.
 *
 * The load-bearing assumption is the one at the top: a ReadableStream's `start`
 * runs synchronously inside the constructor, so AsyncLocalStorage established
 * around the constructor reaches every tool in the turn. If that ever stops
 * holding, every callback silently falls back to the mailbox again — so it is
 * asserted here against a real stream rather than trusted.
 *
 * Run from apps/web:  npx tsx scripts/test-turnstile-2026-10-21.ts
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
const envArg = process.argv.indexOf("--env");
config({
  path:
    envArg !== -1 && process.argv[envArg + 1]
      ? resolve(process.argv[envArg + 1]!)
      : resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env"),
});

import { withTurnstileToken, takeTurnstileToken, hasTurnstileToken, turnstileSiteKey } from "@/lib/turnstile";
import { raiseEpCase } from "@/lib/epCase";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => { console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : extra ?? ""); ok ? pass++ : fail++; };
const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(resolve(here, "..", p), "utf8");

// ---------------------------------------------------------------- the scope
check("outside a turn there is no token", takeTurnstileToken() === undefined);
check("and nothing claims there is", hasTurnstileToken() === false);

withTurnstileToken("tok-a", () => {
  check("inside a turn the token is there", hasTurnstileToken());
  check("and it is the one that was sent", takeTurnstileToken() === "tok-a");
  check("a second read gets nothing — Cloudflare burns it on first verify", takeTurnstileToken() === undefined);
  check("and the turn stops claiming to hold one", hasTurnstileToken() === false);
});

withTurnstileToken(undefined, () => {
  check("a turn that carried no token offers none", takeTurnstileToken() === undefined);
});
withTurnstileToken("", () => {
  check("an empty string is not a token", takeTurnstileToken() === undefined);
});

// Two customers mid-turn at once must never see each other's token. This is the
// whole reason the token is request-scoped rather than a module variable.
{
  const seen: (string | undefined)[] = [];
  await Promise.all([
    withTurnstileToken("tok-1", async () => {
      await new Promise((r) => setTimeout(r, 20));
      seen.push(takeTurnstileToken());
    }),
    withTurnstileToken("tok-2", async () => {
      await new Promise((r) => setTimeout(r, 5));
      seen.push(takeTurnstileToken());
    }),
  ]);
  check("concurrent turns keep their own tokens", seen.includes("tok-1") && seen.includes("tok-2") && seen.length === 2, seen);
}

// THE ASSUMPTION THE CHAT ROUTE RESTS ON. `start` is invoked synchronously by
// the ReadableStream constructor, so a stream built inside the scope carries it
// into work that finishes long after the handler has returned its Response.
{
  let fromInsideStream: string | undefined = "not-run";
  const stream = withTurnstileToken("tok-stream", () =>
    new ReadableStream<Uint8Array>({
      async start(controller) {
        await new Promise((r) => setTimeout(r, 10));
        fromInsideStream = takeTurnstileToken();
        controller.close();
      },
    })
  );
  await stream.getReader().read();
  await new Promise((r) => setTimeout(r, 30));
  check("the token reaches async work inside the SSE stream", fromInsideStream === "tok-stream", fromInsideStream);
}

// --------------------------------------------------------------- raiseEpCase
{
  // The keyed CRM route, added 22 October, takes precedence over everything
  // below; this file is about the fallback, so it is cleared for the duration.
  const savedCrmBase = process.env.NXN_CRM_BASE_URL;
  const savedCrmKey = process.env.NXN_CRM_API_KEY;
  delete process.env.NXN_CRM_BASE_URL;
  delete process.env.NXN_CRM_API_KEY;
  const savedBase = process.env.NXN_CASE_API_BASE_URL;
  const savedTok = process.env.NXN_CASE_TURNSTILE_TOKEN;
  delete process.env.NXN_CASE_TURNSTILE_TOKEN;

  delete process.env.NXN_CASE_API_BASE_URL;
  const noBase = await raiseEpCase({ firstName: "T", lastName: "U", mobile: "0553708434", message: "probe" });
  check("no base URL is not_configured", !noBase.ok && noBase.reason === "not_configured" && /NXN_CASE_API_BASE_URL/.test(noBase.detail), noBase);

  // A stub standing in for their endpoint: nothing here ever touches
  // emiratespost.ae, which creates real cases in a queue real officers work.
  let sawHeader: string | null = null;
  let sawBody = "";
  const server = createServer((req, res) => {
    sawHeader = req.headers["x-turnstile-token"] as string ?? null;
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      sawBody = b;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ caseNumbering: "00099999" }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  process.env.NXN_CASE_API_BASE_URL = `http://127.0.0.1:${port}`;

  const noToken = await raiseEpCase({ firstName: "T", lastName: "U", mobile: "0553708434", message: "probe" });
  check("a turn with no token does not call them at all", !noToken.ok && noToken.reason === "not_configured", noToken);
  check("and the message points at the site key, not at a server-side one", !noToken.ok && /NXN_CASE_TURNSTILE_SITE_KEY/.test(noToken.detail), noToken);
  check("nothing was sent", sawHeader === null);

  const sent = await withTurnstileToken("browser-token-xyz", () =>
    raiseEpCase({ firstName: "Aisha", lastName: "K", mobile: "0553708434", message: "please call me back" })
  );
  check("the browser's token is accepted end to end", sent.ok && sent.caseNumber === "00099999", sent);
  check("and it is sent as x-turnstile-token", sawHeader === "browser-token-xyz", sawHeader);
  check("alongside the body their form posts", /"origin":"Web-EP"/.test(sawBody) && /"mobilePhone":"00971553708434"/.test(sawBody), sawBody.slice(0, 120));

  // The env var survives only as a by-hand override for probing their endpoint.
  sawHeader = null;
  process.env.NXN_CASE_TURNSTILE_TOKEN = "manual-override";
  const manual = await raiseEpCase({ firstName: "T", lastName: "U", mobile: "0553708434", message: "probe" });
  check("the env var still works for a by-hand probe", manual.ok && sawHeader === "manual-override", sawHeader);

  sawHeader = null;
  const browserWins = await withTurnstileToken("browser-wins", () =>
    raiseEpCase({ firstName: "T", lastName: "U", mobile: "0553708434", message: "probe" })
  );
  check("but the browser's token outranks it", browserWins.ok && sawHeader === "browser-wins", sawHeader);

  server.close();
  if (savedBase) process.env.NXN_CASE_API_BASE_URL = savedBase; else delete process.env.NXN_CASE_API_BASE_URL;
  if (savedTok) process.env.NXN_CASE_TURNSTILE_TOKEN = savedTok; else delete process.env.NXN_CASE_TURNSTILE_TOKEN;
  if (savedCrmBase) process.env.NXN_CRM_BASE_URL = savedCrmBase;
  if (savedCrmKey) process.env.NXN_CRM_API_KEY = savedCrmKey;
}

// ------------------------------------------------------------- the wiring
{
  const route = read("app/api/chat/route.ts");
  check("the chat request may carry a token", /turnstileToken: z\.string\(\)\.max\(\d+\)\.optional\(\)/.test(route));
  check("the stream is built inside the scope", /withTurnstileToken\(body\.turnstileToken, \(\) => new ReadableStream\(/.test(route));
  check("a spent token is reported back to the browser", /if \(body\.turnstileToken && !hasTurnstileToken\(\)\) send\(\{ type: "turnstile_spent" \}\)/.test(route));

  const page = read("app/embed/[agent]/page.tsx");
  check("the site key reaches the browser", /turnstileSiteKey: /.test(page));
  check("EPGL never loads Cloudflare's script — its callbacks are Salesforce cases", /tenantSlug === "epgl" \? undefined : turnstileSiteKey\(\)/.test(page));

  const exp = read("app/embed/[agent]/Experience.tsx");
  check("the widget is mounted only where there is a key", /agent\.turnstileSiteKey \? <div className="dlg-turnstile" ref=\{turnstile\.mount\} \/> : null/.test(exp));
  check("every message carries the current token", /const turnstileToken = await turnstile\.get\(\);/.test(exp) && /\n\s+turnstileToken,\n/.test(exp));
  check("a spent token mints the next one", /ev\.type === "turnstile_spent"/.test(exp) && /turnstile\.spent\(\)/.test(exp));

  const hook = read("app/embed/[agent]/useTurnstile.ts");
  check("the widget is invisible until Cloudflare wants a tick", /appearance: "interaction-only"/.test(hook));
  check("a stale token is never sent", /STALE_AFTER_MS = 240_000/.test(hook));
  check("a send is not held up for long", /WAIT_MS = 8_000/.test(hook));
  check("the hostname error is called out for what it is", /110200/.test(hook));
  check("getting the token does not burn it", /if \(fresh\) return fresh;/.test(hook));
  check("the widget is removed on unmount", /window\.turnstile\.remove\(/.test(hook));

  const css = read("app/globals.css");
  check("an empty widget takes no space in the composer", /\.dlg-turnstile:not\(:empty\)/.test(css));

  const epcase = read("lib/epCase.ts");
  check("the comment no longer says a token is unobtainable", !/so a server cannot mint one/.test(epcase));
  check("and says where the real one comes from", /the token now comes from\n \* the customer's own browser/.test(epcase));
}

// The key itself is configuration, not code: absent here, it simply means no
// widget renders, which is the pre-21-October behaviour.
check("the site key is read from the environment", typeof turnstileSiteKey() === "string");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
