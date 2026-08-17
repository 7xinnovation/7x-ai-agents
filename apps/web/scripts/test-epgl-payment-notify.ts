/**
 * Contract check for the EPGL payment notification.
 *
 * Uses a well-formed but non-existent licence request id, so Salesforce answers
 * 404 and creates nothing. That proves the auth, the URL, the payload shape and
 * our error handling without touching a real Payment Advice — the success path
 * genuinely marks a fee paid, so it is not something to fire on a whim.
 *
 * Run from apps/web:  npx tsx scripts/test-epgl-payment-notify.ts [--env <file>]
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const i = process.argv.indexOf("--env");
config({ path: i !== -1 ? resolve(process.argv[i + 1]!) : resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";
import { notifyEpglPayment } from "../lib/epglPayment";

async function main() {
  const db = getDb();
  const [a] = await db.select().from(agents).where(eq(agents.slug, "epgl-dialog")).limit(1);
  if (!a) throw new Error("epgl-dialog not found");
  const env = ((a.definition as { activeEnvironment?: string }).activeEnvironment ?? "staging") as "staging" | "production";
  console.log(`epgl-dialog, environment: ${env}\n`);

  console.log("1. malformed id — rejected before any network call");
  const bad = await notifyEpglPayment(a.id, env, { licenseRequestId: "nope", paymentId: "T1", amount: 100 });
  console.log(`   ok=${bad.ok} reason="${(bad as any).reason}" retryable=${(bad as any).retryable}`);

  console.log("\n2. well-formed but non-existent id — expect 404 from Salesforce, nothing created");
  const missing = await notifyEpglPayment(a.id, env, {
    licenseRequestId: "a11FW000000000AAA",
    paymentId: `TEST-${Date.now()}`,
    amount: 100000,
    currency: "AED",
  });
  console.log(`   ok=${missing.ok} status=${(missing as any).status} reason="${(missing as any).reason}"`);
  console.log(`   retryable=${(missing as any).retryable}  (should be false — a wrong id will not fix itself)`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.message ?? e); process.exit(1); });
