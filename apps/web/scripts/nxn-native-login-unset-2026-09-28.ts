/**
 * Take `app://login` back off the agent (2026-09-28).
 *
 * It was set on 25 September so the widget could ask the app for a sign-in
 * through a URL, for an app that had an interceptor and no message handler.
 * Emirates Post's developer has since built the handler — "onMessage works
 * fine" — and reported what the other half cost:
 *
 *     Error opening URL: app://login. Unable to open URL: app://login.
 *
 * A native error dialog, over a sign-in that was working. The widget no longer
 * reads this setting at all, so this changes nothing about behaviour; it is here
 * so the configuration does not go on claiming something the code stopped doing.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/nxn-native-login-unset-2026-09-28.ts --target staging|production [--dry-run]
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

const target = process.argv[process.argv.indexOf("--target") + 1] ?? "";
if (target !== "staging" && target !== "production") {
  console.error(`Pass --target staging|production (got ${JSON.stringify(target)}).`);
  process.exit(1);
}
const dryRun = process.argv.includes("--dry-run");

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`No agent ${SLUG} in this database`);
  const def = row.definition as unknown as Record<string, unknown>;

  if (!("nativeLoginUrl" in def)) {
    console.log("Already applied — nativeLoginUrl is not set here.");
    return;
  }
  console.log(`  nativeLoginUrl: ${JSON.stringify(def.nativeLoginUrl)} -> (removed)`);
  delete def.nativeLoginUrl;
  if (dryRun) { console.log("\n--dry-run: not written."); return; }
  await db.update(agents).set({ definition: def as unknown as typeof row.definition }).where(eq(agents.id, row.id));
  console.log("\nWritten.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
