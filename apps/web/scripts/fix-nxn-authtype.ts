/**
 * Correct the NXN staging integration's auth type.
 *
 * It was declared `uaepass_test`, which means "use the integration's own stored
 * token (authValue) as the bearer" — but no stored token was ever configured
 * (authValue is null). Emirates Post validates the bearer on its rental/guest
 * reads (verified: a meaningless bearer is rejected 401), so the only bearer that
 * ever reached it was the customer's UAE PASS access token, which was being sent
 * because the old token chain fell through to it for every auth type.
 *
 * That made the UAE PASS identity token accidentally load-bearing. Tightening the
 * chain so identity tokens only go where a spec declares them (FB-1485) therefore
 * left these operations with no bearer at all.
 *
 * `uaepass_live` is the auth type that legitimately means "the customer's UAE PASS
 * session is the bearer", which is exactly this integration's arrangement. Setting
 * it restores the working behaviour while keeping the FB-1485 guarantee: the
 * identity token is only sent where the configuration says it belongs, and it can
 * no longer clobber a service token on some other integration.
 *
 * Run from apps/web:  DATABASE_URL="<env>" npx tsx scripts/fix-nxn-authtype.ts [--dry-run]
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import { getDb, agents, agentIntegrations } from "@dialog/db";
import { eq } from "drizzle-orm";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const db = getDb();
  const [agent] = await db.select().from(agents).where(eq(agents.slug, "nxn-dialog")).limit(1);
  if (!agent) throw new Error("nxn-dialog not found");
  const rows = await db.select().from(agentIntegrations).where(eq(agentIntegrations.agentId, agent.id));

  let changed = 0;
  for (const row of rows) {
    const envs = (row.environments ?? {}) as Record<string, { authType?: string; authValue?: string | null; apiKey?: string | null }>;
    for (const [envKey, spec] of Object.entries(envs)) {
      if (!spec) continue;
      const hasStoredToken = Boolean(spec.authValue);
      console.log(
        `${row.name} [${envKey}]: authType=${spec.authType} storedToken=${hasStoredToken} gatewayKey=${Boolean(spec.apiKey)}`
      );
      // Only correct the exact misconfiguration: declared as "use my stored token"
      // while holding none. An integration that really has a service token is left
      // alone — its token must keep winning over any customer identity token.
      if (spec.authType === "uaepass_test" && !hasStoredToken) {
        spec.authType = "uaepass_live";
        changed++;
        console.log(`  → set authType to uaepass_live (no stored token to use)`);
      }
    }
    if (changed && !dryRun) {
      await db.update(agentIntegrations).set({ environments: envs }).where(eq(agentIntegrations.id, row.id));
    }
  }
  console.log(`\n${changed} environment(s) ${dryRun ? "would be" : ""} updated.`);
  if (!changed) console.log("Nothing to change — already correct.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
