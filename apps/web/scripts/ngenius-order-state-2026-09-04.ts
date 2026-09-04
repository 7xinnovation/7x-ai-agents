/**
 * What does the GATEWAY say about an order?
 *
 * Emirates Post creates the rental's order on N-Genius outlet
 * b78ef8c7-ce2a-41d6-84c9-e6219557a991 — the same sandbox outlet our own
 * checkout is configured against, so our API key can read it. That closes the
 * one gap in the whole investigation: whether a payment the customer believes
 * went through actually succeeded at the gateway, or was declined and simply
 * redirected back the same way a success does.
 *
 * Read-only: an access token and one GET.
 *
 * Run from apps/web:
 *   npx tsx scripts/ngenius-order-state-2026-09-04.ts --order <niOrderResult._id or uuid> [--outlet <ref>]
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const envArg = process.argv.indexOf("--env");
config({
  path:
    envArg !== -1 && process.argv[envArg + 1]
      ? resolve(process.argv[envArg + 1]!)
      : resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env"),
});

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const BASE = arg("--base") ?? "https://api-gateway.sandbox.ngenius-payments.com";
const OUTLET = arg("--outlet") ?? "b78ef8c7-ce2a-41d6-84c9-e6219557a991";
const ORDER = (arg("--order") ?? "").replace(/^urn:order:/, "");
const KEY = process.env.NGENIUS_API_KEY ?? "";
if (!ORDER) throw new Error("--order <order id> is required");
if (!KEY) throw new Error("NGENIUS_API_KEY is not set in the environment");

async function main() {
  const auth = await fetch(`${BASE}/identity/auth/access-token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${KEY}`,
      "Content-Type": "application/vnd.ni-identity.v1+json",
      Accept: "application/vnd.ni-identity.v1+json",
    },
    body: "{}",
  });
  if (!auth.ok) throw new Error(`auth failed: ${auth.status} ${(await auth.text()).slice(0, 200)}`);
  const token = ((await auth.json()) as { access_token: string }).access_token;

  const r = await fetch(`${BASE}/transactions/outlets/${OUTLET}/orders/${ORDER}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.ni-payment.v2+json" },
  });
  const text = await r.text();
  console.log(`\nHTTP ${r.status}`);
  if (!r.ok) { console.log(text.slice(0, 600)); return; }
  const o = JSON.parse(text) as Record<string, any>;
  console.log(`  order        ${o._id}`);
  console.log(`  reference    ${o.reference}`);
  console.log(`  merchantRef  ${o.merchantOrderReference ?? "—"}`);
  console.log(`  action       ${o.action}`);
  console.log(`  amount       ${o.amount?.currencyCode} ${(o.amount?.value ?? 0) / 100}`);
  const payments = (o._embedded?.payment ?? []) as Record<string, any>[];
  console.log(`  payments     ${payments.length}`);
  for (const p of payments) {
    console.log(`    - state ${p.state}`);
    console.log(`      amount ${(p.amount?.value ?? 0) / 100} ${p.amount?.currencyCode ?? ""}`);
    console.log(`      card   ${p.paymentMethod?.name ?? "?"} ${p.paymentMethod?.pan ?? ""}`);
    if (p.authResponse) console.log(`      auth   ${p.authResponse.resultCode} ${p.authResponse.resultMessage}`);
    if (p["3ds2"]) console.log(`      3ds    ${JSON.stringify(p["3ds2"]).slice(0, 200)}`);
    if (p.authenticationCode) console.log(`      authCode ${p.authenticationCode}`);
  }
  if (!payments.length) console.log(`    (no payment attempt recorded against this order)`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
