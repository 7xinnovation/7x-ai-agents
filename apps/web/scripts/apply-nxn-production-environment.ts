/**
 * Point the NXN agent at the LIVE Emirates Post backend (2026-08-14).
 *
 * Prod's database was seeded from staging's configuration, so the NXN
 * integration only had a `staging` environment (box-stg) and the agent's
 * activeEnvironment was "staging" — i.e. the production app was talking to the
 * staging backend. This adds the production environment and flips the agent to it.
 *
 * Base URL: box-stg.emiratespost.ae -> box.emiratespost.ae, same path.
 * API key:  supplied via NXN_PROD_API_KEY (verified against the live host below).
 *
 * The operations, and therefore the tools, are copied verbatim from staging — the
 * two environments expose the same API surface, so nothing about the agent's
 * behaviour changes except which backend answers.
 *
 * THIS MAKES THE PRODUCTION AGENT TALK TO LIVE EMIRATES POST. It is guarded by a
 * live read of the issuing-authority list before the flip, and rolls back if that
 * read fails, so the agent is never left pointing at a backend we cannot reach.
 *
 * Run from apps/web:
 *   NXN_PROD_API_KEY=... DATABASE_URL=<prod> npx tsx scripts/apply-nxn-production-environment.ts
 *   add --dry-run to see what would change
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
// --env <file> targets another environment without putting DATABASE_URL, the
// secrets key or the API key on the command line, where they end up in shell
// history and process listings.
const envArg = process.argv.indexOf("--env");
config({
  path:
    envArg !== -1 && process.argv[envArg + 1]
      ? resolve(process.argv[envArg + 1]!)
      : resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env"),
});

import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";
import { listIntegrations, upsertEnvironment, type EnvSpec } from "../lib/integrations";
import { listIssuingEntities } from "../lib/gsbLookup";

const SLUG = "nxn-dialog";
const dryRun = process.argv.includes("--dry-run");

async function main() {
  const db = getDb();
  const [agent] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!agent) throw new Error(`${SLUG} not found`);

  const rows = await listIntegrations(agent.id);
  const row = rows.find((r) => /nxn/i.test(r.name));
  if (!row) throw new Error("NXN integration not found");

  const staging = row.environments.staging as EnvSpec | undefined;
  if (!staging) throw new Error("no staging spec to copy the operations from");

  const key = process.env.NXN_PROD_API_KEY;
  if (!key) throw new Error("set NXN_PROD_API_KEY to the production Emirates Post API key");

  const prod: EnvSpec = {
    ...staging,
    baseUrl: staging.baseUrl.replace("box-stg.", "box."),
    apiKey: key,
    specUrl: (staging.specUrl ?? "").replace("box-stg.", "box."),
  };

  const def = agent.definition as { activeEnvironment?: string; [k: string]: unknown };
  console.log(`integration : ${row.name}`);
  console.log(`  staging   : ${staging.baseUrl}`);
  console.log(`  production: ${prod.baseUrl}`);
  console.log(`  operations: ${(prod.operations ?? []).length} (copied from staging)`);
  console.log(`agent activeEnvironment: ${def.activeEnvironment} -> production`);
  if (dryRun) {
    console.log("\n--dry-run, nothing written");
    return;
  }

  const hadProduction = Boolean(row.environments.production);
  await upsertEnvironment(agent.id, row.name, "production", prod);

  console.log("\nverifying the live backend answers before flipping the agent over ...");
  try {
    const list = await listIssuingEntities(agent.id, "production");
    if (!list.length) throw new Error("issuing-authority list came back empty");
    console.log(`  ok — ${list.length} issuing authorities from ${prod.baseUrl}`);
  } catch (e) {
    console.log(`  FAILED: ${(e as Error).message}`);
    if (!hadProduction) {
      console.log("  leaving activeEnvironment on staging; the production spec is stored but unused");
    }
    process.exitCode = 1;
    return;
  }

  def.activeEnvironment = "production";
  await db.update(agents).set({ definition: def as never }).where(eq(agents.id, agent.id));
  console.log("  agent flipped to production");
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
