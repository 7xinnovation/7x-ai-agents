/**
 * What is the licence request NUMBER for a Salesforce record id?
 *
 * The composite returns ids and nothing else, so at the moment of submission we
 * know the application exists and cannot name it: the customer is shown
 * a11FW000X3ht67kYIA, which is not a reference anyone can quote to EPGL.
 *
 * getRequestStatus does not carry it either (salesforceRecordId, licenseNumber,
 * requestStatus, lastUpdated -- no request number), and duplicate-check returns
 * a LIST of every match on the company, which is how a submission ended up
 * quoting an older application's number.
 *
 * This checks whether the plain SOQL endpoint their own spec uses for API 7/8
 * can answer it. Read-only.
 *
 * Run from apps/web:
 *   npx tsx scripts/epgl-request-name-2026-09-10.ts --env <file> --id a11FW000X3ht67kYIA
 */
import { databaseUrlFrom } from "./lib/envFile";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const ENV = arg("--env");
const ID = arg("--id");
if (!ENV || !ID) throw new Error("--env <envfile> --id <salesforce id> are required");
const REQUEST_ID: string = ID;
process.env.DATABASE_URL = databaseUrlFrom(ENV);

import { listIntegrations } from "../lib/integrations";
import { decryptSecret, isEncrypted } from "../lib/crypto";
import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";

async function main() {
  const [agent] = await getDb().select().from(agents).where(eq(agents.slug, "epgl-dialog"));
  if (!agent) throw new Error("epgl-dialog not found");
  const rows = await listIntegrations(agent.id);
  const row = rows.find((r) => /epgl.*salesforce/i.test(r.name));
  const spec = row?.environments.staging ?? row?.environments.production;
  if (!spec) throw new Error("no EPGL Salesforce environment configured");

  const clientSecret = isEncrypted(spec.authValue) ? decryptSecret(spec.authValue) : spec.authValue;
  const tokenRes = await fetch(String(spec.oauthTokenUrl), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: String(spec.oauthClientId),
      client_secret: String(clientSecret),
    }).toString(),
  });
  if (!tokenRes.ok) throw new Error(`token failed: HTTP ${tokenRes.status} ${(await tokenRes.text()).slice(0, 160)}`);
  const { access_token } = (await tokenRes.json()) as { access_token: string };
  const base = String(spec.baseUrl).replace(/\/$/, "");
  const auth = { Authorization: `Bearer ${access_token}`, Accept: "application/json" };

  const soql = `SELECT Id, Name, EPG_Request_Status__c FROM EPG_License_Request__c WHERE Id = '${REQUEST_ID}'`;
  const q = await fetch(`${base}/services/data/v62.0/query?q=${encodeURIComponent(soql)}`, { headers: auth });
  console.log(`\nSOQL  HTTP ${q.status}\n${(await q.text()).slice(0, 600)}`);

  const st = await fetch(`${base}/services/apexrest/EPGL/LicenseRequest/status?id=${encodeURIComponent(REQUEST_ID)}`, { headers: auth });
  console.log(`\ngetRequestStatus?id=  HTTP ${st.status}\n${(await st.text()).slice(0, 400)}`);

  const bare = await fetch(`${base}/services/apexrest/EPGL/LicenseRequest/status`, { headers: auth });
  console.log(`\ngetRequestStatus (no id)  HTTP ${bare.status}\n${(await bare.text()).slice(0, 200)}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
