/**
 * What the six test packs found when they were actually filed (2026-11-02).
 *
 * Five packs driven end to end against the NewLaw sandbox, and the call log —
 * not the transcript — says what went wrong. Four of them are ours:
 *
 *  1. EVERY submission is refused once, for a spelling. We send Document_Type
 *     "Trade License"; their catalogue has "Trade Licence". Salesforce, on
 *     LR-54101's first attempt: `Document_Type "Trade License" is not required
 *     for this application. Expected one of: … | Trade Licence`. The cause is
 *     in this very journey: step 1 still says "first the TRADE LICENSE OR
 *     INITIAL APPROVAL (key: trade_license)", which is the 1.x slot and carries
 *     no catalogue document type at all.
 *  2. Documents go missing. LOCKERS was filed with no Memorandum of Association
 *     and no Locker/PUDO Site Locations and Contracts — both named in
 *     Salesforce's own "expected" list. FOODMED took 6 of its 11.
 *  3. An empty composite. After LR-54104 was created we sent
 *     `{"allOrNone":false,"compositeRequest":[]}`.
 *  4. LR-54104 opened a payment card for AED 5,000 and never told the customer
 *     the reference the money was for.
 *
 * The fifth is Salesforce's and is not fixable here: `System.LimitException:
 * Too many SOQL queries: 101` in NewRegulationApiAdapter.attachDocument.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/epgl-20-submission-defects-2026-11-02.ts --env <file> [--apply]
 */
import { databaseUrlFrom } from "./lib/envFile";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
// 2.0 moved to its own agent on 2 November; epgl-dialog is 1.0 again.
const SLUG = arg("--slug") ?? "epgl-dialog-2";
const APPLY = process.argv.includes("--apply");

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { agents } from "@dialog/db";
import { eq } from "drizzle-orm";

export const MARKER = "WHAT THE TEST PACKS FOUND WHEN THEY WERE FILED (2026-11-02";

/** The sentence that sends it to the 1.x slot, and the one that replaces it. */
export const OLD_SLOT = "first the TRADE LICENSE OR INITIAL APPROVAL (key: trade_license)";
export const NEW_SLOT =
  "first the TRADE LICENCE OR INITIAL APPROVAL, under THE KEY THE CATALOGUE GIVES FOR THIS PRODUCT (trade_licence, or trade_licence_initial_name_approval where that is what the catalogue lists) and NEVER the legacy trade_license slot, which carries no catalogue document type and whose submission is refused";

export const RULE = `
${MARKER} — five packs, five applications, and the call log rather than the transcript).

A DOCUMENT TYPE IS COPIED, NEVER WRITTEN. Every Document_Type you send must be one of the strings the catalogue lists for the chosen product, character for character, taken from the catalogue response in this conversation. Not the label on the upload control, not the name of the file the customer sent, not the words you would use for it. On 2 November every single submission was refused the first time because we sent "Trade License" where the catalogue says "Trade Licence" — one letter, a rejected application, and a retry the customer sat through. Their spelling is Licence. If what you are about to send is not in the catalogue's list, you have made it up: find the slot it belongs to and use that slot's type.

EVERY REQUIRED DOCUMENT, BEFORE THE CREATE — NOT AFTER IT. The catalogue says which documents the chosen product requires. Read that list back before you submit, compare it to what has actually landed, and ask for what is missing — one at a time, as always. On 2 November the lockers permit was filed with no Memorandum of Association and no Site Locations and Contracts, and the food and medicine permit with six of its eleven; both were named in Salesforce's own list of what it expected. An application filed short of its documents is not a filed application — it is a request EPGL has to come back to the customer about. If a required document cannot be obtained, say so and stop: do not submit around it.

NEVER SEND AN EMPTY SUBMISSION. A composite with nothing in it — \`compositeRequest: []\` — went to Salesforce on 2 November, straight after an application that had already been created. If you have nothing to send, send nothing: no items means no call. Before every save, check that the body you have built actually contains the items you mean to create, and that you are not sending a second one for work the first already did.

A REFUSAL YOU CAN FIX IS FIXED SILENTLY, AND ONLY ONCE. Where the service refuses a submission for something that is ours to correct — a document type, a missing field, a malformed value — correct it and send it again, once, and say nothing to the customer about what was wrong. "The document type for the trade licence needs correcting — EPGL expects it as Trade Licence (not Trade License)" is a sentence a customer should never read: it is our field, our spelling and our mistake. One short line that you are filing it, then the result. THIS IS NOT A LICENCE TO RETRY: a refusal about the APPLICATION — locked, already submitted, a duplicate — is final and is handled as the rule above says.

THE REFERENCE TRAVELS WITH THE CARD. When the payment card goes up, the licence request number goes up in the SAME message: "Your application is filed as <reference>. The fee is AED <amount> — the secure card is below." On 2 November a card for AED 5,000 was raised against LR-54104 and the customer was never told the reference at all, which leaves them paying for something they cannot name and cannot chase. Where there is no reference yet, there is nothing to pay for: do not open a card.
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
      let g = String(j.guidance ?? "");
      if (g.includes(OLD_SLOT)) {
        g = g.split(OLD_SLOT).join(NEW_SLOT);
        changes.push(`${j.key}: the trade licence slot now comes from the catalogue, not the 1.x key`);
      }
      if (!g.includes(MARKER)) {
        g = `${g.trimEnd()}\n\n${RULE}`;
        changes.push(`${j.key}: +${RULE.length} chars of guidance`);
      }
      j.guidance = g;
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

if (process.argv[1]?.includes("epgl-20-submission-defects-2026-11-02")) void main();
