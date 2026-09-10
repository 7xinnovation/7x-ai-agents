/**
 * Tell EPGL about a licence fee that settled while nothing was listening.
 *
 * Until 10 September the payment notification hung off the gateway WEBHOOK
 * alone -- and N-Genius does not call that webhook, as the status route's own
 * comment has said all along. Every card payment was therefore confirmed by the
 * browser's status poll, marked paid on our side, and never mentioned to
 * Salesforce. LR-37324 is the one that showed it: submitted 07:39:46, paid
 * 07:40:29, and still reading "Under document review" with a lastUpdated of the
 * submission.
 *
 * The three live paths now all notify. This is for the ones that already
 * happened. It is safe to re-run: the notifier refuses to send twice for the
 * same payment reference.
 *
 * Run from apps/web:
 *   npx tsx scripts/epgl-notify-missed-payment-2026-09-10.ts --env <file> [--apply]
 */
import { databaseUrlFrom } from "./lib/envFile";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const ENV = arg("--env");
const APPLY = process.argv.includes("--apply");
if (!ENV) throw new Error("--env <envfile> is required");
process.env.DATABASE_URL = databaseUrlFrom(ENV);

import { getDb, payments, agents, cases } from "@dialog/db";
import { and, eq, sql } from "drizzle-orm";
import { notifyEpglIfLicenceFee } from "../lib/epglPayment";

async function main() {
  const db = getDb();
  const rows = await db
    .select({
      reference: payments.reference,
      amount: payments.amount,
      agentId: payments.agentId,
      conversationId: payments.conversationId,
      state: cases.state,
    })
    .from(payments)
    .innerJoin(agents, eq(agents.id, payments.agentId))
    .innerJoin(cases, eq(cases.conversationId, payments.conversationId))
    .where(and(eq(payments.status, "paid"), eq(agents.slug, "epgl-dialog")));

  const missed = [];
  for (const r of rows) {
    const ref = String((r.state as { reference?: string })?.reference ?? "").trim();
    if (!ref) continue;
    const seen = await db.execute(sql`
      select 1 from audit_log
       where conversation_id = ${r.conversationId}
         and action = 'epgl_payment_notified'
         and payload ->> 'reference' = ${r.reference}
       limit 1`);
    if ((seen.rows ?? seen).length) continue;
    missed.push({ ...r, licenceRequest: ref });
  }

  if (!missed.length) { console.log("nothing missed — every settled licence fee has been notified."); return; }
  console.log(`${missed.length} settled payment(s) Salesforce was never told about:\n`);
  for (const m of missed) {
    console.log(`  ${m.licenceRequest}  AED ${m.amount}  payment ${m.reference}`);
  }
  if (!APPLY) { console.log("\nDry run — nothing sent. Add --apply to notify."); return; }

  console.log("");
  for (const m of missed) {
    await notifyEpglIfLicenceFee(m.agentId!, m.conversationId!, m.reference, Number(m.amount ?? 0));
    console.log(`  sent for ${m.licenceRequest}`);
  }
  console.log("\ndone — check the audit log for epgl_payment_notified / _failed.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
