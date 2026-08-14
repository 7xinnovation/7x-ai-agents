/**
 * Which Emirates Post endpoints need a USER SESSION, and which need only the
 * environment API key?
 *
 * This settles what a 401 from /api/MOE/* actually means. Two readings:
 *   (a) we are missing a GSB service credential, or
 *   (b) those endpoints sit behind the signed-in customer's session, exactly like
 *       every other protected endpoint, and no service credential exists at all.
 *
 * The API is built in matched pairs — /api/Guest/Renewal/Details is the anonymous
 * twin of /api/Renewal/Details — so the tiers can be compared directly. If the
 * Guest twins answer on the API key alone while their protected counterparts 401,
 * then 401 means "no user session", and MOE 401ing alongside them is the ordinary
 * behaviour of a protected endpoint rather than evidence of a missing credential.
 *
 * Run from apps/web:  npx tsx scripts/probe-ep-auth-tiers.ts [staging|production]
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
import { listIntegrations, type EnvKey, type EnvSpec } from "../lib/integrations";
import { decryptSecret, isEncrypted } from "../lib/crypto";

const env = (process.argv.find((x) => x === "staging" || x === "production") ?? "staging") as EnvKey;

/** [label, path, tier we expect it to sit in] */
const CASES: Array<[string, string, "guest" | "protected"]> = [
  ["Rental bundles", "/api/Rental/Bundle", "guest"],
  ["Guest issuing entities", "/api/Guest/GetIssuingEntitiesEscher", "guest"],
  ["Guest renewal options", "/api/Guest/Renewal/GetRenewedByOptions", "guest"],
  ["Renewal options (protected twin)", "/api/Renewal/GetRenewedByOptions", "protected"],
  ["Renewal details (protected twin)", "/api/Renewal/Details", "protected"],
  ["Renewal agents (protected)", "/api/Renewal/GetAgents", "protected"],
  ["MOE issuing entities", "/api/MOE/GetIssuingEntities", "protected"],
  ["MOE entities by id", "/api/MOE/GetEntitiesById?entityCode=1", "protected"],
];

async function main() {
  const db = getDb();
  const [a] = await db.select().from(agents).where(eq(agents.slug, "nxn-dialog")).limit(1);
  const rows = await listIntegrations(a!.id);
  const spec = (rows.find((r) => /nxn/i.test(r.name))!.environments as Record<string, EnvSpec>)[env];
  if (!spec) throw new Error(`no ${env} spec`);
  const key = (isEncrypted(spec.apiKey) ? decryptSecret(spec.apiKey) : spec.apiKey) as string;
  if (!key) throw new Error("api key did not decrypt — is SECRETS_KEY set for this environment?");

  console.log(`${env}: ${spec.baseUrl}  (api key only, no bearer)\n`);
  const seen: Record<string, number[]> = { guest: [], protected: [] };

  for (const [label, path, tier] of CASES) {
    const res = await fetch(`${spec.baseUrl}${path}`, {
      headers: { "X-API-KEY": key, Accept: "application/json" },
    });
    seen[tier]!.push(res.status);
    console.log(`  ${String(res.status).padEnd(4)} ${tier.padEnd(9)} ${label}`);
  }

  const guest401 = seen.guest!.filter((s) => s === 401).length;
  const prot401 = seen.protected!.filter((s) => s === 401).length;
  console.log(`\n  guest endpoints 401ing:     ${guest401}/${seen.guest!.length}`);
  console.log(`  protected endpoints 401ing: ${prot401}/${seen.protected!.length}`);
  console.log(
    guest401 === 0 && prot401 === seen.protected!.length
      ? "\n=> A 401 here means NO USER SESSION, not a missing service credential.\n" +
          "   MOE behaves exactly like every other protected endpoint, so it needs the\n" +
          "   signed-in customer's bearer — the same one /api/Account/verifyPasswordLessToken\n" +
          "   mints, or the UAE PASS session the endpoint summaries refer to."
      : "\n=> Mixed result: the tiers do not split cleanly, so the 401 needs another explanation."
  );
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
