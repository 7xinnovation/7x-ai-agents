/**
 * EPGL signs in on their own site, not in our popup (2026-09-22).
 *
 * Until now `hostLoginUrl` was unset on the EPGL agent, so pressing sign in
 * opened OUR UAE PASS popup: client `epg_web_prod`, redirect
 * `https://agent.7x.ae/api/uaepass/callback`. That redirect is not registered
 * against their client, so UAE PASS answered with its own error page and the
 * customer got "Sorry! Looks like something went wrong at our end."
 *
 * It was never going to work, and it was never meant to. EPGL run their own UAE
 * PASS integration on app.epgl.ae -- a Salesforce Experience Cloud site whose
 * auth provider is registered with the callback they told us about. Checked
 * live today, their site's own sign-in reaches UAE PASS correctly:
 *
 *   GET https://app.epgl.ae/services/auth/sso/uaepass
 *     -> 302 https://id.uaepass.ae/idshub/authorize
 *            ?client_id=epg_web_prod
 *            &redirect_uri=https%3A%2F%2Fapp.epgl.ae%2Fservices%2Fauthcallback%2Fuaepass
 *
 * ONE SITE, TWO LOGIN PAGES. EPGL have no staging twin of app.epgl.ae: both
 * environments point at the same host, and what differs is the page. They gave
 * us both, and this does not guess between them -- the environment is an
 * argument and the script refuses without one, because writing production's
 * page into staging is the kind of mistake that only surfaces as a tester
 * signing into the wrong place.
 *
 * This is the same shape Emirates Post already uses: NXN's hostLoginUrl is
 * https://box.emiratespost.ae/uaepass. The customer signs in on the host's own
 * site, the host's page runs dialog-relay.js, and the token comes back to the
 * widget. EPGL have added the relay to app.epgl.ae — confirmed by
 * `https://agent.7x.ae/dialog-relay.js` appearing in that site's CSP script-src.
 *
 * WHAT THIS DOES NOT FIX. The token the relay hands over is still DROPPED by the
 * chat route: verification has two paths, a signed JWT against a configured key
 * (no HOST_TOKEN_* is set in either environment) and Emirates Post's identity
 * service (resolved by looking for an integration named `nxn`, which the EPGL
 * agent does not have). So after this the popup reaches a real sign-in instead
 * of an error page, and the customer still will not be recognised until an EPGL
 * verification path exists. Setting this is a prerequisite, not the whole job.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/epgl-host-login-2026-09-22.ts --target staging|production [--clear] [--env <file>] [--dry-run]
 *
 * `--clear` puts it back to unset, which sends sign-in through our own UAE PASS
 * popup again. Staging was reverted that way on 22 September: testers were
 * mid-round there, staging's UAE PASS client is the sandbox (and
 * UAEPASS_MOCK_ALLOWED is on), so our own popup is the thing that actually works
 * for them today. Production keeps the host login.
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

/** EPGL's own sign-in pages, as they gave them to us on 22 September. */
const LOGIN_PAGE: Record<string, string> = {
  staging: "https://app.epgl.ae/s/login-epgl?language=en_US",
  production: "https://app.epgl.ae/s/login/?language=en_US",
};

const target = process.argv[process.argv.indexOf("--target") + 1] ?? "";
const clear = process.argv.includes("--clear");
if (!LOGIN_PAGE[target]) {
  console.error(`Pass --target staging|production (got ${JSON.stringify(target)}).`);
  process.exit(1);
}
const HOST_LOGIN_URL = clear ? null : LOGIN_PAGE[target]!;
const dryRun = process.argv.includes("--dry-run");

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`No agent ${SLUG} in this database`);
  const def = row.definition as any;

  /**
   * The popup returns by postMessage to its opener, and the widget only accepts
   * that from an origin the agent is configured to be embedded on. A login URL
   * whose origin is not in allowedOrigins would sign the customer in and then
   * throw the token away, which is worse than not offering it.
   */
  if (HOST_LOGIN_URL) {
    const origin = new URL(HOST_LOGIN_URL).origin;
    const allowed: string[] = def.allowedOrigins ?? [];
    if (!allowed.some((o) => { try { return new URL(o).origin === origin; } catch { return false; } })) {
      throw new Error(
        `${origin} is not in this agent's allowedOrigins (${allowed.join(", ") || "none"}) — ` +
        `add it there first, or the token the sign-in returns will be refused`
      );
    }
  }

  const current = def.hostLoginUrl ?? null;
  if (current === HOST_LOGIN_URL) {
    console.log(`Already applied — hostLoginUrl is ${JSON.stringify(current)}`);
    return;
  }
  console.log(`  hostLoginUrl: ${JSON.stringify(current)} -> ${JSON.stringify(HOST_LOGIN_URL)}`);
  // Removed rather than set to null: the schema has it optional, and an explicit
  // null is a value the parser has to tolerate for no reason.
  if (HOST_LOGIN_URL) def.hostLoginUrl = HOST_LOGIN_URL;
  else delete def.hostLoginUrl;

  if (dryRun) {
    console.log("\n--dry-run: not written.");
    return;
  }
  await db.update(agents).set({ definition: def }).where(eq(agents.id, row.id));
  console.log("\nWritten.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
