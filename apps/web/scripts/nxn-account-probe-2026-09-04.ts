/**
 * What does the account lookup actually return for a customer?
 *
 * "All five boxes are returning Box not found" — so the box LIST and the box
 * DETAILS disagree. This asks both, one after the other, and prints what each
 * says, so the disagreement is a fact rather than a guess.
 *
 * Read-only: two GETs per box, no writes, no reservations.
 *
 * Run from apps/web:
 *   npx tsx scripts/nxn-account-probe-2026-09-04.ts --env <file> --eid <784…> [--token <jwt>]
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
import { poBoxesByEmiratesId } from "../lib/gsbLookup";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const EID = arg("--eid");
const TOKEN = arg("--token");
if (!EID) throw new Error("--eid <emirates id> is required");

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, "nxn-dialog")).limit(1);
  if (!row) throw new Error("nxn-dialog not found");
  const def = row.definition as unknown as { activeEnvironment?: "staging" | "production" };
  const env = def.activeEnvironment ?? "production";

  console.log(`\n${env}\n\n1) The box list (what the chat shows on sign-in)`);
  let boxes: { boxNumber?: string | null }[] = [];
  try {
    boxes = (await poBoxesByEmiratesId(row.id, env, EID!, TOKEN)) as { boxNumber?: string | null }[];
    console.log(`   ${boxes.length} box(es): ${boxes.map((b) => b.boxNumber).join(", ") || "—"}`);
    for (const b of boxes) console.log(`     ${JSON.stringify(b)}`);
  } catch (e) {
    console.log(`   FAILED: ${String((e as Error).message ?? e)}`);
  }

  const intg = (await listIntegrations(row.id)).find((i) => i.enabled && i.environments[env]);
  if (!intg) throw new Error(`no enabled integration for ${env}`);
  const spec = intg.environments[env]!;
  const base = String(spec.baseUrl).replace(/\/$/, "");
  const h: Record<string, string> = { Accept: "application/json" };
  if (spec.apiKey) h[spec.apiKeyHeader || "X-API-KEY"] = String(spec.apiKey);
  if (TOKEN) h.Authorization = `Bearer ${TOKEN}`;

  console.log(`\n2) Renewal details, per box (what "Box not found" comes from)`);
  for (const b of boxes) {
    const n = String(b.boxNumber ?? "").trim();
    if (!n) continue;
    const u = new URL(`${base}/api/Renewal/Details`);
    u.searchParams.set("boxNumber", n);
    const r = await fetch(u, { headers: h });
    const text = await r.text();
    console.log(`   ${n}: HTTP ${r.status} ${text.replace(/\s+/g, " ").slice(0, 200)}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
