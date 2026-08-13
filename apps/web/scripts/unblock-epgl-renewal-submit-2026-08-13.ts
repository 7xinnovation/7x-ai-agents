/**
 * Unblocks renewal submission.
 *
 * Two instructions in the renewal apiFlow were written when we had no way to read
 * anything out of Salesforce, and both are now wrong:
 *
 *   "LICENSE NO ON EVERY FINANCE ROW … send EPG_License_No__c: '<the customer's
 *    postal license number>'"
 *      EPG_License_No__c is an ID-TYPE LOOKUP. Sending the printed number is
 *      rejected — verified against the sandbox:
 *        "License No: id value of incorrect type: 284"
 *      It wants the licence RECORD id, which the company lookup now returns as
 *      licenseRecordId (Account.EPG_License__c).
 *
 *   "MATCHING AN EXISTING COMPANY — NEVER HUNT FOR AN ACCOUNT ID … Send the
 *    Account item WITHOUT an Id field"
 *      Without the Id the handler tries to insert and trips the Account's unique
 *      field. The vendor's own renewal example includes the Id; we simply had no
 *      way to obtain one. The lookup now returns accountId.
 *
 * Verified end to end against the sandbox: with both values the composite
 * succeeded (licence request a11FW000RJCymWGYYZ, finance row a0wFW000LIKmFzsYYF);
 * the same payload with the licence NUMBER failed with the error above.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/unblock-epgl-renewal-submit-2026-08-13.ts
 *   prod: DATABASE_URL=<...> npx tsx scripts/unblock-epgl-renewal-submit-2026-08-13.ts
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";

const SLUG = "epgl-dialog";

/** Replaces the old "send the postal licence number" instruction. */
const LICENCE_ID_NOTE =
  "LICENCE ID ON EVERY FINANCE ROW (2026-08-13): EPG_License_No__c on EPG_Finance_Summary__c is an ID-TYPE LOOKUP. " +
  "It takes the licence RECORD id, never the printed licence number — sending the number fails the whole composite " +
  "with \"License No: id value of incorrect type\". Get the id from epgl_company_lookup: its licenseRecordId field " +
  "(the Account's EPG_License__c). Put that value in EPG_License_No__c on EVERY finance row. If the lookup returned no " +
  "licenseRecordId the company has no licence record to renew — say so plainly and offer to start a new licence " +
  "application instead of submitting. ";

/** Replaces the old "never send an Account Id" instruction. */
const ACCOUNT_ID_NOTE =
  "ACCOUNT ID ON A RENEWAL (2026-08-13): send the Account item WITH its Id — the accountId from epgl_company_lookup — " +
  "alongside EPG_Trade_license_no__c. Without the Id the handler attempts an insert and fails on the Account's unique " +
  "field (\"A record already exists with the same unique value\"). Look the company up FIRST and submit with the id it " +
  "returned; only fall back to sending no Id if no lookup match exists. ";

interface Journey { key: string; submission?: { apiFlow?: { notes?: string } }; [k: string]: unknown }
interface Definition { journeys: Journey[]; [k: string]: unknown }

/** Cut an instruction that runs from `from` up to (not including) `until`. */
function cut(notes: string, from: string, until: string): string {
  const a = notes.indexOf(from);
  if (a === -1) return notes;
  const b = notes.indexOf(until, a + from.length);
  return notes.slice(0, a) + (b === -1 ? "" : notes.slice(b));
}

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`${SLUG} not found`);
  const def = row.definition as unknown as Definition;
  const renewal = def.journeys.find((j) => j.key === "renewal");
  const flow = renewal?.submission?.apiFlow;
  if (!flow) throw new Error("renewal apiFlow missing");

  let notes = flow.notes ?? "";
  const before = notes;

  // Drop the two superseded instructions, plus the hand-off note that told the
  // agent this was unfixable — it no longer is.
  notes = cut(notes, "LICENSE NO ON EVERY FINANCE ROW:", "QUARTER DERIVATION");
  notes = cut(notes, "MATCHING AN EXISTING COMPANY — NEVER HUNT FOR AN ACCOUNT ID.", "DECLARATION MAPPING:");
  notes = cut(notes, "LICENSE LOOKUP LIMITATION:", "QUARTER DERIVATION");

  if (!notes.includes("LICENCE ID ON EVERY FINANCE ROW (2026-08-13)")) notes += ` ${LICENCE_ID_NOTE}`;
  if (!notes.includes("ACCOUNT ID ON A RENEWAL (2026-08-13)")) notes += ` ${ACCOUNT_ID_NOTE}`;
  notes = notes.replace(/\s{2,}/g, " ").trim();

  if (notes === before) {
    console.log("No changes — already applied.");
    return;
  }
  flow.notes = notes;
  await db.update(agents).set({ definition: def as never, updatedAt: new Date() }).where(eq(agents.id, row.id));
  console.log("renewal apiFlow updated:");
  console.log("  - removed: send the postal licence NUMBER on finance rows");
  console.log("  - removed: never send an Account Id");
  console.log("  - removed: the hand-off note saying this could not be resolved");
  console.log("  - added:   use licenseRecordId and accountId from epgl_company_lookup");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

export {};
