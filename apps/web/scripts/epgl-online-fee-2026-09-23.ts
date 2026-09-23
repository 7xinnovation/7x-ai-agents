/**
 * AED 100,000, and 700 more only if you pay online (2026-09-23).
 *
 * The licence fee is AED 100,000 — that is the figure EPGL show, and the figure
 * on the payment advice their Salesforce raises. Paying through the gateway adds
 * AED 700; the Virtual IBAN route is at face value. We had been charging 100,700
 * to everyone, which is why the invoice never matched: the 700 was never part of
 * the licence fee, it is the price of paying online.
 *
 * So the base comes down and the 700 becomes what it always was: a conditional
 * surcharge, declared on the journey, gated on how the applicant chose to pay.
 * The plumbing for this already exists and is the whole reason it does —
 * `surcharges` are disclosed UP FRONT by the prompt ("Show the fee ON the option
 * itself when you present that choice — never reveal it only at payment") and
 * added to the total by request_payment, rather than depending on the model to
 * remember either.
 *
 *   VIBAN      100,000
 *   Gateway    100,000 + 700  =  100,700
 *
 * AND THE WORDING, which is the other half of the same report: "the phrase 'a
 * fee applies' is a bit misleading". It is, and on the Virtual IBAN branch it is
 * nearly all the customer gets — request_payment is never called there, so a
 * rule written as "say nothing until the tool returns a figure" means the fee is
 * never stated at all. They confirm a submission for an amount nobody has named.
 *
 * The rule it replaces was right about the danger (a model quoting a price from
 * memory and the gateway charging another) and wrong about the remedy. The
 * amount is already in front of the model — the prompt states the journey's
 * chargeable amount and lists every add-on fee with the choice that triggers it
 * — so the fix is to let it say what it has been given, and to keep forbidding
 * the part that actually goes wrong: inventing a figure, or doing arithmetic.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/epgl-online-fee-2026-09-23.ts --target staging|production [--dry-run]
 *
 * Staging's base is deliberately 1,000 and is left alone — the surcharge applies
 * there too, so the mechanism is testable without anyone being shown a live fee.
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
const JOURNEYS = ["new_license", "renewal"];

/** The licence fee itself. Null means "leave whatever is there" — see staging. */
const BASE_AMOUNT: Record<string, number | null> = { staging: null, production: 100000 };

/**
 * `payment_method` holds "gateway" for a card payment — it is the value the
 * journey's own guidance tells the model to record — and "viban" for the bank
 * transfer. The condition grammar is `key == 'value'`; see packages/config/src/condition.
 */
const SURCHARGE = {
  key: "online_payment_fee",
  label: { en: "Online payment fee", ar: "رسوم الدفع الإلكتروني" },
  amount: 700,
  when: "payment_method == 'gateway'",
};

const target = process.argv[process.argv.indexOf("--target") + 1] ?? "";
if (!(target in BASE_AMOUNT)) {
  console.error(`Pass --target staging|production (got ${JSON.stringify(target)}).`);
  process.exit(1);
}
const dryRun = process.argv.includes("--dry-run");

/** The sentences that state or withhold the fee, exactly as they stand today. */
const TEXT: { find: string; replace: string; where: RegExp }[] = [
  {
    where: /new_license|renewal/,
    find:
      "Until the tool has returned, say only that a fee applies and that you will bring up the exact amount.",
    replace:
      "You MAY state the licence fee before then, because it is given to you: the active journey's chargeable amount above is the configured figure, and every add-on fee is listed there with the choice that triggers it. Say it plainly — \"the licence fee is AED X\" — rather than \"a fee applies\", which tells the customer nothing and reads as though we do not know. " +
      "This matters most on the Virtual IBAN route, where request_payment is never called: a rule that waits for the tool means the fee is never named at all, and the applicant confirms a submission for an amount nobody has told them. " +
      "What stays forbidden is the part that actually goes wrong: never quote a figure you have not been given here, never add the fees up yourself, and never state a total that request_payment has not returned.",
  },
  {
    // Present in BOTH journeys on production and only in new_license on staging:
    // the two definitions have drifted, which is why each replacement is matched
    // in full and skipped where it does not appear rather than assumed.
    where: /new_license|renewal/,
    find: "(1) An annual licensing fee of AED 100,700, paid in advance when the licence is issued and at each renewal — the minimum fee for the licence period.",
    replace:
      "(1) An annual licensing fee of AED 100,000, paid in advance when the licence is issued and at each renewal — the minimum fee for the licence period. Paying through the online gateway adds an online payment fee of AED 700, so a card payment comes to AED 100,700; the Virtual IBAN route is the fee itself, AED 100,000. Say which of the two applies when you present the choice, not afterwards.",
  },
  {
    where: /renewal/,
    find: "The annual licence fee is a flat AED 100,700 and does not depend on any of it.",
    replace:
      "The annual licence fee is a flat AED 100,000 and does not depend on any of it. Paying online adds an online payment fee of AED 700 — AED 100,700 by card, AED 100,000 by Virtual IBAN — and that difference is the customer's to know BEFORE they choose, not after.",
  },
];

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`No agent ${SLUG} in this database`);
  const def = row.definition as unknown as {
    journeys?: { key: string; guidance?: string; submission?: Record<string, unknown> }[];
  };
  let changes = 0;

  for (const key of JOURNEYS) {
    const j = (def.journeys ?? []).find((x) => x.key === key);
    if (!j) throw new Error(`${SLUG} has no journey "${key}" here`);
    if (!j.submission) throw new Error(`${key}: no submission block — this journey does not charge, so there is nothing to price`);
    const sub = j.submission;

    /**
     * REFUSE TO LEAVE A PERCENTAGE ON. The 1% "Admin processing fees" EPGL
     * floated in September was withdrawn, and a percentage sitting beside this
     * fixed surcharge would charge both.
     */
    if (sub.processingFee) {
      throw new Error(`${key}: a processingFee is configured (${JSON.stringify(sub.processingFee)}) — resolve that before adding a fixed online fee, or the two stack`);
    }

    const want = BASE_AMOUNT[target];
    if (want !== null && sub.amount !== want) {
      console.log(`  ~ ${key}: amount ${String(sub.amount)} -> ${want}`);
      sub.amount = want;
      changes++;
    } else {
      console.log(`  (already) ${key}: amount ${String(sub.amount)}`);
    }

    const list = Array.isArray(sub.surcharges) ? (sub.surcharges as Record<string, unknown>[]) : [];
    const existing = list.find((s) => s.key === SURCHARGE.key);
    /**
     * FIELD BY FIELD, because jsonb does not keep your key order.
     *
     * Postgres stores jsonb with its own ordering, so the row comes back as
     * {key, when, label, amount} however it went in — and comparing the two as
     * strings reported a change on every run, for ever. The first version of
     * this script did exactly that and rewrote the same surcharge twice.
     */
    const label = (existing?.label ?? {}) as { en?: string; ar?: string };
    const same =
      existing !== undefined &&
      existing.amount === SURCHARGE.amount &&
      existing.when === SURCHARGE.when &&
      label.en === SURCHARGE.label.en &&
      label.ar === SURCHARGE.label.ar;
    if (same) {
      console.log(`  (already) ${key}: ${SURCHARGE.key}`);
    } else {
      console.log(`  ${existing ? "~" : "+"} ${key}: ${SURCHARGE.key} = ${SURCHARGE.amount} when ${SURCHARGE.when}`);
      sub.surcharges = [...list.filter((s) => s.key !== SURCHARGE.key), SURCHARGE];
      changes++;
    }

    const before = String(j.guidance ?? "");
    let next = before;
    for (const t of TEXT) {
      if (!t.where.test(key)) continue;
      if (next.includes(t.replace)) continue;
      if (!next.includes(t.find)) {
        // Matched in full, so this skips rather than writing over the top of
        // something it does not recognise. The two environments' guidance has
        // drifted, so a phrase missing from one journey is ordinary — what would
        // not be ordinary is this rewriting a sentence it had not read.
        console.log(`  · ${key}: no "${t.find.slice(0, 40)}…" here, nothing to change`);
        continue;
      }
      next = next.split(t.find).join(t.replace);
      console.log(`  ~ ${key}: fee wording updated`);
      changes++;
    }
    if (next !== before) j.guidance = next;
  }

  if (!changes) { console.log("\nAlready applied — nothing to change."); return; }
  if (dryRun) { console.log(`\n--dry-run: ${changes} change(s) NOT written.`); return; }
  await db.update(agents).set({ definition: def as unknown as typeof row.definition }).where(eq(agents.id, row.id));
  console.log(`\n${changes} change(s) written.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
