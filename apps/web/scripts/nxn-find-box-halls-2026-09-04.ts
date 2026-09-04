/**
 * Which branches are P.O. Box HALLS, and which of those can actually be tested?
 *
 * Emirates Post's rule is officeId != mainOfficeId. A hall only reaches the
 * customer if it also has boxes to rent, so this lists both facts together and
 * names the ones a tester can walk the disclaimer through.
 *
 * Read-only: two GETs per emirate, no reservations, no writes, no credentials
 * printed. Run from apps/web:
 *   npx tsx scripts/nxn-find-box-halls-2026-09-04.ts [--env <file>] [--bundle IN]
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
import { isPoBoxHall, type BranchRow } from "../lib/branchList";

const bundleArg = process.argv.indexOf("--bundle");
const BUNDLE = bundleArg !== -1 ? process.argv[bundleArg + 1]! : "IN";
const EMIRATES = ["AUH", "DXB", "SHJ", "AJM", "UAQ", "RAK", "FUJ"];

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

  console.log(`\n${intg.name} · ${env} · bundle ${BUNDLE}\n`);
  const get = async (path: string, params: Record<string, string>) => {
    const u = new URL(base + path);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    const r = await fetch(u, { headers });
    if (!r.ok) return null;
    const j = (await r.json()) as { payload?: unknown };
    return (j?.payload ?? j) as unknown;
  };

  const testable: string[] = [];
  for (const em of EMIRATES) {
    const rows = (await get("/api/Rental/BoxLocations", { BundleId: BUNDLE, EmirateCode: em })) as BranchRow[] | null;
    if (!Array.isArray(rows) || !rows.length) { console.log(`${em}: —`); continue; }
    const halls = rows.filter(isPoBoxHall);
    console.log(`${em}: ${rows.length} branches, ${halls.length} box hall(s)`);
    if (process.argv.includes("--all"))
      for (const r of rows) console.log(`      ${isPoBoxHall(r) ? "HALL" : "    "} ${r.officeId}/${r.mainOfficeId}  ${r.nameEn}`);
    for (const h of halls) {
      const free = (await get("/api/Rental/FreeBoxes", { BundleId: BUNDLE, LocationId: String(h.officeId) })) as unknown[] | null;
      const n = Array.isArray(free) ? free.length : null;
      const line = `    ${h.nameEn} — keys at ${h.mainOfficeNameEn ?? "?"} — ${n === null ? "count unavailable" : `${n} free box(es)`}`;
      console.log(line);
      if (n && n > 0) testable.push(`${em} · ${h.nameEn} (keys at ${h.mainOfficeNameEn})`);
    }
  }

  console.log(
    testable.length
      ? `\nTest the disclaimer with any of these — pick the emirate, then the branch:\n  ${testable.join("\n  ")}`
      : `\nNo box hall has free boxes for bundle ${BUNDLE} right now, so none would be offered to a customer.`
  );
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
