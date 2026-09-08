/**
 * Salesforce's review of LR-37214, applied to the EPGL agent definition.
 *
 * Fuad Alnsour checked the submission trace we sent (docs/EPGL-SUBMISSION-TRACE-
 * LR-37214.md) against their schema on 8 September 2026 and listed the fields
 * that do not exist on the objects we were writing to. The renames themselves
 * are enforced in code — lib/epglFields.ts runs on every composite — but the
 * model should compose the right names in the first place rather than have them
 * corrected underneath it, so the apiFlow notes are corrected too.
 *
 * It also fixes what fed the worst of it: `activity_codes` was auto-filled from
 * the trade licence and locked, so LR-37214's postal licence went out carrying
 * "Coffee Shop, Restaurant". Activity_Codes__c takes the numeric postal codes,
 * and the customer is the only one who can say which they are applying for.
 *
 * Idempotent — every edit checks for its own result first.
 *
 * Run from apps/web:
 *   npx tsx scripts/epgl-salesforce-field-names-2026-09-08.ts --env <file> [--apply]
 */
import { databaseUrlFrom } from "./lib/envFile";

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

/** The corrections, as one block the model cannot read past. */
const FIELD_NAMES =
  " SALESFORCE FIELD NAMES (2026-09-08, confirmed by EPGL against their schema — these are the ONLY correct spellings; do not improvise): " +
  "EPG_Partner__c: the account link is EPG_Company__c (NOT EPG_Account__c) and the Emirates ID is EPG_Emirates_ID__c with a CAPITAL ID — the casing is load-bearing, because their update-matching reads that exact spelling and the wrong one silently creates a duplicate partner on every resubmission instead of failing. " +
  "Members__c: the account link is AccountId__c (NOT EPG_Account__c); EPG_Contact__c and EPG_Designation__c do NOT exist on this object — never send them. Always send the member's Name: it is their matching key, and a member without one is filed as 'Unknown Member'. If you do not have a name for a member, omit the Members__c item entirely. " +
  "Contact: EPG_Designation__c IS valid here (it is Members__c that has no such field). " +
  "User: the portal user's Emirates ID is EPG_Emirates_Id__c — lowercase 'd', the opposite of EPG_Partner__c. Both spellings are correct, on their own object only. " +
  "EPG_License_Request__c: serviceId__c, serviceNameEN__c and serviceNameAR__c all end in __c; the activities field is Activity_Codes__c (NOT EPG_Activity_Codes__c); terms acceptance is EPG_Terms_and_Conditions__c (NOT Terms_Conditions_Accepted__c); the emirate and region on the REQUEST are EPG_Current_Emirate__c and EPG_Current_Region__c (EPG_Emirates__c and EPG_Region__c are the ACCOUNT's fields and stay as they are on the Account item). EPG_Account__c is correct on this object — do not rename it. " +
  "ACTIVITY CODES: Activity_Codes__c takes the NUMERIC postal activity codes, comma-separated, never descriptive text. The only accepted values are 5320002 (Letters & Post Items Delivery), 5320007 (Documents Delivery) and 5320009 (Parcels Delivery) — e.g. \"5320002,5320009\". These are the POSTAL activities the customer is applying to carry out; they are NOT the company's trade-licence activities. Never copy the DED activity list off the trade licence into this field.";

const UPDATE_MATCHING =
  " HOW AN UPDATE IS MATCHED (2026-09-08, from EPGL): a request whose trade licence number already exists on a customer account is treated as an UPDATE of the WHOLE request — you do not opt into this, the trade licence number triggers it. Each related record is then matched on its own key, and anything unmatched is created new. The keys are: Account -> EPG_Trade_license_no__c; EPG_Partner__c -> EPG_Emirates_ID__c within the matched account; Contact -> Email; Members__c -> Name; User -> EPG_Emirates_Id__c (or passport number); EPG_Document__c -> EPG_File_Id__c; EPG_License_Request__c -> its Name, which is the licence request number (e.g. LR-37214) as returned by epglsalesforce__duplicateCheck (matchedRequestNumber) or epglsalesforce__getRequestStatus. Send that Name whenever you are updating an existing application, and never invent one.";

/** What the field should ask for now that it drives Activity_Codes__c. */
const ACTIVITY_FIELD = {
  label: {
    en: "Postal activities applied for",
    ar: "الأنشطة البريدية المطلوب ترخيصها",
  },
  help: {
    en: "Which postal services will the company provide? One or more of: Letters & Post Items Delivery, Documents Delivery, Parcels Delivery.",
    ar: "ما الخدمات البريدية التي ستقدمها الشركة؟ واحد أو أكثر من: توصيل الرسائل والمواد البريدية، توصيل المستندات، توصيل الطرود.",
  },
};

const ASK_ACTIVITIES =
  " POSTAL ACTIVITIES (2026-09-08): activity_codes is the customer's answer, not something to read off the trade licence. Ask which postal services the company will provide and accept one or more of exactly these three: Letters & Post Items Delivery, Documents Delivery, Parcels Delivery. The company's DED trade-licence activities are NOT the answer — a restaurant applying for a postal licence still has to say which postal service it will carry out. Record what they chose by name; the numeric code is added for you.";

/**
 * Value equality that survives a round trip through jsonb.
 *
 * Postgres does not preserve object key order, so a plain JSON.stringify
 * comparison reports every localized label as changed on a second run and the
 * script rewrites values identical to the ones already there.
 */
const canon = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canon)
    : v && typeof v === "object"
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canon(x)]))
      : v;
const same = (a: unknown, b: unknown) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrlFrom(ENV!) });
  const db = drizzle(pool, { schema: { agents } });
  try {
    const [row] = await db.select().from(agents).where(eq(agents.slug, "epgl-dialog"));
    if (!row) throw new Error("epgl-dialog not found in this database");
    const def = JSON.parse(JSON.stringify(row.definition)) as Record<string, any>;
    const changes: string[] = [];

    for (const j of def.journeys ?? []) {
      const flow = j.submission?.apiFlow;
      if (!flow) continue;

      if (!String(flow.notes ?? "").includes("SALESFORCE FIELD NAMES (2026-09-08")) {
        flow.notes = String(flow.notes ?? "") + FIELD_NAMES;
        changes.push(`${j.key}.apiFlow.notes += field names`);
      }
      if (!String(flow.notes ?? "").includes("HOW AN UPDATE IS MATCHED (2026-09-08")) {
        flow.notes = String(flow.notes ?? "") + UPDATE_MATCHING;
        changes.push(`${j.key}.apiFlow.notes += update matching`);
      }

      // The guidance the model reads while it is still COLLECTING, so the wrong
      // value never reaches the composite in the first place.
      if (j.key === "new_license" && !String(j.guidance ?? "").includes("POSTAL ACTIVITIES (2026-09-08")) {
        j.guidance = String(j.guidance ?? "") + ASK_ACTIVITIES;
        changes.push("new_license.guidance += postal activities");
      }

      for (const step of j.steps ?? []) {
        for (const f of step.fields ?? []) {
          if (f.key !== "activity_codes") continue;
          if (!same(f.label, ACTIVITY_FIELD.label)) {
            f.label = ACTIVITY_FIELD.label;
            changes.push(`${j.key}/${step.key}.activity_codes.label`);
          }
          if (!same(f.help, ACTIVITY_FIELD.help)) {
            f.help = ACTIVITY_FIELD.help;
            changes.push(`${j.key}/${step.key}.activity_codes.help`);
          }
          // It was locked and auto-filled from the trade licence. That is what
          // put "Coffee Shop, Restaurant" on a postal licence application.
          if (f.editable !== true) {
            f.editable = true;
            changes.push(`${j.key}/${step.key}.activity_codes.editable -> true`);
          }
        }
      }
    }

    if (!changes.length) {
      console.log("nothing to do — already applied.");
      return;
    }
    console.log(`${changes.length} change(s):`);
    for (const c of changes) console.log(`   ~ ${c}`);
    if (APPLY) {
      await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
      console.log("\nwritten.");
    } else {
      console.log("\nDry run — nothing written. Add --apply to write.");
    }
  } finally {
    await pool.end();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
