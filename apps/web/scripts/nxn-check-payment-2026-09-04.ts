/**
 * Ask Emirates Post again whether an order was paid.
 *
 * `Rental/UpdatePayment/{ref}` is how the chat confirms a payment, and it is the
 * only thing that can settle the question "the customer says they paid and we
 * told them it had not come through". Re-running it later is exactly what the
 * chat does when a customer says "check again" — it reads the gateway result for
 * that reference and records it — so this is the same call, made by hand, with
 * the answer printed in full.
 *
 * Needs the customer's own Emirates Post session token: the order belongs to
 * them, and the API key alone cannot see it.
 *
 * Run from apps/web:
 *   npx tsx scripts/nxn-check-payment-2026-09-04.ts --env <file> --ref <uuid> --token <jwt>
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
import { listIntegrations } from "../lib/integrations";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const REF = arg("--ref");
const TOKEN = arg("--token");
if (!REF) throw new Error("--ref <paymentGateWayResponse.referenceNumber> is required");

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, "nxn-dialog")).limit(1);
  if (!row) throw new Error("nxn-dialog not found");
  const def = row.definition as unknown as { activeEnvironment?: "staging" | "production" };
  const env = def.activeEnvironment ?? "production";
  const intg = (await listIntegrations(row.id)).find((i) => i.enabled && i.environments[env]);
  if (!intg) throw new Error(`no enabled integration for ${env}`);
  const spec = intg.environments[env]!;
  const base = String(spec.baseUrl).replace(/\/$/, "");

  const headers: Record<string, string> = { Accept: "application/json", "Content-Type": "application/json" };
  if (spec.apiKey) headers[spec.apiKeyHeader || "X-API-KEY"] = String(spec.apiKey);
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;

  const url = `${base}/api/Rental/UpdatePayment/${encodeURIComponent(REF!)}`;
  console.log(`\nPOST ${url}\n  session token: ${TOKEN ? "sent" : "NOT SENT — expect 401"}\n`);
  const r = await fetch(url, { method: "POST", headers, body: "{}" });
  const text = await r.text();
  console.log(`HTTP ${r.status} ${r.statusText}`);
  try {
    console.log(JSON.stringify(JSON.parse(text), null, 1));
  } catch {
    console.log(text.slice(0, 2000));
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
