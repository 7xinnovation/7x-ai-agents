/**
 * Let the staging IDEP host frame the widget (2026-09-02).
 *
 * idep-stg.epgl.ae was not on the allow-list, so the widget would not load
 * there: allowedOrigins drives frame-ancestors, and a host that is not on it is
 * refused by the browser rather than by us.
 *
 * This is a deliberate widening — a staging host framing the production widget —
 * asked for explicitly. It does not change what the widget can see or do; it
 * only says which pages may embed it.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/epgl-allow-idep-stg-2026-09-02.ts [--env <file>]
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

const SLUG = "epgl-dialog";
const ORIGIN = "https://idep-stg.epgl.ae";

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`${SLUG} not found`);
  const def = row.definition as unknown as { allowedOrigins?: string[] };
  const current = def.allowedOrigins ?? [];
  if (current.includes(ORIGIN)) {
    console.log(`nothing to do — ${ORIGIN} is already allowed`);
    console.log(`  allowed: ${current.join(", ")}`);
    return;
  }
  def.allowedOrigins = [...current, ORIGIN];
  await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
  console.log(`  + ${ORIGIN}`);
  console.log(`\n  allowed now: ${def.allowedOrigins.join(", ")}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
