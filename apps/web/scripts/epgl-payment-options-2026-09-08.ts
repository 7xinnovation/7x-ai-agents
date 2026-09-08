/**
 * The two ways EPGL's process map lets an applicant pay.
 *
 * "Payment Process with Agentic — Process Map" gives the customer a choice at
 * submission, and we only ever built one side of it:
 *
 *   Online Payment (Payment Gateway) — our checkout. Built.
 *   Current System (VIBAN)           — Finance raise a Virtual IBAN with the
 *                                      bank, paste it onto the Salesforce
 *                                      application, and the applicant transfers
 *                                      the fee. Finance confirm receipt and
 *                                      issue the receipt themselves.
 *
 * This adds the choice, and clears a contradiction that has been sitting in the
 * same guidance since 3 September: "PAYMENT — AFTER SUBMISSION, NEVER BEFORE"
 * at the top and "PAYMENT IS NOT TAKEN IN THIS CHAT" eighteen thousand
 * characters below it. The map settles which is right — payment is taken at
 * submission — so the second one goes.
 *
 * The VIBAN branch is enforced in code as well as here: request_payment refuses
 * outright when payment_method is viban, and the Finance email is sent from the
 * submission handler. Neither depends on the model having read this.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/epgl-payment-options-2026-09-08.ts --env <file> [--fee <aed>] [--apply]
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

/**
 * The annual licensing fee. AED 150,000, confirmed 2026-09-08.
 *
 * STAGING CANNOT CHARGE IT. The sandbox gateway carries a risk rule on order
 * amount, and a 150,000 order comes back 422 amountLimitExceeded -- which
 * surfaces in the chat as "Something went wrong on our side" at the exact
 * moment the customer presses submit. So staging is run with --fee at a figure
 * the sandbox will accept; the number under test there is the plumbing, not the
 * price.
 */
const FEE = Number(arg("--fee") ?? 150000);
if (!Number.isFinite(FEE) || FEE <= 0) throw new Error("--fee must be a positive number");

/** The stale rule the process map contradicts. Removed verbatim. */
const STALE_RULE =
  "\n- PAYMENT IS NOT TAKEN IN THIS CHAT: EPGL issues the payment request after the documents are reviewed, and it is paid through EPGL's own channel. Explain it that way. Do NOT offer to take payment here, do not produce a payment link, and do not quote a fee you were not given by a tool or the knowledge base.";

const FIELD = {
  key: "payment_method",
  label: { en: "Preferred payment method", ar: "طريقة الدفع المفضلة" },
  type: "enum",
  options: [
    { value: "gateway", label: { en: "Card payment (online)", ar: "الدفع بالبطاقة (عبر الإنترنت)" } },
    { value: "viban", label: { en: "Bank transfer (Virtual IBAN)", ar: "تحويل بنكي (آيبان افتراضي)" } },
  ],
  // Deliberately NOT required. recomputeReadiness counts an unfilled required
  // field as missing and an incomplete case cannot be submitted -- and in this
  // process the application is submitted BEFORE the money moves. Making the
  // choice mandatory would block the very submission it is supposed to follow.
  // Unanswered falls through to the card, which is the built and safe path.
  validation: { required: false },
};

const MARKER = "PAYMENT OPTIONS (2026-09-08)";
const RULE =
  ` ${MARKER}: the applicant CHOOSES how to pay, and you must ask before taking any payment. Present it once, after they have confirmed the application and BEFORE you submit it -- Finance are notified the moment the application is submitted, so a choice made after that point is too late for the Virtual IBAN branch. Ask it as a \`\`\`buttons block with exactly two choices: "Card payment (online)" and "Bank transfer (Virtual IBAN)". Record the answer with collect_field(payment_method, gateway) or collect_field(payment_method, viban).` +
  ` CARD: call request_payment as usual — a secure payment card appears in the chat by itself. Never paste a link.` +
  ` VIRTUAL IBAN: do NOT call request_payment; it will refuse. Submit the application as usual, then tell them EPGL Finance will email them a Virtual IBAN to transfer the fee to, and that the licence is issued once Finance confirm the transfer has arrived. Do not invent an IBAN, do not quote one, and never say the payment has failed — nothing has been charged and nothing has gone wrong. Finance are notified automatically the moment the application is submitted; you do not have to tell the applicant to contact anyone.` +
  ` If they later change their mind, record the new choice with collect_field(payment_method, ...) and follow that branch instead.`;

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
      const sub = j.submission;
      if (!sub) continue;

      // The journey is chargeable whichever method they pick: the VIBAN branch
      // is a different way to pay the same fee, not a way to skip it.
      if (sub.requiresPayment !== true) {
        sub.requiresPayment = true;
        changes.push(`${j.key}.submission.requiresPayment -> true`);
      }
      if (sub.amount !== FEE) {
        changes.push(`${j.key}.submission.amount ${sub.amount} -> ${FEE}`);
        sub.amount = FEE;
      }

      // The licence request must exist before the money moves: the payment
      // notification keys on its Salesforce id. Carried in prose since
      // 3 September and drifted twice, so request_payment enforces it now.
      if (sub.apiFlow && sub.apiFlow.submitBeforePayment !== true) {
        sub.apiFlow.submitBeforePayment = true;
        changes.push(`${j.key}.apiFlow.submitBeforePayment -> true`);
      }

      const g = String(j.guidance ?? "");
      if (g.includes(STALE_RULE)) {
        j.guidance = g.replace(STALE_RULE, "");
        changes.push(`${j.key}.guidance -= "payment is not taken in this chat"`);
      }
      if (!String(j.guidance ?? "").includes(MARKER)) {
        j.guidance = String(j.guidance ?? "") + RULE;
        changes.push(`${j.key}.guidance += payment options`);
      }

      // On the last step, so it is asked at the end rather than up front.
      const step = (j.steps ?? [])[(j.steps ?? []).length - 1];
      if (!step) continue;
      step.fields = step.fields ?? [];
      const at = step.fields.findIndex((f: any) => f.key === "payment_method");
      if (at === -1) {
        step.fields.push(JSON.parse(JSON.stringify(FIELD)));
        changes.push(`${j.key}/${step.key} += payment_method`);
      } else if (!same(step.fields[at], FIELD)) {
        step.fields[at] = JSON.parse(JSON.stringify(FIELD));
        changes.push(`${j.key}/${step.key}.payment_method updated`);
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
