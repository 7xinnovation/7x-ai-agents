/**
 * Three fields EPGL were never sent (30 October 2026, LR-39149).
 *
 * Their three reports are one story told from three sides: the trade licence is
 * read, and what is read off it does not all reach the Account.
 *
 *  1. The Arabic company name arrived a letter short. That one is not fixed
 *     here — it is the PDF, and the fix is in the extractor's prompt. Dubai
 *     DET's licence drops the alef out of every lam-alef pair and the ya off
 *     the end of a word IN THE TEXT LAYER; `pdftotext` on their own file shows
 *     it. See the rule in packages/core/src/ai/extract.ts.
 *  2. The trade licence ISSUANCE DATE was blank. It had nowhere to go: the
 *     journey has `license_expiry_date` and has never had an issue date, so
 *     nothing read it and nothing sent it. Added here.
 *  3. Both TRADE NAMES were blank. The fields exist (11 September) but the
 *     licence heads that line "Business Name", and the submission notes never
 *     named the Account fields they belong in. Both ends fixed here.
 *
 * The Salesforce field names are EPGL's own, taken from the contract file
 * (`epgl-license-requests-api-latest`): EPG_Trade_license_issuance_date__c,
 * EPG_Trade_Name_in_English__c and EPG_Trade_Name_in_Arabic__c, all on Account.
 * The first appears in their API 7 read query over Account, which is where it
 * is known to exist; nothing in the contract says it is writable, so the first
 * run that sends it is also the test of that.
 *
 * ISSUANCE ONLY. On a renewal the portal may edit four Account fields and the
 * issuance date is not one of them ("Only EPG_Trade_license_no__c,
 * EPG_Trade_license_Expiry_date__c, EPG_Trade_Name_in_English__c,
 * EPG_Trade_Name_in_Arabic__c are editable on the portal"), so the renewal
 * journey is left alone apart from its trade names.
 *
 * Idempotent, and safe against a database that is several rounds behind: every
 * change is made only where it is missing. Run from apps/web:
 *   npx tsx scripts/epgl-licence-fields-2026-10-30.ts --env <file> [--apply]
 */
import { databaseUrlFrom } from "./lib/envFile";
import { applyLicenceFields } from "./lib/epglLicenceFields";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const ENV = arg("--env");
const APPLY = process.argv.includes("--apply");
if (!ENV) throw new Error("--env <envfile> is required");

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { agents } from "@dialog/db";
import { eq } from "drizzle-orm";

const SLUG = "epgl-dialog";

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrlFrom(ENV!) });
  const db = drizzle(pool, { schema: { agents } });
  try {
    const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG));
    if (!row) throw new Error(`${SLUG} not found in this database`);
    const def = JSON.parse(JSON.stringify(row.definition)) as Record<string, any>;

    /* ── what is there now, before anything is touched ─────────────────── */
    console.log(`${SLUG} — before:`);
    for (const j of def.journeys ?? []) {
      for (const s of j.steps ?? []) {
        const keys = (s.fields ?? []).map((f: any) => String(f.key));
        const interesting = keys.filter((k: string) =>
          /^(company_name|company_name_ar|trade_name_en|trade_name_ar|trade_license_number|license_issue_date|license_expiry_date)$/.test(k)
        );
        if (interesting.length) console.log(`   ${j.key}/${s.key}: ${interesting.join(", ")}`);
      }
      const notes = String(j.submission?.apiFlow?.notes ?? "");
      console.log(`   ${j.key}: apiFlow notes ${notes.length} chars, guidance ${String(j.guidance ?? "").length} chars`);
    }
    console.log("");

    const changes = applyLicenceFields(def);

    if (!changes.length) {
      console.log("nothing to do — already applied.");
      return;
    }
    console.log(`${changes.length} change(s):`);
    for (const c of changes) console.log(`   ~ ${c}`);
    if (APPLY) {
      await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
      console.log("\nwritten.");
    } else console.log("\nDry run — nothing written. Add --apply to write.");
  } finally {
    await pool.end();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
