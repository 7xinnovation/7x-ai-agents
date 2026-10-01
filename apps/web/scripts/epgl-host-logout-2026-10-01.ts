/**
 * EPGL's sign-out has to end a Salesforce session, not a localStorage key.
 *
 * Emirates Post's portal keeps its session in `localStorage`, so the relay on
 * their pages can clear it once the site opts in with
 * data-signout-clears-host="1" — that is what three days at the end of
 * September were spent getting right.
 *
 * EPGL's portal is Salesforce Experience Cloud (app.epgl.ae, and the
 * epro--preprod2 sandbox on staging) and keeps its session in an HttpOnly `sid`
 * cookie. No script of ours touches that from any origin, relay or not. Handing
 * their developer the same attribute would have cleared the handover token,
 * left the customer signed in to the community, and looked identical from the
 * outside: sign out, click sign in, straight back in.
 *
 * Salesforce ends it at /secur/logout.jsp. So the agent is given a
 * `hostLogoutUrl` and the sign-out visits it between clearing the host's
 * storage and ending the UAE PASS session.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/epgl-host-logout-2026-10-01.ts --env <file> [--dry-run]
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
const DRY = process.argv.includes("--dry-run");
const SLUG = "epgl-dialog";

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrlFrom(ENV!) });
  const db = drizzle(pool, { schema: { agents } });
  try {
    const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG));
    if (!row) throw new Error(`No agent ${SLUG} in this database`);
    const def = JSON.parse(JSON.stringify(row.definition)) as Record<string, unknown>;

    /**
     * DERIVED FROM THE SIGN-IN URL, NOT TYPED IN.
     *
     * Staging signs in at the epro--preprod2 sandbox and production at
     * app.epgl.ae, and a logout URL pasted from the wrong environment is a
     * sign-out that silently does nothing — or worse, one that ends a session
     * on the other system. The origin that signs them in is the origin that
     * signs them out.
     */
    const login = String(def.hostLoginUrl ?? "");
    if (!login) throw new Error(`${SLUG} has no hostLoginUrl here, so there is no portal to sign out of`);
    const want = `${new URL(login).origin}/secur/logout.jsp`;

    if (def.hostLogoutUrl === want) {
      console.log(`  (already) hostLogoutUrl = ${want}`);
      console.log("\nAlready applied — nothing to change.");
      return;
    }
    console.log(`  · hostLoginUrl  = ${login}`);
    console.log(`  ${def.hostLogoutUrl ? "~" : "+"} hostLogoutUrl = ${want}`);
    if (DRY) { console.log("\n--dry-run: NOT written."); return; }
    def.hostLogoutUrl = want;
    await db.update(agents).set({ definition: def as unknown as typeof row.definition }).where(eq(agents.id, row.id));
    console.log("\n1 change written.");
  } finally {
    await pool.end();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
