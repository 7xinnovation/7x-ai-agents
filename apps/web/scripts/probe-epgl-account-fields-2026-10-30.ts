/**
 * Is EPG_Trade_license_issuance_date__c writable? (30 October 2026)
 *
 * It is the one field in the 30 October fix that EPGL's contract does not
 * promise: it appears in their API 7 read query over Account and nowhere in
 * the Account write schema. The composite is allOrNone, so if the portal may
 * not create it, sending it would roll back the whole licence application —
 * which is why the submission notes carry a single retry without it.
 *
 * This answers the question WITHOUT writing anything: Salesforce's describe
 * says, per field, whether this connected app may create and update it. One
 * GET against the sandbox the staging agent already talks to.
 *
 * Run from apps/web:
 *   SECRETS_KEY=… npx tsx scripts/probe-epgl-account-fields-2026-10-30.ts --env <stg env file>
 */
import { databaseUrlFrom } from "./lib/envFile";
import { decryptSecret } from "../lib/crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { agents, agentIntegrations } from "@dialog/db";
import { eq } from "drizzle-orm";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const ENV = arg("--env");
if (!ENV) throw new Error("--env <envfile> is required");
const SLUG = arg("--slug") ?? "epgl-dialog";
const ENVKEY = arg("--environment") ?? "staging";

/** What the 30 October change sends, and the two it sits between. */
const ASKED = [
  "EPG_Trade_license_issuance_date__c",
  "EPG_Trade_license_Expiry_date__c",
  "License_Expiry_Date__c",
  "EPG_Trade_Name_in_English__c",
  "EPG_Trade_Name_in_Arabic__c",
  "EPG_Company_Name_Arabic__c",
  "EPG_Trade_license_no__c",
  "Name",
];

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrlFrom(ENV!) });
  const db = drizzle(pool, { schema: { agents, agentIntegrations } });
  let spec: any;
  try {
    const [agent] = await db.select().from(agents).where(eq(agents.slug, SLUG));
    if (!agent) throw new Error(`${SLUG} not found`);
    const rows = await db.select().from(agentIntegrations).where(eq(agentIntegrations.agentId, agent.id));
    for (const r of rows) {
      const e = (r as any).environments?.[ENVKEY];
      if (e?.baseUrl?.includes("salesforce")) spec = e;
    }
  } finally {
    await pool.end();
  }
  if (!spec) throw new Error(`no Salesforce integration under environment "${ENVKEY}"`);
  console.log(`org:      ${spec.baseUrl}`);
  console.log(`auth:     ${spec.authType}\n`);

  const secret = decryptSecret(spec.authValue);
  if (!secret) throw new Error("could not decrypt the client secret — is SECRETS_KEY the one this row was written with?");

  const tok = await fetch(spec.oauthTokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: spec.oauthClientId, client_secret: secret }).toString(),
  });
  if (!tok.ok) throw new Error(`token request failed (HTTP ${tok.status}): ${(await tok.text()).slice(0, 300)}`);
  const { access_token: token, instance_url: instance } = (await tok.json()) as any;
  const base = String(instance ?? spec.baseUrl).replace(/\/$/, "");

  const res = await fetch(`${base}/services/data/v66.0/sobjects/Account/describe`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`describe failed (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as { fields: any[] };
  const by = new Map(body.fields.map((f) => [f.name, f]));
  console.log(`Account has ${body.fields.length} fields this connected app can see.\n`);
  console.log("field                                 type       create  update");
  console.log("-".repeat(70));
  for (const name of ASKED) {
    const f = by.get(name);
    if (!f) { console.log(`${name.padEnd(37)} — NOT PRESENT / NOT VISIBLE TO THIS APP`); continue; }
    console.log(
      `${name.padEnd(37)} ${String(f.type).padEnd(10)} ${String(f.createable).padEnd(7)} ${f.updateable}`
    );
  }
  const issuance = by.get("EPG_Trade_license_issuance_date__c");
  console.log("");
  if (!issuance) console.log("VERDICT: the field is not visible to this connected app at all — keep the fallback, and do not send it.");
  else if (issuance.createable) console.log("VERDICT: writable. The fallback will never fire; the issuance date goes with the application.");
  else console.log("VERDICT: readable but NOT createable — sending it would roll the application back. The fallback is load-bearing.");

  // Anything else on Account that looks like a licence date, in case the one
  // the page layout shows is not the one their read query names.
  const dates = body.fields.filter((f) => /licen[cs]e/i.test(f.name) && /date/i.test(f.name));
  console.log(`\nevery licence date field on Account (${dates.length}):`);
  for (const f of dates) console.log(`   ${f.name.padEnd(40)} ${String(f.type).padEnd(10)} create=${f.createable} update=${f.updateable}  "${f.label}"`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
