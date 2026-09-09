/**
 * Ask Salesforce what an object's fields are actually called.
 *
 * "Either of Is Primary Contact or  Is Secondary Contact should be selected"
 * rejects every EPGL submission. Those are LABELS; the validation runs on API
 * names we do not have. Their swagger documents Secondary_Contact, we now send
 * it as 'True', and the rule still fires — so it is checking something else.
 *
 * Two wrong guesses have each cost a failed submission, so this asks rather
 * than guesses: a read-only describe against the same sandbox, with the same
 * credentials the integration already uses.
 *
 * Run from apps/web:
 *   npx tsx scripts/epgl-describe-contact-2026-09-09.ts --env <file> [--object Contact]
 */
import { databaseUrlFrom } from "./lib/envFile";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const ENV = arg("--env");
const OBJECT = arg("--object") ?? "Contact";
if (!ENV) throw new Error("--env <envfile> is required");
process.env.DATABASE_URL = databaseUrlFrom(ENV);

import { listIntegrations } from "../lib/integrations";
import { decryptSecret, isEncrypted } from "../lib/crypto";
import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";

interface Field {
  name: string; label: string; type: string;
  nillable: boolean; createable: boolean; defaultedOnCreate: boolean;
  picklistValues?: { value: string }[];
}

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
  const res = await fetch(`${base}/services/data/v62.0/sobjects/${OBJECT}/describe`, {
    headers: { Authorization: `Bearer ${access_token}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`describe failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const desc = (await res.json()) as { fields: Field[] };

  console.log(`\n${OBJECT}: ${desc.fields.length} fields\n`);
  const interesting = desc.fields.filter((f) => /primary|secondary|contact.?type|^is_/i.test(`${f.name} ${f.label}`));
  console.log("MENTIONING PRIMARY / SECONDARY / CONTACT TYPE:");
  for (const f of interesting) {
    console.log(
      `  ${f.name.padEnd(40)} ${String(f.type).padEnd(9)} "${f.label}"` +
        (f.picklistValues?.length ? ` [${f.picklistValues.map((p) => p.value).join(", ")}]` : "") +
        (f.nillable ? "" : "  REQUIRED")
    );
  }
  if (!interesting.length) console.log("  (none — the rule may live on another object)");

  console.log("\nREQUIRED ON CREATE:");
  for (const f of desc.fields) {
    if (!f.nillable && f.createable && !f.defaultedOnCreate) console.log(`  ${f.name.padEnd(40)} "${f.label}"`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
