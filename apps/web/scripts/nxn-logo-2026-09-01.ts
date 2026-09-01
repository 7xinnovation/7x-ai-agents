/**
 * Use the Emirates Post logo in the NXN widget (2026-09-01).
 *
 * The widget carried the "nxn" wordmark — our name, on Emirates Post's own site,
 * in a conversation about their PO Boxes. It now shows the same mark the EPGL
 * widget does. The file is copied rather than shared: NXN should not change
 * because someone edited an asset named for another agent.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/nxn-logo-2026-09-01.ts [--env <file>]
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

const SLUG = "nxn-dialog";
const LOGO = "/emiratespost-logo.svg";

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`${SLUG} not found`);
  const def = row.definition as unknown as { theme: { logoUrl?: string } };
  if (def.theme?.logoUrl === LOGO) { console.log("nothing to do"); return; }
  console.log(`  + logoUrl: ${def.theme?.logoUrl ?? "(unset)"} -> ${LOGO}`);
  def.theme.logoUrl = LOGO;
  await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
  console.log("\n1 agent updated.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
