/**
 * 2026-08-04 renewal retest finding (the "retest a renewal for a company
 * already recorded in Salesforce" action from the 2026-08-03 status report):
 *
 * Submitting a renewal for an existing Account (matched by trade license
 * number) fails inside Salesforce because EPG_Finance_Summary__c rows require
 * EPG_License_No__c — a LOOKUP to the Salesforce record id of the customer's
 * ACTIVE postal license. That record id is not exposed by any operation in the
 * current API contract (duplicate-check and status return the account and
 * request, not the license record), so the assistant cannot populate it, and
 * the backend does not derive it from the account.
 *
 * Until EPGL either relaxes the field or exposes the license record id, the
 * correct behaviour is: try once, recognise THIS error immediately, explain
 * plainly, and hand off — no retry loops. This appends that rule to the
 * renewal apiFlow notes (idempotent, marker-guarded).
 *
 * Run from apps/web: npx tsx scripts/fix-epgl-renewal-license-lookup-note.ts
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";

const MARKER = "LICENSE LOOKUP LIMITATION";
const NOTE =
  ` ${MARKER}: if the renewal submit fails with an error about EPG_License_No__c / License No on the finance-summary rows (an id-type lookup rejecting the text license number), STOP after at most ONE corrected attempt — this is a known backend contract gap: the field requires the Salesforce record id of the customer's active postal license, which no available operation returns, and the backend does not derive it from the account. Do NOT keep retrying variants. Tell the customer plainly that their details are all captured but the submission needs an EPGL agent to complete on the backend, and offer the callback. Never present this as the customer's mistake.`;

async function main() {
  const db = getDb();
  const [agent] = await db.select().from(agents).where(eq(agents.slug, "epgl-dialog")).limit(1);
  if (!agent) throw new Error("epgl-dialog not found");
  const def = agent.definition as Record<string, any>;
  const renewal = def.journeys.find((j: any) => j.key === "renewal");
  if (!renewal?.submission?.apiFlow) throw new Error("renewal apiFlow not found");
  if (renewal.submission.apiFlow.notes?.includes(MARKER)) {
    console.log("already applied — no change");
    return;
  }
  renewal.submission.apiFlow.notes = (renewal.submission.apiFlow.notes ?? "") + NOTE;
  await db.update(agents).set({ definition: def as typeof agent.definition }).where(eq(agents.id, agent.id));
  console.log(`applied — renewal notes now ${renewal.submission.apiFlow.notes.length} chars`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
