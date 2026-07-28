/** Dev helper: dump the nxn-dialog agent definition to scratch for inspection. */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import { writeFileSync } from "node:fs";
import { getDb, agents, kbDocuments } from "@dialog/db";
import { eq } from "drizzle-orm";

const OUT = process.argv[2] ?? "/tmp/nxn-def.json";

async function main() {
  const db = getDb();
  const [agent] = await db.select().from(agents).where(eq(agents.slug, "nxn-dialog")).limit(1);
  if (!agent) throw new Error("nxn-dialog not found");
  writeFileSync(OUT, JSON.stringify(agent.definition, null, 2));
  const docs = await db
    .select({ id: kbDocuments.id, title: kbDocuments.title, source: kbDocuments.source })
    .from(kbDocuments)
    .where(eq(kbDocuments.agentId, agent.id));
  console.log(`definition written to ${OUT} (${JSON.stringify(agent.definition).length} chars)`);
  console.log(`agentId: ${agent.id}`);
  console.log(`KB documents (${docs.length}):`);
  for (const d of docs) console.log(`  - ${d.title} [${d.source}] ${d.id}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
