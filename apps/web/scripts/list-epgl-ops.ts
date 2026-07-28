/** Dev helper: list the EPGL agent's integration operations. */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import { getDb, agentIntegrations, agents } from "@dialog/db";
import { eq } from "drizzle-orm";

async function main() {
  const db = getDb();
  const [agent] = await db.select().from(agents).where(eq(agents.slug, "epgl-dialog")).limit(1);
  if (!agent) throw new Error("epgl-dialog not found");
  const rows = await db.select().from(agentIntegrations).where(eq(agentIntegrations.agentId, agent.id));
  for (const r of rows) {
    console.log(`${r.name} (enabled=${r.enabled})`);
    for (const [env, spec] of Object.entries((r.environments ?? {}) as Record<string, { baseUrl?: string; operations?: { toolName: string; method: string; path: string; enabled?: boolean }[] }>)) {
      console.log(`  [${env}] ${spec.baseUrl}`);
      for (const op of spec.operations ?? []) console.log(`    ${op.enabled === false ? "(off) " : ""}${op.toolName}  ${op.method} ${op.path}`);
    }
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
