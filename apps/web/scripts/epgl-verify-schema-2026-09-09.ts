/**
 * Check every field we send, and every claim in EPGL's review, against their
 * live org — before telling them their spec is wrong.
 *
 * Run from apps/web:
 *   SECRETS_KEY=… npx tsx scripts/epgl-verify-schema-2026-09-09.ts --env <file>
 */
import { databaseUrlFrom } from "./lib/envFile";
const i = process.argv.indexOf("--env");
if (i === -1) throw new Error("--env <envfile> is required");
process.env.DATABASE_URL = databaseUrlFrom(process.argv[i + 1]!);

import { listIntegrations } from "../lib/integrations";
import { decryptSecret, isEncrypted } from "../lib/crypto";
import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";

interface F { name: string; label: string; type: string; createable: boolean; updateable: boolean; calculated: boolean }

/** What we assert, and what to check it against. */
const CLAIMS: { object: string; field: string; expect: "exists" | "absent"; note: string }[] = [
  // Ours, from the describe that produced the blocker report.
  { object: "Contact", field: "Secondary_Contact", expect: "absent", note: "their swagger documents it" },
  { object: "Contact", field: "Is_Primary_Contact__c", expect: "exists", note: "the rule reads it" },
  { object: "Contact", field: "Is_Secondary_Contact__c", expect: "exists", note: "the rule reads it" },
  // Fuad's own corrections, verified rather than taken on trust.
  { object: "EPG_Partner__c", field: "EPG_Company__c", expect: "exists", note: "he says use this" },
  { object: "EPG_Partner__c", field: "EPG_Account__c", expect: "absent", note: "he says it does not exist" },
  { object: "EPG_Partner__c", field: "EPG_Emirates_ID__c", expect: "exists", note: "capital ID" },
  { object: "Members__c", field: "AccountId__c", expect: "exists", note: "he says use this" },
  { object: "Members__c", field: "EPG_Contact__c", expect: "absent", note: "he says it does not exist" },
  { object: "Members__c", field: "EPG_Designation__c", expect: "absent", note: "he says it does not exist" },
  { object: "Members__c", field: "Name", expect: "exists", note: "the member's name" },
  { object: "EPG_License_Request__c", field: "serviceId__c", expect: "exists", note: "he says use this" },
  { object: "EPG_License_Request__c", field: "ServiceNameEN__c", expect: "exists", note: "capital S; their spec says lower" },
  { object: "EPG_License_Request__c", field: "ServiceNameAR__c", expect: "exists", note: "capital S" },
  { object: "EPG_License_Request__c", field: "Activity_Codes__c", expect: "exists", note: "he says use this" },
  { object: "EPG_License_Request__c", field: "EPG_Terms_and_Conditions__c", expect: "exists", note: "he says use this" },
  { object: "EPG_License_Request__c", field: "Terms_Conditions_Accepted__c", expect: "absent", note: "the swagger still lists it" },
  { object: "EPG_License_Request__c", field: "EPG_Current_Emirate__c", expect: "exists", note: "not in the swagger" },
  { object: "EPG_License_Request__c", field: "EPG_Current_Region__c", expect: "exists", note: "not in the swagger" },
  { object: "EPG_License_Request__c", field: "EPG_Payment_Reference__c", expect: "absent", note: "he says no match" },
  { object: "EPG_License_Request__c", field: "EPG_Contact__c", expect: "absent", note: "he says no lookup" },
  { object: "EPG_License_Request__c", field: "EPG_Request_Status__c", expect: "exists", note: "we set it for VIBAN" },
  { object: "EPG_License_Request__c", field: "EPG_Amount_Paid__c", expect: "exists", note: "we send it" },
];

async function main() {
  const [agent] = await getDb().select().from(agents).where(eq(agents.slug, "epgl-dialog"));
  const row = (await listIntegrations(agent!.id)).find((r) => /epgl.*salesforce/i.test(r.name))!;
  const spec = row.environments.staging!;
  const sec = isEncrypted(spec.authValue) ? decryptSecret(spec.authValue) : spec.authValue;
  const tr = await fetch(String(spec.oauthTokenUrl), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: String(spec.oauthClientId), client_secret: String(sec) }).toString(),
  });
  const { access_token } = (await tr.json()) as { access_token: string };
  const base = String(spec.baseUrl).replace(/\/$/, "");

  const cache = new Map<string, Map<string, F>>();
  const describe = async (obj: string) => {
    if (cache.has(obj)) return cache.get(obj)!;
    const r = await fetch(`${base}/services/data/v62.0/sobjects/${obj}/describe`, { headers: { Authorization: `Bearer ${access_token}` } });
    if (!r.ok) throw new Error(`${obj}: HTTP ${r.status}`);
    const d = (await r.json()) as { fields: F[] };
    const m = new Map(d.fields.map((f) => [f.name, f]));
    cache.set(obj, m);
    return m;
  };

  let agree = 0;
  let disagree = 0;
  for (const c of CLAIMS) {
    const fields = await describe(c.object);
    const f = fields.get(c.field);
    const actually = f ? "exists" : "absent";
    const ok = actually === c.expect;
    ok ? agree++ : disagree++;
    const wr = f ? `  createable=${f.createable} updateable=${f.updateable}${f.calculated ? " CALCULATED" : ""}` : "";
    console.log(`${ok ? "ok  " : "MISMATCH"}  ${c.object}.${c.field.padEnd(30)} ${actually.padEnd(7)} (${c.note})${wr}`);
  }
  console.log(`\n${agree} confirmed, ${disagree} contradicted`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
