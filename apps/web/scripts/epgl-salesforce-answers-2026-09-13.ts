/**
 * Salesforce answered the payload review. This is what their answers change.
 *
 * WHAT IS DELIBERATELY NOT HERE: the payment ORDER. They answered (a) — submit,
 * review, "Documents approved", then pay — and told us to poll
 * EPGL/LicenseRequest/status for that value before sending the payment
 * notification. But EPGL's own side has an open question about it: the licence
 * fee is currently offered WITH the submission, and whether that changes is
 * being settled between them. Reversing the order of a submission and a payment
 * on one side of that conversation is how you end up with money taken against a
 * request that cannot receive it, which is the bug we already have. So the
 * READING half is built — the agent now knows what every status on their path
 * means, including that "Documents approved" is the moment the fee falls due —
 * and the order stays as it is until they agree with each other.
 *
 * What IS settled and applied here:
 *   - the status progression, in the applicant's words rather than the
 *     picklist's, so "Documents approved" is not reported as the end of it;
 *   - the request number: requestIdentifier now carries LR-xxxxx (measured on
 *     four consecutive records), so the agent stops being told it is unavailable;
 *   - the Virtual IBAN branch: their progression puts "Virtual Iban Approved"
 *     AFTER "Documents approved", so we no longer stamp a status ourselves;
 *   - EPG_License_Request__c is matched on Name for an update — confirmed.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/epgl-salesforce-answers-2026-09-13.ts --env <file> [--apply]
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

const STATUS_RULE =
  "WHERE AN APPLICATION HAS GOT TO (2026-09-13, from EPGL): a submitted request moves through their own statuses, and epglsalesforce__getRequestStatus reports the one it is on. Their path is: Under document review → Documents approved → (Virtual Iban Approved, for a bank transfer) → Payment Verified → Closed. " +
  "READ THE STATUS, DO NOT TRANSLATE IT YOURSELF. The tool result now carries the plain meaning of whichever status came back; use that wording. Two of them are easy to report wrongly and must not be: " +
  "\"Documents approved\" is NOT the licence being issued — it is EPGL accepting the documents, and it is the point the fee falls due. \"Payment Verified\" is NOT the licence being issued either — it is the money confirmed, with the licence still to come. Neither is the end. " +
  "A status whose meaning the tool does not give you is relayed exactly as EPGL wrote it, with no gloss: there are thirty-nine values on that picklist and inventing a reassuring reading of an unfamiliar one is how a customer is told an application is fine when it is not. " +
  "And the reference: the status response carries requestIdentifier, which is the customer's LR- number. EPGL fixed that on 11 September — it used to come back null. Give them that, never the Salesforce record id beside it, and never say the reference is pending or awaiting assignment. ";

const VIBAN_RULE =
  "THE VIRTUAL IBAN, END TO END (2026-09-13, from EPGL): an applicant who chooses the bank transfer has their request submitted for review like any other. EPGL review the documents; once the documents are approved, Finance issue the Virtual IBAN — EPGL's own figure is within one working day — and the request reads \"Virtual Iban Approved\". The applicant transfers the fee to it, and the licence follows once the transfer is confirmed. " +
  "WE DO NOT STATE THE STATUS OURSELVES any more. Every step of that progression is EPGL's to set, and a request stamped with a status their process never assigns is one their process cannot move. Do not claim a Virtual IBAN has been issued until the status says so, do not invent an IBAN, do not quote one, and never describe the wait as a failed payment — nothing has been charged and nothing has gone wrong. If the customer asks where it is before the documents are approved, say plainly that it comes after the document review and offer to check the status. ";

const NOTES_EXTRA =
  " CONFIRMED BY EPGL 2026-09-13: EPG_License_Request__c is matched on Name for an update (Account.Id + that Name) — this is now their confirmed answer, not our proposal. EPG_Payment_Reference__c is NOT sent: they store notifyPayment.payment.paymentId from the payment notification themselves, and a describe of their object reports no such field. The status endpoint's id parameter is required and their swagger now says so.";

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrlFrom(ENV!) });
  const db = drizzle(pool, { schema: { agents } });
  const changes: string[] = [];
  try {
    const [row] = await db.select().from(agents).where(eq(agents.slug, "epgl-dialog"));
    if (!row) throw new Error("epgl-dialog not found in this database");
    const def = JSON.parse(JSON.stringify(row.definition)) as Record<string, any>;

    for (const j of def.journeys ?? []) {
      let g = String(j.guidance ?? "");
      for (const [label, rule] of [
        ["the status progression, in the applicant's words", STATUS_RULE],
        ["the Virtual IBAN, end to end", VIBAN_RULE],
      ] as [string, string][]) {
        if (g.includes(rule.trim())) continue;
        g = `${g.trimEnd()}\n\n${rule.trim()}`;
        changes.push(`${j.key}: ${label}`);
      }
      j.guidance = g;

      const notes = String(j.submission?.apiFlow?.notes ?? "");
      if (notes && !notes.includes("CONFIRMED BY EPGL 2026-09-13")) {
        j.submission.apiFlow.notes = notes.trimEnd() + NOTES_EXTRA;
        changes.push(`${j.key}: apiFlow notes — their confirmations`);
      }
    }

    if (!changes.length) { console.log("nothing to do — already applied."); return; }
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
