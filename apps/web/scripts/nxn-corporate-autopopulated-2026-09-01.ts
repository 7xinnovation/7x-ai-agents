/**
 * Tell Emirates Post where the company details came from (2026-09-01).
 *
 * Rental/Save carries IsCorporateInfoAutoPopulated. True means the company was
 * taken from the GSB licence registry, which Emirates Post already holds — their
 * own portal then sends no trade licence scan at all. False means the customer
 * typed the licence number and uploaded the documents. We were sending neither,
 * so every corporate rental looked like the manual kind.
 *
 * The flag itself is set server-side from what the registry actually returned in
 * the conversation, not from anything the model asserts. This note is so the
 * model knows the registry lookup is the preferred path and stops re-asking for
 * details it has already been handed.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/nxn-corporate-autopopulated-2026-09-01.ts [--env <file>]
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

const SLUG = "nxn-dialog";
const JOURNEY = "corporate_po_box_rental";
const MARKER = "WHERE THE COMPANY DETAILS CAME FROM (2026-09-01)";

const NOTE = `

${MARKER}: Emirates Post distinguishes a corporate rental whose company it supplied from one the customer typed, and Rental/Save carries that as IsCorporateInfoAutoPopulated. You do NOT set it — it is filled in from the companies the licence registry actually returned in this conversation, so asserting it either way has no effect.
What matters is the path you take. START from the registry: for a signed-in customer call nxn_companies_for_customer with their verified Emirates ID and let them pick from what comes back, and otherwise use nxn_companies_by_authority or nxn_company_by_licence. A company identified that way is one Emirates Post already holds. Only when the registry cannot produce it should you fall back to asking for the licence number and the trade licence upload.
Send mainCorporateProfile with companyNameEn, companyNameAr, tradeLicenseNo, emirateCode, issuingEntity, issuingDate and tradeLicenseExpiryDate COPIED from what the lookup returned — do not retype or tidy them, because the same values are what identify the company as registry-sourced.`;

interface Journey { key: string; submission?: { apiFlow?: { notes?: string } }; [k: string]: unknown }

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`${SLUG} not found`);
  const def = row.definition as unknown as { journeys: Journey[] };
  const j = def.journeys.find((x) => x.key === JOURNEY);
  if (!j?.submission?.apiFlow) { console.log(`${JOURNEY} has no apiFlow`); return; }
  if (String(j.submission.apiFlow.notes ?? "").includes(MARKER)) { console.log("nothing to do"); return; }
  j.submission.apiFlow.notes = String(j.submission.apiFlow.notes ?? "") + NOTE;
  await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
  console.log(`  + ${JOURNEY} apiFlow notes\n\n1 journey updated.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
