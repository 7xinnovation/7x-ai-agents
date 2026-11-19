/**
 * UAE Pay's redirect landed on "/api/payments/returnb18b6f89-…" — a 404 — after
 * the first successful UAT card payment (2026-11-19). They append the result to
 * the landing URL as-is, so we end it in `?response=`, and the return route finds
 * our merchantRequestId as the first UUID in the query.
 *
 * Run from apps/web:  npx tsx scripts/test-uaepay-landing-url-2026-11-19.ts
 */
import { readFileSync } from "node:fs";
import { landingUrl } from "../../../packages/core/src/adapters/uaepay";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`); }
};

const R = "https://7xagents.7x-lab.com/api/payments/return";
check("bare return URL gets ?response=", landingUrl(R) === `${R}?response=`, landingUrl(R));
check("one with a query gets &response=", landingUrl(`${R}?lang=ar`) === `${R}?lang=ar&response=`, landingUrl(`${R}?lang=ar`));
check("already open is left alone", landingUrl(`${R}?response=`) === `${R}?response=`);
check("none stays none", landingUrl(undefined) === undefined);

const adapter = readFileSync(new URL("../../../packages/core/src/adapters/uaepay.ts", import.meta.url), "utf8");
check("the adapter sends it", /merchantLandingURL: landingUrl\(cfg\.returnUrl\)/.test(adapter));

const route = readFileSync(new URL("../app/api/payments/return/route.ts", import.meta.url), "utf8");
check("the return route falls back to the first UUID in the query", /\?\? uuidIn\(req\.nextUrl\.search\)/.test(route));
check("...and still asks the gateway for the outcome", /gw\.choice\.adapter\.getStatus\(gw\.ctx, \{ reference \}\)/.test(route));
check("...for a POST as well as a GET", /export async function POST\(req: NextRequest\) \{\s*return GET\(req\);/.test(route));

// LR-54539: paid via the return, never reported to EPGL until the sweep.
check("a payment confirmed on return is reported to EPGL", /if \(status === "paid" && pay\.conversationId\) \{\s*await notifyEpglIfLicenceFee\(pay\.agentId, pay\.conversationId, reference, Number\(pay\.amount \?\? 0\)\);/.test(route));
check("...and settles a waiting A2A task", /void onPaymentSettled\(pay\.conversationId\)/.test(route));

// Same regex as the route, against the shapes UAE Pay might send.
const uuidIn = (s: string) => { try { s = decodeURIComponent(s); } catch {} return s.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0]?.toLowerCase() ?? ""; };
const ID = "b18b6f89-4d76-4c1e-9a2b-0123456789ab";
check("plain", uuidIn(`?response=${ID}`) === ID);
check("with status", uuidIn(`?response=${ID}&status=SUCCESS`) === ID);
check("as encoded JSON", uuidIn(`?response=${encodeURIComponent(JSON.stringify({ merchantInfo: { merchantRequestId: ID }, statusInfo: { status: "SUCCESS" } }))}`) === ID);
check("nothing to find", uuidIn("?response=") === "");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
