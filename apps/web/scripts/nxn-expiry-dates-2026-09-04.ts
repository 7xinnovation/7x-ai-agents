/**
 * What expiry dates does Emirates Post actually offer for a bundle?
 *
 * `Rental/Select` takes `poBoxExpiryDate` and it must be one of these, copied
 * verbatim. A corporate rental was refused with an empty error object on 4 Sep
 * carrying a rolling-year date (`2027-09-03`), which is what a personal box gets
 * — so this asks the endpoint what it would have accepted instead.
 *
 * Read-only. Run from apps/web:
 *   npx tsx scripts/nxn-expiry-dates-2026-09-04.ts [--env <file>] [--bundle LI]
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
const BUNDLES = (arg("--bundle") ?? "IN,MYHOME3,LI,PR,PP").split(",");

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
  const headers: Record<string, string> = { Accept: "application/json" };
  if (spec.apiKey) headers[spec.apiKeyHeader || "X-API-KEY"] = String(spec.apiKey);

  console.log(`\n${intg.name} · ${env}\n`);
  for (const b of BUNDLES) {
    const u = new URL(`${base}/api/Rental/ExpiryDates`);
    u.searchParams.set("BundleId", b);
    const r = await fetch(u, { headers });
    const text = await r.text();
    if (!r.ok) { console.log(`${b}: HTTP ${r.status} ${text.slice(0, 160)}`); continue; }
    let payload: unknown;
    try { payload = (JSON.parse(text) as { payload?: unknown }).payload; } catch { payload = text; }
    console.log(`${b}: ${JSON.stringify(payload)}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
