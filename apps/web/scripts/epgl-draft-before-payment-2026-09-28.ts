/**
 * The application is FILED before the payment question (2026-09-28).
 *
 * Asked for on 28 September: "a draft should be created before they reach the
 * step where it asks them if they want to pay online or by VIBAN, so it creates
 * the draft on Salesforce, and when they pay or ask for a VIBAN it updates that
 * existing request accordingly."
 *
 * Half of it was already true. `submitBeforePayment` has been on since
 * 8 September and request_payment REFUSES until the licence request exists,
 * because the payment notification keys on its Salesforce id. What was not true
 * is the position of the payment QUESTION: the order was ask, submit, then pay,
 * so an applicant who stopped at the two buttons left nothing behind on EPGL's
 * side at all — every document read, every partner captured, and no record.
 *
 * WHY IT ASKED FIRST, AND WHY THAT REASON IS GONE. Three separate rules had
 * accreted in this guidance (2026-09-08, -08b and -09), each saying ask first.
 * Two of them gave the real reason: "Finance are notified the moment the
 * application is submitted, so a Virtual IBAN chosen after that point is too
 * late." That was true of the code and is no longer — the Finance notification
 * now fires on the CHOICE rather than on the submission (see opsNotify's
 * notifyVibanRequest), so it reaches them whichever order the two happen in,
 * and an applicant who changes their mind after submitting reaches them too,
 * which never used to happen.
 *
 * The third rule gave a different reason — "the choice changes what is
 * submitted" — and that has lapsed on its own. It was about
 * EPG_Request_Status__c, which we stopped setting on 11 September when EPGL
 * gave us the whole progression and told us it was theirs to drive. With
 * EPGL_VIBAN_STATUS unset, the payment method changes nothing in the payload.
 *
 * So all three go, and one rule replaces them: SUBMIT, ASK, THEN PAY.
 *
 * WHAT THIS COSTS. EPGL's queue will now contain applications nobody paid for —
 * people who filed and walked away at the payment question. That is the point of
 * the change rather than a side effect of it, but it is their queue, and they
 * should be told.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/epgl-draft-before-payment-2026-09-28.ts --env <file> [--dry-run]
 */
import { databaseUrlFrom } from "./lib/envFile";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { agents } from "@dialog/db";
import { eq } from "drizzle-orm";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const ENV = arg("--env");
if (!ENV) throw new Error("--env <envfile> is required");
const DRY = process.argv.includes("--dry-run");

const MARKER = "PAYMENT OPTIONS (2026-09-28)";

/**
 * Every dated rule in this guidance opens the same way — AN UPPERCASE HEADING
 * (date): — and runs to the next one. That is how three payment rules came to
 * sit on top of each other rather than replacing each other, and it is also how
 * they can be removed cleanly: cut from each PAYMENT OPTIONS heading to whatever
 * heading comes next, and leave every other rule untouched.
 */
const HEADING = /[A-Z][A-Z0-9'’ ,\-—&/]{3,70}\(\d{4}-\d{2}-\d{2}[a-z]?\):/g;

function stripPaymentRules(guidance: string): { text: string; removed: string[] } {
  const heads = [...guidance.matchAll(HEADING)].map((m) => ({ at: m.index!, text: m[0] }));
  const removed: string[] = [];
  let out = guidance;
  // Backwards, so an earlier cut does not move a later one's offsets.
  for (let i = heads.length - 1; i >= 0; i--) {
    const h = heads[i]!;
    if (!/^PAYMENT OPTIONS \(/.test(h.text)) continue;
    const end = i + 1 < heads.length ? heads[i + 1]!.at : guidance.length;
    removed.unshift(h.text.trim());
    out = out.slice(0, h.at) + out.slice(end);
  }
  return { text: out, removed };
}

const RULE =
  ` ${MARKER}: THE ORDER IS SUBMIT, ASK, THEN PAY — in that order, never any other.` +
  ` (1) SUBMIT the application as soon as the customer has confirmed it, with the submit tool, and keep the reference it returns. Do this BEFORE you ask how they want to pay.` +
  ` NOTHING is charged by it. It files the request with EPGL so that everything the customer has just done exists on their side even if the conversation stops here, and every later step UPDATES that same record rather than creating a second one.` +
  ` (2) ASK how they want to pay, once, in the reply that follows a successful submit. A \`\`\`buttons block with exactly two choices: "Card payment (online)" and "Bank transfer (Virtual IBAN)". Record the answer with collect_field(payment_method, gateway) or collect_field(payment_method, viban).` +
  ` Give them the licence request reference in that same reply, so they leave with it whichever they pick — and whether or not they pick at all.` +
  ` (3) THEN follow the branch they chose.` +
  ` CARD: call request_payment and a secure payment card appears in the chat by itself. Never paste a link. What settles is recorded against the licence request that already exists.` +
  ` VIRTUAL IBAN: do NOT call request_payment; it will refuse. Their application is already filed and locked, and EPGL Finance are notified automatically the moment the choice is recorded — by us, whether it was chosen before the submission or after it. Tell them plainly: the application is submitted, their Virtual IBAN will be ISSUED WITHIN ONE WORKING DAY, and once they transfer the fee to it the licence proceeds.` +
  ` Do not invent an IBAN, do not quote one, do not tell them to phone anyone, and never say a payment failed — nothing was attempted and nothing has gone wrong.` +
  ` request_payment REFUSES until the application has been submitted, because the payment is recorded against the licence request's id and that id does not exist before then. If it refuses, submit first and ask for payment again: it is not a system fault and not something to escalate or apologise for.` +
  ` NEVER submit twice for the same application. If they change their mind about how to pay, record the new choice with collect_field(payment_method, ...) and follow that branch — the record exists already and does not need making again.`;

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrlFrom(ENV!) });
  const db = drizzle(pool, { schema: { agents } });
  try {
    const [row] = await db.select().from(agents).where(eq(agents.slug, "epgl-dialog"));
    if (!row) throw new Error("epgl-dialog not found in this database");
    const def = JSON.parse(JSON.stringify(row.definition)) as Record<string, any>;
    let changes = 0;

    for (const j of def.journeys ?? []) {
      const before = String(j.guidance ?? "");
      if (!before) { console.log(`  · ${j.key}: no guidance`); continue; }

      /**
       * REFUSE TO REORDER A JOURNEY THAT DOES NOT FILE FIRST. The whole rule
       * below rests on the licence request existing before any payment — if
       * submitBeforePayment were off, request_payment would not refuse, and
       * "submit, then ask" would be prose against a system doing the opposite.
       */
      if (j.submission?.apiFlow?.submitBeforePayment !== true) {
        throw new Error(`${j.key}: submitBeforePayment is not true — fix that first, or this rule contradicts the tools`);
      }

      const { text, removed } = stripPaymentRules(before);
      for (const r of removed) console.log(`  - ${j.key}: removed ${r}`);
      const next = `${text.trimEnd()}${RULE}`;
      if (next === before) { console.log(`  (already) ${j.key}`); continue; }
      if (removed.length === 1 && removed[0] === `${MARKER}:`) {
        // Already applied: the only rule present was ours, and putting it back
        // verbatim is not a change worth writing.
        console.log(`  (already) ${j.key}`);
        continue;
      }
      console.log(`  + ${j.key}: ${MARKER} (guidance ${before.length} -> ${next.length} chars)`);
      j.guidance = next;
      changes++;
    }

    if (!changes) { console.log("\nAlready applied — nothing to change."); return; }
    if (DRY) { console.log(`\n--dry-run: ${changes} journey(ies) NOT written.`); return; }
    await db.update(agents).set({ definition: def as any }).where(eq(agents.id, row.id));
    console.log(`\n${changes} journey(ies) written.`);
  } finally {
    await pool.end();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
