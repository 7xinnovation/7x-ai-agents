/**
 * Does EPGL's Apex forward the issuance date? (30 October 2026)
 *
 * The describe could not answer it. On epro--preprod2 the agent's integration
 * user is READ-ONLY on every Account field, `Name` included — by their own
 * design: "the Agent integration user must be granted read access on Account,
 * Contact and EPG_Finance_Summary__c". The 1.x agent never writes an Account
 * through sObject REST; it posts a composite-shaped body to
 * /services/apexrest/EPGL/LicenseRequest and THEIR Apex does the DML in system
 * mode. So the only thing that can say whether EPG_Trade_license_issuance_date__c
 * survives that handler is sending one.
 *
 * Which is a write to their sandbox, so it is the smallest one there is: the
 * contract's UPDATE shape, against a company we already put there and already
 * owe them a clear-down for, carrying ONE field. Nothing new to clear down.
 *
 *   SECRETS_KEY=… npx tsx scripts/probe-epgl-issuance-date-write-2026-10-30.ts \
 *     --env <stg env file> --org preprod2                 # read only: what is there
 *     … --account <Account Id> --lr LR-xxxxx --apply      # the one-field update
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
const ORG = arg("--org") ?? "preprod2";
const ENVKEY = arg("--environment") ?? "staging";
const ACCOUNT = arg("--account");
const LR = arg("--lr");
const APPLY = process.argv.includes("--apply");
/** A date nobody would mistake for real data, and obviously ours. */
const THE_DATE = arg("--date") ?? "2013-11-05";

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrlFrom(ENV!) });
  const db = drizzle(pool, { schema: { agents, agentIntegrations } });
  let spec: any;
  try {
    const [agent] = await db.select().from(agents).where(eq(agents.slug, "epgl-dialog"));
    const rows = await db.select().from(agentIntegrations).where(eq(agentIntegrations.agentId, agent!.id));
    for (const r of rows) {
      const e = (r as any).environments?.[ENVKEY];
      if (e?.baseUrl?.includes("salesforce") && String(e.baseUrl).includes(ORG)) spec = e;
    }
  } finally {
    await pool.end();
  }
  if (!spec) throw new Error(`no Salesforce integration matching "${ORG}"`);

  const secret = decryptSecret(spec.authValue);
  if (!secret) throw new Error("could not decrypt the client secret");
  const tok = await fetch(spec.oauthTokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: spec.oauthClientId, client_secret: secret }).toString(),
  });
  if (!tok.ok) throw new Error(`token request failed (HTTP ${tok.status}): ${(await tok.text()).slice(0, 300)}`);
  const { access_token: token, instance_url: instance } = (await tok.json()) as any;
  const base = String(instance ?? spec.baseUrl).replace(/\/$/, "");
  console.log(`org: ${base}\n`);
  const auth = { Authorization: `Bearer ${token}`, Accept: "application/json" };

  const soql = async (q: string) => {
    const r = await fetch(`${base}/services/data/v66.0/query?q=${encodeURIComponent(q)}`, { headers: auth });
    if (!r.ok) return { error: `HTTP ${r.status}: ${(await r.text()).slice(0, 200)}` } as const;
    return (await r.json()) as { totalSize: number; records: any[] };
  };

  const FIELDS = "Id, Name, EPG_Trade_license_no__c, EPG_Trade_license_issuance_date__c, EPG_Trade_Name_in_English__c, EPG_Company_Name_Arabic__c, CreatedDate";

  if (!ACCOUNT) {
    /* ── read only: which of these companies are ours to write to? ───────── */
    console.log("companies this agent put there, newest first:\n");
    const r = await soql(
      `SELECT ${FIELDS} FROM Account WHERE Name LIKE 'DIALOG-TEST%' OR Name LIKE '7X TEST%' ORDER BY CreatedDate DESC LIMIT 15`
    );
    if ("error" in r) { console.log(`  could not read Account: ${r.error}`); }
    else if (!r.totalSize) console.log("  none found — widen the search before writing to anything.");
    else for (const a of r.records)
      console.log(`  ${a.Id}  ${String(a.CreatedDate).slice(0, 10)}  issuance=${a.EPG_Trade_license_issuance_date__c ?? "null"}  TL=${a.EPG_Trade_license_no__c}  ${a.Name}`);

    /**
     * The licence request's lookup to the company is not called what the
     * contract's partner object calls it, so it is asked for rather than
     * guessed — a wrong column name is a 400 and a wasted round trip.
     */
    console.log("\nlicence requests against them:");
    const d = await fetch(`${base}/services/data/v66.0/sobjects/EPG_License_Request__c/describe`, { headers: auth });
    if (!d.ok) console.log(`  could not describe EPG_License_Request__c: HTTP ${d.status}`);
    else {
      const fields = ((await d.json()) as any).fields as any[];
      const toAccount = fields.filter((x) => (x.referenceTo ?? []).includes("Account")).map((x) => x.name);
      console.log(`  (lookups to Account: ${toAccount.join(", ") || "none"})`);
      const cols = ["Id", "Name", "CreatedDate", ...toAccount].join(", ");
      const lr = await soql(`SELECT ${cols} FROM EPG_License_Request__c ORDER BY CreatedDate DESC LIMIT 15`);
      if ("error" in lr) console.log(`  could not read EPG_License_Request__c: ${lr.error}`);
      else for (const x of lr.records)
        console.log(`  ${String(x.Name).padEnd(12)} ${String(x.CreatedDate).slice(0, 10)}  ${toAccount.map((c) => `${c}=${x[c]}`).join(" ")}`);
    }

    console.log("\nNothing was written. Re-run with --account <Id> --lr <LR-xxxxx> --apply to send the one field.");
    return;
  }

  /* ── the one-field update ──────────────────────────────────────────────── */
  const before = await soql(`SELECT ${FIELDS} FROM Account WHERE Id = '${ACCOUNT}'`);
  if ("error" in before) throw new Error(`could not read the account first: ${before.error}`);
  if (!before.totalSize) throw new Error(`no Account ${ACCOUNT}`);
  const a0 = before.records[0];
  console.log(`before:  ${a0.Name}`);
  console.log(`         EPG_Trade_license_issuance_date__c = ${a0.EPG_Trade_license_issuance_date__c ?? "null"}\n`);

  if (!LR) throw new Error("--lr LR-xxxxx is required: the contract's update shape matches on the licence request's Name");
  /**
   * The contract's "update" example is POST on every item, exactly like the
   * issuance one — the handler tells them apart by isAgentSource plus the
   * explicit identifiers. Account's required set is [Name,
   * EPG_Trade_license_no__c, RecordTypeId], so those go back unchanged, read
   * off the record a moment ago: the only value this call is allowed to move
   * is the issuance date.
   */
  const body = {
    allOrNone: true,
    isAgentSource: true,
    compositeRequest: [
      { method: "POST", referenceId: "NewAccount", url: "/services/data/v66.0/sobjects/Account",
        body: {
          Id: ACCOUNT,
          Name: a0.Name,
          EPG_Trade_license_no__c: a0.EPG_Trade_license_no__c,
          RecordTypeId: "0125f000001xIheAAE",
          EPG_Trade_license_issuance_date__c: THE_DATE,
        } },
      { method: "POST", referenceId: "NewLicenseRequest", url: "/services/data/v66.0/sobjects/EPG_License_Request__c",
        body: { Name: LR, RecordTypeId: "0125f000001xIhuAAE" } },
    ],
  };
  console.log("sending:\n" + JSON.stringify(body, null, 2) + "\n");
  if (!APPLY) { console.log("Dry run — nothing sent. Add --apply."); return; }

  const res = await fetch(`${base}/services/apexrest/EPGL/LicenseRequest`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  console.log(`HTTP ${res.status}\n${text.slice(0, 1500)}\n`);

  const after = await soql(`SELECT ${FIELDS} FROM Account WHERE Id = '${ACCOUNT}'`);
  if ("error" in after) throw new Error(`could not read the account back: ${after.error}`);
  const a1 = after.records[0];
  const got = a1.EPG_Trade_license_issuance_date__c ?? null;
  console.log(`after:   EPG_Trade_license_issuance_date__c = ${got ?? "null"}\n`);
  if (got === THE_DATE) console.log("VERDICT: their Apex forwards it. The issuance date reaches the Account.");
  else if (got === (a0.EPG_Trade_license_issuance_date__c ?? null))
    console.log("VERDICT: accepted and DROPPED — the handler does not map this field. It is EPGL's to add; the fallback keeps applications working meanwhile.");
  else console.log(`VERDICT: unexpected — it now reads ${got}. Look at the response above before concluding anything.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
