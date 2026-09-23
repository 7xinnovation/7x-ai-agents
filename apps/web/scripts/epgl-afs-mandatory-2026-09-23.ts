/**
 * One of the two AFS documents, not a way past the step (2026-09-23).
 *
 * EPGL's licensing team told us on 16 September that the Audited Financial
 * Statement is not a condition of renewing: a courier renews without it, the
 * application is tagged PARTIALLY COMPLETED, and they have six months to send it
 * or an audit acknowledgement letter. The guidance was written to match, and it
 * offers three ways forward — upload the AFS, upload the letter, or continue
 * without either.
 *
 * Day 2 of the 22 September round reverses the third: "there should only be 2
 * options... The current 3rd option should not let the user skip past this step;
 * it is mandatory to upload one of the two documents, and the 6-month allowance
 * should instead be shown as an informational note on the next message, not as a
 * bypass option."
 *
 * So the six months stay TRUE and stop being a CHOICE. They are still said out
 * loud — a customer who uploads an acknowledgement letter needs to know what
 * happens next — but they are no longer one of the buttons, because a button
 * that skips a mandatory step is how a renewal reaches EPGL without the evidence
 * it is meant to carry.
 *
 * The second paragraph above it, which says the documents are "REQUESTED BUT NOT
 * REQUIRED", is updated in the same run: leaving it would have the model reading
 * two rules that contradict each other and picking one.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/epgl-afs-mandatory-2026-09-23.ts --target staging|production [--dry-run]
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

const SLUG = "epgl-dialog";
const JOURNEY = "renewal";

const target = process.argv[process.argv.indexOf("--target") + 1] ?? "";
if (target !== "staging" && target !== "production") {
  console.error(`Pass --target staging|production (got ${JSON.stringify(target)}).`);
  process.exit(1);
}
const dryRun = process.argv.includes("--dry-run");

/** Exactly as it stands today. Matched in full, so a changed block is noticed. */
const OLD_GRACE =
  "THE AFS AND ITS GRACE PERIOD (2026-09-16): the Audited Financial Statement is NOT a condition of renewing. " +
  "EPGL's licensing team: a courier can renew without it, the application is then tagged PARTIALLY COMPLETED, and they have SIX MONTHS to submit it; " +
  "if they do not submit the AFS they may submit an audit acknowledgement letter instead. So ask for it once, plainly, and offer the three ways forward in the same message: " +
  "upload the AFS now, upload the acknowledgement letter instead, or continue without either and send it within six months. " +
  "NEVER block the renewal on it, never re-ask after they have chosen, and never describe the renewal as incomplete because of it. " +
  "When they continue without it, say once — before payment, not after — that the application will be recorded as partially completed until the AFS or the acknowledgement letter reaches EPGL, and that the six months run from now. " +
  "Do not invent a date for the deadline unless you are told one.";

const NEW_GRACE =
  "THE AFS IS MANDATORY, AND IT IS ONE OF TWO DOCUMENTS (2026-09-23): a renewal needs EITHER the Audited Financial Statements OR an audit acknowledgement letter. " +
  "Ask for it once, plainly, and offer exactly TWO ways forward — \"Upload the AFS now\" and \"Upload the acknowledgement letter instead\". " +
  "There is no third option. Do NOT offer to continue without either, do NOT offer to send it later, and do NOT proceed to the summary or to payment until one of the two has been uploaded: " +
  "this is the evidence the renewal is assessed on, and a renewal that reaches EPGL without it cannot be completed. " +
  "If the customer says they have neither to hand, say plainly that one of the two is needed to submit, and that you will hold the application here until they have it — do not submit it anyway and do not present that as a failure on their part. " +
  "THE SIX MONTHS ARE A FACT, NOT A CHOICE. Once they have uploaded the acknowledgement letter, tell them ONCE, in the next message, that the application is recorded as partially completed until the audited statements themselves reach EPGL, and that they have six months to send them. " +
  "That is an informational note about what happens next; it is never an option, never a button, and never a reason to skip the upload. Do not invent a date for the deadline unless you are told one.";

/** The other half of the same rule, two paragraphs above it. */
const OLD_REQUESTED =
  "- REVENUE DOCUMENTS ARE PART OF THE RENEWAL: the Audited Financial Statements are REQUESTED BUT NOT REQUIRED — a courier may renew without them, the application is then recorded as partially completed, and they have six months to send them or an audit acknowledgement letter instead, and the audit acknowledgement letter is accepted when the customer has one — these are what let EPGL confirm the audit is complete rather than leaving the request partially closed.";

const NEW_REQUESTED =
  "- REVENUE DOCUMENTS ARE PART OF THE RENEWAL: the renewal needs the Audited Financial Statements OR an audit acknowledgement letter — one of the two, and it is REQUIRED. They are what let EPGL confirm the audit is complete. Where the acknowledgement letter is given, the audited statements themselves follow within six months and the request is recorded as partially completed until they arrive.";

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`No agent ${SLUG} in this database`);
  const def = row.definition as typeof row.definition & { journeys?: { key: string; guidance?: string }[] };

  const j = (def.journeys ?? []).find((x) => x.key === JOURNEY);
  if (!j) throw new Error(`${SLUG} has no journey "${JOURNEY}" here`);
  const before = String(j.guidance ?? "");
  let next = before;
  let changes = 0;

  for (const [old, replacement, label] of [
    [OLD_GRACE, NEW_GRACE, "the grace-period block"],
    [OLD_REQUESTED, NEW_REQUESTED, "the revenue-documents line"],
  ] as const) {
    if (next.includes(replacement)) { console.log(`  (already) ${label}`); continue; }
    if (!next.includes(old)) {
      // Loud rather than silent: matched in full, so a miss means the text has
      // been edited elsewhere and a person should look before this overwrites.
      console.log(`  !! ${label}: not found as expected — check it by hand, nothing written for it`);
      continue;
    }
    next = next.replace(old, replacement);
    console.log(`  ~ ${label} replaced`);
    changes++;
  }

  if (!changes) { console.log("\nNothing to change."); return; }
  if (dryRun) { console.log(`\n--dry-run: ${changes} change(s) NOT written.`); return; }
  j.guidance = next.replace(/\n{3,}/g, "\n\n").trim();
  await db.update(agents).set({ definition: def }).where(eq(agents.id, row.id));
  console.log(`\n${changes} change(s) written.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
