/**
 * The keyed CRM route for raising a callback case (2026-10-22).
 *
 * Emirates Post gave us the direct CRM endpoint — `POST /Case?X-API-KEY=…` on
 * crm.epservices.ae — which is route 3 of the four in
 * docs/NXN-CALLBACK-BLOCKED-2026-09-03.md and the one asked for in September.
 * A server can call it, so the whole Turnstile apparatus becomes a fallback.
 *
 * Two things are load-bearing and are asserted rather than trusted:
 *
 *  1. THE KEY IS IN A QUERY PARAMETER, their design. Every call goes through
 *     `trackedFetch`, which writes the URL to a table the admin console shows.
 *     If `maskUrl` ever stops masking it, the key is in our database.
 *  2. THE CUSTOMER'S TURNSTILE TOKEN IS NOT SPENT on a route that ignores it.
 *     A burnt token cannot be reissued within the turn, so spending one here
 *     would break the fallback for the next call in the same conversation.
 *
 * Nothing here touches epservices.ae — a case there is one their officers work.
 *
 * Run from apps/web:  npx tsx scripts/test-ep-crm-2026-10-22.ts
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import { crmEndpoint, raiseEpCase, epMobile, caseNumberFrom } from "@/lib/epCase";
import { maskUrl } from "@/lib/apiCallLog";
import { withTurnstileToken, hasTurnstileToken } from "@/lib/turnstile";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => { console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : extra ?? ""); ok ? pass++ : fail++; };

const KEY = "not-a-real-key-aaaa:not-a-real-key-bbbb";
const clear = () => { delete process.env.NXN_CRM_BASE_URL; delete process.env.NXN_CRM_API_KEY; };

async function main() {
  // ------------------------------------------------------------- the endpoint
  clear();
  check("unset means no CRM route", crmEndpoint() === null);
  process.env.NXN_CRM_BASE_URL = "https://crm-stg.epservices.ae/api/CRM";
  check("a base URL alone is not enough", crmEndpoint() === null);
  clear();
  process.env.NXN_CRM_API_KEY = KEY;
  check("a key alone is not enough either", crmEndpoint() === null);

  process.env.NXN_CRM_BASE_URL = "https://crm-stg.epservices.ae/api/CRM/";
  const ep = crmEndpoint();
  check("both set gives an endpoint", ep !== null);
  check("built as /Case with the key as a query parameter", !!ep?.url.startsWith("https://crm-stg.epservices.ae/api/CRM/Case?X-API-KEY="), ep?.url);
  check("a trailing slash on the base does not double up", !ep?.url.includes("CRM//Case"), ep?.url);
  check("the colon in their key is encoded, not sent raw", ep!.url.includes("%3A"), ep?.url);

  // ---------------------------------------------------------------- the log
  const masked = maskUrl(ep!.url);
  check("the API log masks the key", !masked.includes("not-a-real-key"), masked);
  check("and keeps the parameter, so the call is still legible", /X-API-KEY=\*\*\*/.test(masked), masked);
  check("the host and path survive masking", masked.includes("crm-stg.epservices.ae/api/CRM/Case"), masked);

  // --------------------------------------------------------- nothing set
  clear();
  delete process.env.NXN_CASE_API_BASE_URL;
  const none = await raiseEpCase({ firstName: "T", lastName: "U", mobile: "0553708434", message: "probe" });
  check("with neither route configured nothing is called", !none.ok && none.reason === "not_configured", none);
  check("and the message names both routes", !none.ok && /NXN_CRM_BASE_URL/.test(none.detail) && /NXN_CASE_API_BASE_URL/.test(none.detail), none);

  // ------------------------------------------------- a stub standing in for them
  let sawUrl = "";
  let sawTurnstile: string | null = null;
  let sawBody = "";
  let status = 200;
  let reply = JSON.stringify({ caseNumbering: "00012345" });
  const server = createServer((req, res) => {
    sawUrl = req.url ?? "";
    sawTurnstile = (req.headers["x-turnstile-token"] as string) ?? null;
    let b = ""; req.on("data", (c) => (b += c));
    req.on("end", () => { sawBody = b; res.writeHead(status, { "Content-Type": "application/json" }); res.end(reply); });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  process.env.NXN_CRM_BASE_URL = `http://127.0.0.1:${port}/api/CRM`;
  process.env.NXN_CRM_API_KEY = KEY;

  const ok = await raiseEpCase({ firstName: "Aisha", lastName: "Al Mansoori", mobile: "0553708434", message: "please call me back", emirateCode: "DXB", poBoxNumber: "50500" });
  check("the keyed route raises the case", ok.ok && ok.caseNumber === "00012345", ok);
  check("it posts to /api/CRM/Case", sawUrl.startsWith("/api/CRM/Case?"), sawUrl);
  check("with the key on the query string", sawUrl.includes("X-API-KEY="), sawUrl);
  check("and NO turnstile header — that route is not CAPTCHA-gated", sawTurnstile === null, sawTurnstile);
  check("the body is the one their form posts", /"origin":"Web-EP"/.test(sawBody) && /"caseType":"Inquiry"/.test(sawBody), sawBody.slice(0, 160));
  check("mobile normalised to their 00971 shape", /"mobilePhone":"00971553708434"/.test(sawBody), sawBody.slice(0, 160));
  check("emirate and PO Box ride along", /"emirateCode":"DXB"/.test(sawBody) && /"poBoxNumber":"50500"/.test(sawBody), sawBody.slice(0, 200));

  // ------------------------------------------ the customer's token is not spent
  await withTurnstileToken("browser-token-abc", async () => {
    const r = await raiseEpCase({ firstName: "T", lastName: "U", mobile: "0553708434", message: "probe" });
    check("the keyed route is taken while a browser token is in hand", r.ok, r);
    check("and the token is LEFT UNSPENT for the fallback", hasTurnstileToken(), "token was burnt");
  });

  // --------------------------------------------------- a bad key reads as a bad key
  status = 403; reply = JSON.stringify({ message: "Invalid API key" });
  const bad = await raiseEpCase({ firstName: "T", lastName: "U", mobile: "0553708434", message: "probe" });
  check("a 403 on the keyed route is not reported as a CAPTCHA", !bad.ok && bad.reason !== "captcha", bad);
  check("it names the key, so nobody reopens the Turnstile thread", !bad.ok && /NXN_CRM_API_KEY/.test(bad.detail), bad);
  status = 401;
  const unauth = await raiseEpCase({ firstName: "T", lastName: "U", mobile: "0553708434", message: "probe" });
  check("a 401 reads the same way", !unauth.ok && /NXN_CRM_API_KEY/.test(unauth.detail), unauth);

  // -------------------------------------------- accepted but no case number
  status = 200; reply = JSON.stringify({ message: "ok" });
  const noNum = await raiseEpCase({ firstName: "T", lastName: "U", mobile: "0553708434", message: "probe" });
  check("a 200 with no case number is a failure, not a silent success", !noNum.ok, noNum);

  // --------------------------------------- the old route still works untouched
  reply = JSON.stringify({ caseNumbering: "00055555" });
  clear();
  process.env.NXN_CASE_API_BASE_URL = `http://127.0.0.1:${port}`;
  sawTurnstile = null;
  const old = await withTurnstileToken("browser-token-xyz", () =>
    raiseEpCase({ firstName: "T", lastName: "U", mobile: "0553708434", message: "probe" })
  );
  check("without the key we fall back to the CAPTCHA route", old.ok && old.caseNumber === "00055555", old);
  check("which does send the browser's token", sawTurnstile === "browser-token-xyz", sawTurnstile);
  check("and posts to /nextApi/case", sawUrl.startsWith("/nextApi/case"), sawUrl);

  // ------------------------------------------------------------ the timeout
  // Measured against their staging CRM on 22 October: a wrong key is refused
  // in under a second, an accepted create had not answered in 15. A timeout
  // must therefore not read as "it did not happen".
  {
    const slow = createServer((_req, res) => { setTimeout(() => { res.writeHead(200); res.end("{}"); }, 5000); });
    await new Promise<void>((r) => slow.listen(0, "127.0.0.1", r));
    const sp = (slow.address() as { port: number }).port;
    process.env.NXN_CRM_BASE_URL = `http://127.0.0.1:${sp}/api/CRM`;
    process.env.NXN_CRM_API_KEY = KEY;
    process.env.NXN_CRM_TIMEOUT_MS = "300";
    const t0 = Date.now();
    const slowR = await raiseEpCase({ firstName: "T", lastName: "U", mobile: "0553708434", message: "probe" });
    check("a slow create times out rather than hanging the turn", Date.now() - t0 < 3000, Date.now() - t0);
    check("and is reported as a timeout, not as unreachable", !slowR.ok && slowR.reason === "timeout", slowR);
    check("the detail warns the case MAY exist", !slowR.ok && /MAY HAVE BEEN CREATED/.test(slowR.detail), slowR);
    check("and says not to retry automatically", !slowR.ok && /do not retry/i.test(slowR.detail), slowR);
    delete process.env.NXN_CRM_TIMEOUT_MS;
    slow.close();
    slow.closeAllConnections?.();
  }

  // -------------------------------- the case number, whatever they call it
  // Their keyed endpoint came with NO sample response, so this is the one
  // thing in the integration still taken on trust. It is kept wide rather
  // than guessed narrow — and an unrecognised body still fails loudly.
  const cn = (o: unknown) => caseNumberFrom(JSON.stringify(o));
  check("caseNumbering — the one shape confirmed first-hand", cn({ caseNumbering: "00012345" }) === "00012345");
  check("caseNumber", cn({ caseNumber: "00012345" }) === "00012345");
  check("CaseNumber, as Salesforce spells it", cn({ CaseNumber: "00012345" }) === "00012345");
  check("case_number", cn({ case_number: "00012345" }) === "00012345");
  check("caseNo", cn({ caseNo: "00012345" }) === "00012345");
  check("a number, not a string", cn({ caseNumber: 12345 }) === "12345");
  check("inside a data envelope", cn({ data: { caseNumber: "00012345" } }) === "00012345");
  check("inside a result envelope", cn({ result: { CaseNumber: "00012345" } }) === "00012345");
  check("whitespace trimmed", cn({ caseNumber: "  00012345 " }) === "00012345");
  check("an empty value is not a case number", cn({ caseNumber: "   " }) === "");
  check("a message is not a case number", cn({ message: "ok", status: "success" }) === "");
  check("nor is an unrelated id we might be tempted by", cn({ id: "5003X00001abcde" }) === "");
  check("a non-JSON body yields nothing rather than throwing", caseNumberFrom("<html>502</html>") === "");
  check("an empty body yields nothing", caseNumberFrom("") === "");

  // ------------------------------------------------------------ unchanged bits
  check("mobile normalisation is untouched", epMobile("+971 55 370 8434") === "00971553708434");
  check("a non-UAE number is still refused", epMobile("+44 7700 900123") === "");

  server.close();
  delete process.env.NXN_CASE_API_BASE_URL;
  clear();

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main();
