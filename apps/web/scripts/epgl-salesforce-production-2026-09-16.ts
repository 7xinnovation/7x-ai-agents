/**
 * Point the EPGL agent at the LIVE Emirates Post Salesforce org (2026-09-16).
 *
 * Until today the production agent had exactly one environment on its Salesforce
 * integration — `staging`, aimed at `epro--preprod2.sandbox.my.salesforce.com` —
 * and `activeEnvironment: "staging"` to match. Every licence request the live
 * agent created landed in a sandbox. Emirates Post have now delivered the
 * production connected-app credentials, so this adds the missing environment and
 * flips the agent onto it.
 *
 * WHERE THE CREDENTIALS COME FROM: the delivered Postman collection, read at run
 * time from the path given on the command line. Nothing is typed into this file
 * and nothing is committed — the client secret goes into the database encrypted
 * by `upsertEnvironment`, which is the only place it should live.
 *
 * THE OPERATIONS ARE COPIED VERBATIM FROM STAGING. The four Apex REST endpoints
 * (`/EPGL/LicenseRequest`, `/status`, `/duplicate-check`, `/EPGL/Document`) are
 * the same contract in both orgs; only the host and the credentials differ.
 *
 * THE RECORD TYPE AND SERVICE IDS IN THE JOURNEY GUIDANCE ARE ALREADY RIGHT.
 * That was the thing worth checking before flipping anything: the agent's
 * payload notes name `0125f000001xIheAAE` (Account / Licensed Company),
 * `0125f000001xIhwAAE` (Renewal), `0125f000001xIhuAAE` (New License),
 * `a1H5f0000033Q7lEAE` (License Renewal) and `a1H5f0000033Q7pEAE` (New License).
 * A read-only query against the production org returns those exact ids — PreProd
 * is a refresh of production and kept the metadata ids — so the guidance does
 * not have to change. This script re-asserts that with a live query and REFUSES
 * TO FLIP if any of them is missing, because sending a sandbox record type id to
 * a live org fails with "invalid cross reference id" and the customer sees a
 * submission that silently did not happen.
 *
 * Run from apps/web:
 *   DATABASE_URL=<prod> SECRETS_KEY=<prod> npx tsx scripts/epgl-salesforce-production-2026-09-16.ts \
 *     "../../Agent AI.postman_collection.json" [--dry-run] [--no-flip]
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

const envArg = process.argv.indexOf("--env");
config({
  path:
    envArg !== -1 && process.argv[envArg + 1]
      ? resolve(process.argv[envArg + 1]!)
      : resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env"),
});

import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";
import { listIntegrations, upsertEnvironment, type EnvSpec } from "../lib/integrations";

const SLUG = "epgl-dialog";
const dryRun = process.argv.includes("--dry-run");
const noFlip = process.argv.includes("--no-flip");

/** Ids the agent's payload guidance hard-codes. All of them must exist in the org we are about to trust. */
const REQUIRED_IDS: Record<string, string> = {
  "0125f000001xIheAAE": "Account record type — Licensed Company",
  "0125f000001xIhuAAE": "Licence request record type — New License",
  "0125f000001xIhwAAE": "Licence request record type — Renewal",
  "a1H5f0000033Q7pEAE": "Service — New License",
  "a1H5f0000033Q7lEAE": "Service — License Renewal",
};

/** The production connected app, as Emirates Post delivered it. */
async function credentials(file: string) {
  const col = JSON.parse(await readFile(file, "utf8")) as {
    item: { name: string; request: { url: { raw: string }; body?: { urlencoded?: { key: string; value: string }[] } } }[];
  };
  const item = col.item.find((i) => /prod/i.test(i.name));
  if (!item) throw new Error(`no "Prod" request in ${file}`);
  const form = Object.fromEntries((item.request.body?.urlencoded ?? []).map((f) => [f.key, f.value]));
  const tokenUrl = item.request.url.raw;
  if (form.grant_type !== "client_credentials") throw new Error(`unexpected grant_type ${form.grant_type}`);
  if (!form.client_id || !form.client_secret) throw new Error("client_id / client_secret missing");
  if (/sandbox|--/.test(new URL(tokenUrl).hostname)) throw new Error(`${tokenUrl} is not a production host`);
  return { clientId: form.client_id, clientSecret: form.client_secret, tokenUrl, baseUrl: new URL(tokenUrl).origin };
}

/** Prove the grant works and the org holds the ids our guidance names. Read-only. */
async function verify(c: Awaited<ReturnType<typeof credentials>>) {
  const res = await fetch(c.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: c.clientId, client_secret: c.clientSecret }),
  });
  const tok = (await res.json()) as { access_token?: string; instance_url?: string; error_description?: string };
  if (!res.ok || !tok.access_token) throw new Error(`token HTTP ${res.status}: ${tok.error_description ?? "no access_token"}`);
  console.log(`  token      ok — instance ${tok.instance_url}`);

  const query = async (soql: string) => {
    const r = await fetch(`${tok.instance_url}/services/data/v66.0/query?q=${encodeURIComponent(soql)}`, {
      headers: { authorization: `Bearer ${tok.access_token}` },
    });
    const j = (await r.json()) as { records?: { Id: string }[] };
    if (!r.ok) throw new Error(`query HTTP ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
    return (j.records ?? []).map((x) => x.Id);
  };

  const found = new Set([
    ...(await query("SELECT Id FROM RecordType WHERE SobjectType IN ('Account','EPG_License_Request__c')")),
    ...(await query("SELECT Id FROM EPG_Service__c")),
  ]);
  const missing = Object.entries(REQUIRED_IDS).filter(([id]) => !found.has(id));
  for (const [id, what] of Object.entries(REQUIRED_IDS)) {
    console.log(`  ${found.has(id) ? "ok        " : "MISSING   "} ${id}  ${what}`);
  }
  if (missing.length) throw new Error(`${missing.length} id(s) the payload guidance names are not in the production org`);
}

async function main() {
  const file = process.argv[2];
  if (!file || file.startsWith("--")) throw new Error("pass the path to the delivered Postman collection");

  const c = await credentials(file);
  console.log(`credentials from ${file}`);
  console.log(`  client_id  ${c.clientId.slice(0, 12)}…${c.clientId.slice(-4)}`);
  console.log(`  token url  ${c.tokenUrl}\n`);

  const db = getDb();
  const [agent] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!agent) throw new Error(`${SLUG} not found`);
  const rows = await listIntegrations(agent.id);
  const row = rows.find((r) => /salesforce/i.test(r.name));
  if (!row) throw new Error("EPGL Salesforce integration not found");
  const staging = row.environments.staging as EnvSpec | undefined;
  if (!staging) throw new Error("no staging spec to copy the operations from");

  const prod: EnvSpec = {
    ...staging,
    baseUrl: c.baseUrl,
    // The spec is only read when operations are re-imported, and the staging one
    // points at a laptop. Better empty than a localhost URL stored in production.
    specUrl: "",
    authType: "oauth2_cc",
    authValue: c.clientSecret,
    oauthClientId: c.clientId,
    oauthTokenUrl: c.tokenUrl,
  };

  const def = agent.definition as { activeEnvironment?: string; [k: string]: unknown };
  console.log(`integration : ${row.name}`);
  console.log(`  staging   : ${staging.baseUrl}`);
  console.log(`  production: ${prod.baseUrl}`);
  console.log(`  operations: ${(prod.operations ?? []).length} (copied from staging)`);
  console.log(`agent activeEnvironment: ${def.activeEnvironment} -> ${noFlip ? def.activeEnvironment : "production"}\n`);

  console.log("verifying the live org before writing anything ...");
  await verify(c);

  if (dryRun) {
    console.log("\n--dry-run, nothing written");
    return;
  }

  await upsertEnvironment(agent.id, row.name, "production", prod);
  console.log("\n  production environment stored (secret encrypted at rest)");

  if (noFlip) {
    console.log("  --no-flip: the agent still runs against PreProd");
    return;
  }
  def.activeEnvironment = "production";
  await db.update(agents).set({ definition: def as never }).where(eq(agents.id, agent.id));
  console.log("  agent flipped to production — live licence requests now go to epro.my.salesforce.com");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(`\n${(e as Error).message}`);
    process.exit(1);
  });
