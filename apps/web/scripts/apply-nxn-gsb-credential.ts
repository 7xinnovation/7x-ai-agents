/**
 * Apply the GSB (MOE) credential to the NXN integration and prove it works.
 *
 * The MOE endpoints answer 401 to the API key alone — verified against box-stg —
 * so until this runs, the issuing-authority list has no source and the agent is
 * under instruction to refuse the question rather than answer it from memory.
 *
 * Two credential shapes are supported, because which one GSB issues is not settled:
 *
 *   OAuth client credentials
 *     GSB_CLIENT_ID=... GSB_CLIENT_SECRET=... GSB_TOKEN_URL=https://... \
 *       npx tsx scripts/apply-nxn-gsb-credential.ts staging
 *
 *   A static bearer / service token
 *     GSB_TOKEN=... npx tsx scripts/apply-nxn-gsb-credential.ts staging
 *
 * Add --verify-only to test the credential currently stored without writing.
 * Against production, pass `production` and set NXN_PROD_BASE_URL / NXN_PROD_API_KEY
 * on first run, since that environment does not exist on the integration yet.
 *
 * The new credential is written BEFORE the live check, so the check exercises what
 * the agent will actually load rather than an in-memory copy. If the check fails
 * the previous spec is put back, so a bad credential cannot leave the integration
 * worse than it was.
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";
import { listIntegrations, upsertEnvironment, type EnvKey, type EnvSpec } from "../lib/integrations";
import { listIssuingEntities } from "../lib/gsbLookup";

const SLUG = "nxn-dialog";
const INTEGRATION = /nxn/i;

const env = (process.argv.find((a) => a === "staging" || a === "production") ?? "staging") as EnvKey;
const verifyOnly = process.argv.includes("--verify-only");

async function main() {
  const db = getDb();
  const [agent] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!agent) throw new Error(`${SLUG} not found`);

  const rows = await listIntegrations(agent.id);
  const row = rows.find((r) => INTEGRATION.test(r.name));
  if (!row) throw new Error("NXN integration not found");

  const existing = row.environments[env] as EnvSpec | undefined;
  const template = existing ?? (row.environments.staging as EnvSpec | undefined);
  if (!template) throw new Error(`no ${env} spec and no staging spec to copy from`);

  const { GSB_CLIENT_ID, GSB_CLIENT_SECRET, GSB_TOKEN_URL, GSB_TOKEN, NXN_PROD_BASE_URL, NXN_PROD_API_KEY } = process.env;

  if (!verifyOnly && !GSB_TOKEN && !(GSB_CLIENT_ID && GSB_CLIENT_SECRET && GSB_TOKEN_URL)) {
    throw new Error(
      "no credential supplied. Set GSB_TOKEN, or GSB_CLIENT_ID + GSB_CLIENT_SECRET + GSB_TOKEN_URL. Use --verify-only to test what is already stored."
    );
  }

  const next: EnvSpec = { ...template };
  if (env === "production") {
    // "for prod it is just box" — box.emiratespost.ae, same path.
    next.baseUrl = NXN_PROD_BASE_URL ?? template.baseUrl.replace("box-stg.", "box.");
    if (NXN_PROD_API_KEY) next.apiKey = NXN_PROD_API_KEY;
  }

  if (!verifyOnly) {
    if (GSB_TOKEN) {
      next.authType = "bearer";
      next.authValue = GSB_TOKEN;
      next.oauthTokenUrl = null;
      next.oauthClientId = null;
    } else {
      // Guarded above: all three are present on this branch.
      next.authType = "oauth2_cc";
      next.oauthTokenUrl = GSB_TOKEN_URL!;
      next.oauthClientId = GSB_CLIENT_ID!;
      next.authValue = GSB_CLIENT_SECRET!;
    }
    // Write first so the live check reads exactly what the agent will use —
    // a check against an in-memory spec proves nothing about what got stored.
    await upsertEnvironment(agent.id, row.name, env, next);
    console.log(`stored ${GSB_TOKEN ? "bearer" : "oauth2_cc"} credential on ${row.name}/${env} (base ${next.baseUrl})`);
  }

  console.log(`verifying against ${next.baseUrl} ...`);
  try {
    const list = await listIssuingEntities(agent.id, env);
    if (!list.length) {
      console.log("  ! the call succeeded but returned no authorities — treat as NOT working and check with Emirates Post");
      process.exitCode = 1;
      return;
    }
    console.log(`  ok — ${list.length} issuing authorities`);
    for (const e of list.slice(0, 5)) {
      console.log(`     ${e.code.padStart(5)}  ${e.nameEn ?? e.nameAr ?? "?"}${e.emirateNameEn ? ` (${e.emirateNameEn})` : ""}${e.isFreeZone ? " [free zone]" : ""}`);
    }
    if (list.length > 5) console.log(`     ... and ${list.length - 5} more`);
    console.log("\nThe agent can now show the real list. The persona rule stops applying on its own:");
    console.log("it only forbids composing a list, and there is now a tool that returns one.");
  } catch (e) {
    const msg = (e as Error).message;
    console.log(`  FAILED: ${msg}`);
    if (msg.includes("GSB_NO_CREDENTIAL")) console.log("  (no bearer configured — supply GSB_TOKEN or the OAuth trio)");
    if (/HTTP 401/.test(msg)) console.log("  (401 — the credential was rejected; the API key alone is not enough here)");
    if (!verifyOnly) {
      if (existing) {
        await upsertEnvironment(agent.id, row.name, env, existing);
        console.log("  rolled back — the previous spec is restored, nothing was left half-applied");
      } else {
        console.log(`  NOTE: ${env} did not exist before this run, so the failing spec is still there; delete it or re-run with a working credential`);
      }
    }
    process.exitCode = 1;
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
