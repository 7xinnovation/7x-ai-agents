/**
 * Ask the app to sign the customer in (2026-09-25).
 *
 * In the Emirates Post app the sign-in button "opens the web and does not
 * redirect". It does: inside a WebView the portal route cannot work — the
 * portal owns its own UAE PASS client and leaves the token in ITS localStorage,
 * where in the app there is no host page and no loader to read it. The customer
 * signs in perfectly well and the chat never hears.
 *
 * The widget already posts { action: "signin-needed" } for the app to answer
 * with a handoff code. Their app is not listening for it, so sign-in falls
 * through to the browser. Their developer asked for a trigger he already has a
 * handler for: `app://login`.
 *
 * This sets that. It changes only how the app is ASKED — what it sends back is
 * the same short-lived handoff code as in the contract, and an app that answers
 * neither is exactly where it was.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/nxn-native-login-2026-09-25.ts --target staging|production [--dry-run]
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
/** What their app intercepts. Same in both environments — it is the app's own scheme. */
const NATIVE_LOGIN_URL = "app://login";

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
  const def = row.definition as unknown as { nativeLoginUrl?: string };

  if (def.nativeLoginUrl === NATIVE_LOGIN_URL) {
    console.log(`Already applied — nativeLoginUrl is ${NATIVE_LOGIN_URL}`);
    return;
  }
  console.log(`  nativeLoginUrl: ${JSON.stringify(def.nativeLoginUrl ?? null)} -> ${NATIVE_LOGIN_URL}`);
  def.nativeLoginUrl = NATIVE_LOGIN_URL;
  if (dryRun) { console.log("\n--dry-run: not written."); return; }
  await db.update(agents).set({ definition: def as unknown as typeof row.definition }).where(eq(agents.id, row.id));
  console.log("\nWritten.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
