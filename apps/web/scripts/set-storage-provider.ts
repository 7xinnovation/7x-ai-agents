/**
 * Set every agent's storage provider.
 *
 * Exists because resolveAdapters THROWS on a provider it has no factory for, and
 * it runs at the top of the chat route — so pointing the database at "postgres"
 * before the code that registers it is deployed takes chat down completely, on
 * every turn, with an empty response. Which is exactly what I did.
 *
 * Order matters: deploy the code first, then switch the database. This script is
 * the lever for both directions.
 *
 *   npx tsx scripts/set-storage-provider.ts mock     [--env <file>]
 *   npx tsx scripts/set-storage-provider.ts postgres [--env <file>]
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

const provider = process.argv.find((x) => x === "mock" || x === "postgres");

async function main() {
  if (!provider) throw new Error("usage: set-storage-provider.ts <mock|postgres> [--env <file>]");
  const db = getDb();
  for (const row of await db.select().from(agents)) {
    const def = row.definition as Record<string, any>;
    const cur = def.integrations?.storage?.provider;
    if (cur === provider) {
      console.log(`  (skip) ${def.slug}: already ${provider}`);
      continue;
    }
    def.integrations = def.integrations ?? {};
    def.integrations.storage = {
      ...(def.integrations.storage ?? {}),
      provider,
      settings: def.integrations.storage?.settings ?? {},
      secretRefs: def.integrations.storage?.secretRefs ?? [],
    };
    await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
    console.log(`  + ${def.slug}: ${cur ?? "(unset)"} -> ${provider}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
