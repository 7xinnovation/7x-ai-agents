/**
 * UAEPay, against the UAT, today (2026-10-07).
 *
 * The unit tests pin what the adapter sends; this one asks UAEPay whether it
 * still accepts it. A link is created for AED 1 and the inquiry is asked about
 * it — nothing is paid, so the answer is INITIATED and the row would stay open.
 * Two things are being proved: the credentials still mint a token, and the
 * parameters added on 7 October (`enableSecureRedirect`, `language`, `metaData`)
 * are accepted rather than rejected with a 200 that carries an error.
 *
 * Needs UAEPAY_CLIENT_ID / UAEPAY_CLIENT_SECRET (root .env or the environment).
 * Skips, loudly, without them. Run from apps/web:
 *   npx tsx scripts/test-uaepay-live-2026-10-07.ts [--base-url https://uat-api.uaepay.ae] [--merchant MR123093]
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import { uaePayPayment } from "@dialog/core";

const arg = (n: string) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : undefined; };
const BASE_URL = arg("--base-url") ?? "https://uat-api.uaepay.ae";
const MERCHANT = arg("--merchant") ?? "MR123093";

const id = process.env.UAEPAY_CLIENT_ID, secret = process.env.UAEPAY_CLIENT_SECRET;
if (!id || !secret) {
  console.log("SKIP: UAEPAY_CLIENT_ID / UAEPAY_CLIENT_SECRET not set — nothing was called.");
  process.exit(0);
}

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`); }
};

const ctx = {
  agentSlug: "live-test",
  settings: { baseUrl: BASE_URL, merchantCode: MERCHANT, returnUrl: "https://7xagents.7x-lab.com/api/payments/return" },
  secrets: { UAEPAY_CLIENT_ID: id, UAEPAY_CLIENT_SECRET: secret },
} as never;

console.log(`\nCreate a link on ${BASE_URL} as ${MERCHANT}`);
const started = Date.now();
const res = await uaePayPayment.initiate(ctx, {
  caseId: `live-test-${Date.now()}`,
  amount: 1,
  currency: "AED",
  description: "Dialog live test — not a real charge",
  email: "payments-test@7x.ae",
  locale: "ar",
  // The Emirates ID the UAT accepts in its own examples, bare digits.
  customer: { name: "Live Test", emiratesId: "784199983926421", mobile: "0500000000" },
});
console.log(`  (${Date.now() - started} ms)`);
check("a reference came back and it is our UUID", /^[0-9a-f-]{36}$/i.test(res.reference), res.reference);
let host = "";
try { host = new URL(res.link ?? "").hostname; } catch { /* checked below */ }
check("a payment link came back on a UAEPay / noqodi host", /(^|\.)(uaepay\.ae|noqodi\.com)$/.test(host), host);
check("...which the chat's pay button would be allowed to open", /(^|\.)(uaepay\.ae|noqodi\.com)$/.test(host) && (res.link ?? "").startsWith("https://"));
check("status is initiated, nothing has been paid", res.status === "initiated", res.status);

console.log("\nAsk the inquiry API about it");
const st = await uaePayPayment.getStatus(ctx, { reference: res.reference });
check("the inquiry knows the reference and it is still open", st.status === "initiated", st.status);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
