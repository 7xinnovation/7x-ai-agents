/**
 * Switch NXN's payment gateway to the N-Genius PRODUCTION outlet (2026-08-14).
 *
 * Prod's database was seeded from staging, so the payment integration still
 * pointed at api-gateway.sandbox.ngenius-payments.com with the sandbox outlet.
 * Real customers on agent.7x.ae would have been sent to a sandbox order — a
 * payment page that takes no money and settles nothing.
 *
 *   baseUrl   -> https://api-gateway.ngenius-payments.com
 *   outletRef -> the production outlet
 *   NGENIUS_API_KEY (app setting) -> the production key, set separately
 *
 * VERIFICATION IS AUTH-ONLY. It mints an access token to prove the key and outlet
 * are accepted; it does NOT create an order. Creating one against a live outlet
 * leaves a real unpaid order in Emirates Post's gateway, and a config check is not
 * worth that. The token call is read-only and charges nothing.
 *
 * Run from apps/web:
 *   npx tsx scripts/apply-nxn-ngenius-production.ts --env <file> [--dry-run]
 * The env file must carry DATABASE_URL, SECRETS_KEY and NGENIUS_API_KEY.
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

import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";

const SLUG = "nxn-dialog";
const dryRun = process.argv.includes("--dry-run");

const PROD_BASE_URL = "https://api-gateway.ngenius-payments.com";
const PROD_OUTLET = "6171b4ce-fed3-4fe1-8390-5b4428403bfc";
const PROD_REDIRECT = "https://agent.7x.ae/api/payments/return";

interface Definition {
  integrations?: Record<string, { provider?: string; settings?: Record<string, unknown> }>;
  [k: string]: unknown;
}

async function main() {
  const apiKey = process.env.NGENIUS_API_KEY;
  if (!apiKey) throw new Error("NGENIUS_API_KEY missing from the env file");

  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`${SLUG} not found`);
  const def = row.definition as unknown as Definition;
  const pay = def.integrations?.payment;
  if (!pay) throw new Error("no payment integration on this agent");

  const before = { ...(pay.settings ?? {}) };
  console.log("current payment settings:");
  console.log(`  provider   : ${pay.provider}`);
  console.log(`  baseUrl    : ${before.baseUrl ?? "(unset)"}`);
  console.log(`  outletRef  : ${before.outletRef ?? "(unset)"}`);
  console.log(`  redirectUrl: ${before.redirectUrl ?? "(unset)"}`);
  console.log("\nwould become:");
  console.log(`  baseUrl    : ${PROD_BASE_URL}`);
  console.log(`  outletRef  : ${PROD_OUTLET}`);
  console.log(`  redirectUrl: ${PROD_REDIRECT}`);

  console.log("\nverifying the production key + outlet (auth only, no order created) ...");
  const res = await fetch(`${PROD_BASE_URL}/identity/auth/access-token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${apiKey}`,
      "Content-Type": "application/vnd.ni-identity.v1+json",
      Accept: "application/vnd.ni-identity.v1+json",
    },
  });
  if (!res.ok) {
    console.log(`  FAILED: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    console.log("  nothing written.");
    process.exitCode = 1;
    return;
  }
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) {
    console.log("  FAILED: no access_token in the response; nothing written.");
    process.exitCode = 1;
    return;
  }
  console.log(`  ok — access token minted (expires in ${json.expires_in ?? "?"}s)`);

  if (dryRun) {
    console.log("\n--dry-run, nothing written");
    return;
  }
  pay.settings = { ...before, baseUrl: PROD_BASE_URL, outletRef: PROD_OUTLET, redirectUrl: PROD_REDIRECT };
  await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
  console.log("\npayment integration switched to the production outlet.");
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
