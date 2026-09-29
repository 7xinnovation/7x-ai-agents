/**
 * Keep the in-app UAE PASS route alive where the app is not listening yet.
 *
 * The chat asks the app to sign the customer in — `postMessage
 * { action: "signin-needed" }` — and Emirates Post's developer has that handler
 * in a build that has not reached TestFlight. On PRODUCTION the live app hears
 * nothing, and what actually signs customers in there today is the older
 * behaviour: ask the app to open UAE PASS, whose callback returns to the
 * embed's own URL with ?uaepass=ok.
 *
 * Taking that away everywhere, to tidy up a TestFlight build, would have
 * removed sign-in from live customers. So it is a setting: ON for production
 * until their build ships, OFF on staging where the handler is being tested
 * against, and one run of this script with --off when it lands.
 *
 * app://login is NOT part of this. That was the half their developer objected
 * to — an unhandled scheme is a native error dialog — and it stays gone.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/nxn-uaepass-fallback-2026-09-29.ts --env <file> [--off] [--dry-run]
 */
import { databaseUrlFrom } from "./lib/envFile";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { agents } from "@dialog/db";
import { eq } from "drizzle-orm";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const ENV = arg("--env");
if (!ENV) throw new Error("--env <envfile> is required");
const WANT = !process.argv.includes("--off");
const DRY = process.argv.includes("--dry-run");
const SLUG = "nxn-dialog";

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrlFrom(ENV!) });
  const db = drizzle(pool, { schema: { agents } });
  try {
    const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG));
    if (!row) throw new Error(`No agent ${SLUG} in this database`);
    const def = JSON.parse(JSON.stringify(row.definition)) as Record<string, any>;
    if (def.nativeUaePassFallback === WANT) {
      console.log(`Already applied — nativeUaePassFallback is ${WANT}`);
      return;
    }
    console.log(`  nativeUaePassFallback: ${JSON.stringify(def.nativeUaePassFallback ?? null)} -> ${WANT}`);
    def.nativeUaePassFallback = WANT;
    if (DRY) { console.log("\n--dry-run: not written."); return; }
    await db.update(agents).set({ definition: def as any }).where(eq(agents.id, row.id));
    console.log("\nWritten.");
  } finally {
    await pool.end();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
