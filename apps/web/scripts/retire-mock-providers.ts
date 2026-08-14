/**
 * Stop serving invented data from production (2026-08-14).
 *
 * NXN was still bound to mock crm, auth and lookup. The problem with these mocks
 * is not that they fail — it is that they SUCCEED, confidently:
 *
 *   crm.getStatus     any status question -> "Under Review"
 *   crm.createCallback returns a reference; nobody is contacted
 *   crm.getRecord     prefills "Demo Trading LLC", PO Box 50500, licence CN-1234567
 *   lookup.lookup     invents shipment events ("Accepted at facility")
 *
 * Each is a wrong answer delivered with a straight face, which is worse in front
 * of a real customer than an error they can act on.
 *
 *   crm    -> "ops"     answers status from this customer's own cases in our
 *                       database, and emails callbacks/manual requests to the
 *                       branch mailbox so a person actually receives them.
 *                       Prefill returns nothing rather than something invented.
 *   auth   -> "uaepass" the real provider. Nothing reads this capability today,
 *                       so it is a labelling fix, not a behavioural one.
 *   lookup -> REMOVED   there is no real shipment-tracking adapter anywhere in
 *                       the codebase, and no tracking endpoint in the PO Box API
 *                       either — that is a different Emirates Post service. With
 *                       the binding gone the tool answers "No lookup system
 *                       configured" instead of inventing a delivery history.
 *
 * Run from apps/web:
 *   npx tsx scripts/retire-mock-providers.ts [--env <file>] [--dry-run]
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

const dryRun = process.argv.includes("--dry-run");

/** Capability -> the provider it should use, or null to remove the binding. */
const TARGET: Record<string, string | null> = {
  crm: "ops",
  auth: "uaepass",
  lookup: null,
};

async function main() {
  const db = getDb();
  let changed = 0;

  for (const row of await db.select().from(agents)) {
    const def = row.definition as Record<string, any>;
    const integrations = (def.integrations ?? {}) as Record<string, any>;
    const notes: string[] = [];

    for (const [cap, target] of Object.entries(TARGET)) {
      const cur = integrations[cap]?.provider;
      if (cur !== "mock") continue; // never touch a real binding

      if (target === null) {
        delete integrations[cap];
        notes.push(`${cap}: mock -> removed`);
      } else {
        integrations[cap] = { ...integrations[cap], provider: target };
        notes.push(`${cap}: mock -> ${target}`);
      }
    }

    if (!notes.length) {
      console.log(`  (skip) ${def.slug}: no mock providers left`);
      continue;
    }
    console.log(`  ${dryRun ? "would change" : "     +     "} ${def.slug}: ${notes.join(", ")}`);
    changed++;
    if (dryRun) continue;
    def.integrations = integrations;
    await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
  }

  console.log(changed ? `\n${dryRun ? "(dry run) " : ""}${changed} agent(s) updated.` : "\nnothing to do");
  if (!dryRun && changed) {
    console.log("Status answers now come from real case records; callbacks reach the branch mailbox;");
    console.log("shipment tracking says it is unavailable rather than inventing a delivery history.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
