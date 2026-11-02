/**
 * Four things from the 2 November test round (EPGL 2.0, staging).
 *
 * Reported with screenshots, and all four are the assistant's, not the
 * service's:
 *
 *  1. "just says 'no problem'" — the customer tapped "Different company" and
 *     got a two-word reply with the OLD company's trade licence sitting under
 *     it, marked Uploaded. Nothing said what had changed or what was now
 *     needed.
 *  2. "still asks for two different things here" — the Postal Activity Licence
 *     picker and the Beneficial Ownership Declaration upload, in one message.
 *     There is already a ONE ASK PER MESSAGE rule; it is being read as being
 *     about two UPLOADS. It is not.
 *  3. "Shouldn't ask the user to enter KG, should just by default put in the
 *     30kg" — every CEP30 product says the ceiling in its own name.
 *  4. A second tester, same documents: "there's already a submitted application
 *     on file for this trade licence, and the system has locked it".
 *
 * ON (4), WHAT THE CALL LOG ACTUALLY SHOWS (conversation ae2c8a04, 1 November).
 * The locked message is REAL — Salesforce returned it verbatim: "This
 * application is locked. Applicant-supplied details cannot be changed after
 * submission - raise an information request if the applicant needs to amend
 * them." The duplicate check, run six minutes later, names the application:
 * LR-37795, Under document review, recommendedAction "Update existing
 * application". So the service behaved correctly and said so clearly.
 *
 * What we did with that is the bug, and it is three bugs:
 *   - the same create was sent SIX times against a lock that was never going to
 *     lift, at 15:55, 15:59, 16:00, 16:02, 16:03 and 16:05;
 *   - the duplicate check ran at 16:01, AFTER five of them, when running it
 *     first would have answered the whole thing;
 *   - and the customer was told "it looks like the earlier submission didn't
 *     complete successfully", which nothing in the log says. getApplicationStatus
 *     had returned 404 "No License Request found" for a reference we asked it
 *     about; that is not a report on their submission.
 *   - one attempt also carried applicationId__c "LR-37795" on a create, which
 *     Salesforce rejected: the id is theirs to assign.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/epgl-20-test-round-2026-11-02.ts --env <file> [--apply]
 */
import { databaseUrlFrom } from "./lib/envFile";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const SLUG = arg("--slug") ?? "epgl-dialog";
const APPLY = process.argv.includes("--apply");

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { agents } from "@dialog/db";
import { eq } from "drizzle-orm";

export const MARKER = "THE 2 NOVEMBER TEST ROUND (2026-11-02";

/** The field that was being asked for and should not be. */
export const WEIGHT_FIELD = "declared_max_shipment_weight_kg";
export const WEIGHT_HELP =
  "Declared_Max_Shipment_Weight_Kg__c. NOT A QUESTION FOR THE CUSTOMER: every CEP30 product is a ≤30 kg licence, so set it to 30 as soon as the product is chosen. Only revisit it if the customer says they carry heavier — then it is the wrong product, not a different number.";

export const RULE = `
${MARKER} — all four from EPGL's own screenshots).

AN ACKNOWLEDGEMENT IS NOT A REPLY. "No problem." was the entire message, and under it sat the previous company's trade licence marked Uploaded. The customer had just said they were applying for a DIFFERENT COMPANY. Three things were true at that moment and none of them was said: the company on the application is no longer the one they want, everything read off that licence belongs to the wrong company, and what is needed next is the new company's trade licence. Never send a message whose prose is only "No problem", "Of course", "Got it" or "Sure" — those are the first two words of a sentence, not the sentence. Say what you changed, what it invalidated, and what you need now, and only then emit the control.

AND WHEN THE COMPANY CHANGES, THE EVIDENCE CHANGES WITH IT. A different company means a different trade licence, a different licence number, different owners, different everything that was read off the old file. Do not carry a single captured value across. Say plainly that the documents already uploaded belong to the other company and have to be replaced, ask for the new trade licence first, and let everything else follow from it. Showing the old file as "Uploaded" after they have told you it is the wrong company is telling them you did not hear it.

ONE ASK PER MESSAGE MEANS ONE ASK, NOT ONE UPLOAD. The picker for the Postal Activity Licence went out in the same message as the Beneficial Ownership Declaration upload block. Two things to do, one message, and the customer answered neither cleanly. The rule is not "never two uploads" — it is never TWO ASKS. A question and an upload block is two. A \`\`\`cards or \`\`\`buttons choice and an upload block is two. A summary to confirm and an upload block is two. The preparation list is text and carries no control at all. Ask the question, stop, wait for the answer, and let the upload be its own message.

NEVER ASK FOR THE MAXIMUM SHIPMENT WEIGHT. Every CEP30 product carries its ceiling in its own name — CEP Licence (≤30 kg). Asking the applicant to type 30 into a chat is asking them to read the title back to you. The moment the product is chosen, record it yourself: collect_field(${WEIGHT_FIELD}, 30) for any CEP30 product, and say nothing about it. The weight only becomes a conversation if the CUSTOMER raises it — if they say they carry heavier than the ceiling, that is a product question, not a number to write down: tell them that licence covers up to 30 kg and offer the one that covers what they carry.

A LOCKED APPLICATION IS AN ANSWER, NOT A HICCUP. On 1 November the same create was sent six times against "This application is locked. Applicant-supplied details cannot be changed after submission", and the customer watched it fail six times. That error is final. It will not come good on a retry, a reorder or a second wording. Send a create ONCE. If it is refused for a reason that is about the application rather than the connection — locked, already submitted, a duplicate — do not send it again at all, and never send it again unchanged.

RUN THE DUPLICATE CHECK BEFORE THE FIRST SUBMIT, NOT AFTER THE FIFTH. It was run six minutes and five failures late, and it had the whole answer: an application already filed for that trade licence, its reference, its status — Under document review — and what EPGL recommend doing about it. That is the message the customer should have had first: there is already an application for this licence, it is <reference>, it is <status>, and here is what you can do. Their own instruction is to raise an information request to change anything on it, so offer that and the status check, and do not offer a resubmission that cannot work.

THE ID ON AN APPLICATION IS SALESFORCE'S TO GIVE. One attempt put applicationId__c "LR-37795" into a create, and it was refused — the id is assigned on creation and read back from the response. Never send an application id on a create, and never reuse a reference you were shown elsewhere as one.

AND A 404 FROM A STATUS LOOKUP IS NOT A REPORT ON THEIR SUBMISSION. "No License Request found" means the reference you asked about is not one it knows — most often because you asked about the wrong thing. The customer was told "it looks like the earlier submission didn't complete successfully", which no call said and which was not true: their earlier submission completed, which is exactly why the licence was locked. Tell them what a call said. Where it said nothing, say nothing.
`.trim();

async function main() {
  const env = arg("--env");
  if (!env) throw new Error("--env <envfile> is required");
  const pool = new pg.Pool({ connectionString: databaseUrlFrom(env) });
  const db = drizzle(pool, { schema: { agents } });
  try {
    const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG));
    if (!row) throw new Error(`${SLUG} not found in this database`);
    const def = JSON.parse(JSON.stringify(row.definition)) as Record<string, any>;
    const changes: string[] = [];

    for (const j of def.journeys ?? []) {
      const g = String(j.guidance ?? "");
      if (!g.includes(MARKER)) {
        j.guidance = `${g.trimEnd()}\n\n${RULE}`;
        changes.push(`${j.key}: +${RULE.length} chars of guidance`);
      }
      // The weight field's own help text, so the instruction sits beside the
      // field wherever the field is read, not only in the journey prose.
      for (const step of j.steps ?? []) {
        for (const f of step.fields ?? []) {
          if (f.key !== WEIGHT_FIELD) continue;
          if (String(f.help?.en ?? "") === WEIGHT_HELP) continue;
          f.help = { ...(f.help ?? {}), en: WEIGHT_HELP };
          changes.push(`${j.key}/${step.key}: ${WEIGHT_FIELD} help rewritten — not a question`);
        }
      }
    }

    if (!changes.length) { console.log(`${SLUG}: nothing to do — already applied.`); return; }
    console.log(`${SLUG} — ${changes.length} change(s):`);
    for (const c of changes) console.log(`   ~ ${c}`);
    if (APPLY) {
      await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
      console.log("\nwritten.");
    } else {
      console.log("\ndry run — pass --apply to write.");
    }
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.includes("epgl-20-test-round-2026-11-02")) void main();
