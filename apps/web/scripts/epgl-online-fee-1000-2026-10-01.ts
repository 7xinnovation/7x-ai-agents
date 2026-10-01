/**
 * The online payment fee goes from AED 700 to AED 1,000 (2026-10-01).
 *
 * "I know we set the price to 100,700 for online card payments. Can we change
 * this to be 101,000."
 *
 * So the LICENCE FEE is untouched — it is AED 100,000, it is what EPGL show and
 * what their Salesforce raises the payment advice for, and it is the figure a
 * Virtual IBAN applicant pays. What changes is the surcharge for paying through
 * the gateway: 700 becomes 1,000, and a card payment comes to AED 101,000.
 *
 *   VIBAN      100,000          (unchanged)
 *   Gateway    100,000 + 1,000  =  101,000
 *
 * The surcharge is a configured `surcharges` entry gated on
 * `payment_method == 'gateway'`, so request_payment adds it and the prompt
 * discloses it ON the option when the choice is presented. Changing the amount
 * here changes what is charged AND what is said, which is the whole reason the
 * fee lives there rather than in a sentence.
 *
 * THE WORDING GOES WITH IT, in the same run. Two sentences in the journey
 * guidance name both figures outright — "adds an online payment fee of AED 700,
 * so a card payment comes to AED 100,700" — and a surcharge raised without them
 * is a model quoting last month's price with total confidence. Anything else
 * still mentioning the old numbers afterwards is REPORTED rather than guessed
 * at: a sweep prints what it found and where.
 *
 * Staging's base is deliberately small (1,000) so the mechanism can be tested
 * without showing anyone a live fee. The surcharge applies there too, so this
 * runs on both and the base is never touched by it.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/epgl-online-fee-1000-2026-10-01.ts --env <file> [--dry-run]
 */
import { databaseUrlFrom } from "./lib/envFile";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { agents, kbChunks, kbDocuments } from "@dialog/db";
import { eq } from "drizzle-orm";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const ENV = arg("--env");
if (!ENV) throw new Error("--env <envfile> is required");
const DRY = process.argv.includes("--dry-run");

const SLUG = "epgl-dialog";
const JOURNEYS = ["new_license", "renewal"];
const KEY = "online_payment_fee";
const OLD = 700;
const NEW = 1000;

/** The sentences that state the figure, as the 23 September script left them. */
const TEXT: { find: string; replace: string }[] = [
  {
    find:
      "Paying through the online gateway adds an online payment fee of AED 700, so a card payment comes to AED 100,700; the Virtual IBAN route is the fee itself, AED 100,000.",
    replace:
      "Paying through the online gateway adds an online payment fee of AED 1,000, so a card payment comes to AED 101,000; the Virtual IBAN route is the fee itself, AED 100,000.",
  },
  {
    find:
      "Paying online adds an online payment fee of AED 700 — AED 100,700 by card, AED 100,000 by Virtual IBAN — and that difference is the customer's to know BEFORE they choose, not after.",
    replace:
      "Paying online adds an online payment fee of AED 1,000 — AED 101,000 by card, AED 100,000 by Virtual IBAN — and that difference is the customer's to know BEFORE they choose, not after.",
  },
  /**
   * AND THE ONE SEPTEMBER MISSED.
   *
   * The 23 September script matched the fee-structure sentence in full,
   * including the clause that explains the surcharge — which new_license had
   * and renewal did not. So renewal's copy was skipped and has been saying
   * "An annual licensing fee of AED 100,700" ever since, beside a later
   * paragraph in the same guidance saying the fee is 100,000. Two numbers for
   * one fee, in one prompt.
   */
  {
    find:
      "(1) An annual licensing fee of AED 100,700, paid in advance when the licence is issued and at each renewal — the minimum fee for the licence period.",
    replace:
      "(1) An annual licensing fee of AED 100,000, paid in advance when the licence is issued and at each renewal — the minimum fee for the licence period. Paying through the online gateway adds an online payment fee of AED 1,000, so a card payment comes to AED 101,000; the Virtual IBAN route is the fee itself, AED 100,000.",
  },
];

/**
 * THE KNOWLEDGE BASE SAYS IT TOO, AND IT IS A DIFFERENT STORE.
 *
 * The journey answers "what will I pay?". A COLD question — "what does a postal
 * licence cost?" — is answered from the knowledge base, which has its own copy
 * of the figure and five documents carrying it, in both languages. Correcting
 * one and not the other is how the same agent quotes two prices in one
 * conversation, and it has happened before.
 *
 * Only the figure is rewritten, in place, and every edit is printed. Embeddings
 * are NOT regenerated: the surrounding sentence is unchanged, so the vector
 * still finds the chunk it always found, and a stale number is a worse thing to
 * leave behind than a vector computed from a figure one word out.
 */
const KB: { find: RegExp; replace: string }[] = [
  /**
   * Tidy first, so the replacement below cannot nest inside its own brackets.
   *
   * "Pay the prescribed postal fees (AED 100,700)" became "(AED 100,000 (AED
   * 101,000 if paid by card …))" — correct, and read aloud by an agent it is a
   * sentence that loses the reader halfway through.
   */
  {
    find: /\(AED 100,000 \(AED 101,000 if paid by card, which adds an online payment fee of AED 1,000\)\)/g,
    replace: "(AED 100,000, or AED 101,000 if paid by card, which adds an online payment fee of AED 1,000)",
  },
  {
    find: /\(AED 100,700\)/g,
    replace: "(AED 100,000, or AED 101,000 if paid by card, which adds an online payment fee of AED 1,000)",
  },
  {
    find: /AED 100,700/g,
    replace: "AED 100,000 (AED 101,000 if paid by card, which adds an online payment fee of AED 1,000)",
  },
  {
    find: /100,700 درهم إماراتي/g,
    replace: "100,000 درهم إماراتي (101,000 درهم عند الدفع بالبطاقة، شاملاً رسم الدفع الإلكتروني البالغ 1,000 درهم)",
  },
];

/** What must not still be in the guidance when this finishes. */
const STALE = [/\bAED\s*700\b/g, /\b100,?700\b/g];

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrlFrom(ENV!) });
  const db = drizzle(pool, { schema: { agents, kbDocuments, kbChunks } });
  try {
    const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG));
    if (!row) throw new Error(`No agent ${SLUG} in this database`);
    const def = JSON.parse(JSON.stringify(row.definition)) as {
      journeys?: { key: string; guidance?: string; submission?: Record<string, unknown> }[];
    };
    let changes = 0;

    for (const key of JOURNEYS) {
      const j = (def.journeys ?? []).find((x) => x.key === key);
      if (!j) throw new Error(`${SLUG} has no journey "${key}" here`);
      if (!j.submission) throw new Error(`${key}: no submission block — nothing is charged here`);
      const sub = j.submission;

      /**
       * REFUSE TO LEAVE A PERCENTAGE ON. The 1% "Admin processing fees" EPGL
       * floated in September was withdrawn, and a percentage sitting beside a
       * fixed surcharge charges both.
       */
      if (sub.processingFee) {
        throw new Error(`${key}: a processingFee is configured (${JSON.stringify(sub.processingFee)}) — the two would stack`);
      }

      const list = Array.isArray(sub.surcharges) ? (sub.surcharges as Record<string, unknown>[]) : [];
      const fee = list.find((s) => s.key === KEY);
      if (!fee) {
        throw new Error(`${key}: no "${KEY}" surcharge here — run epgl-online-fee-2026-09-23.ts first; this script raises an existing fee, it does not invent one`);
      }
      // The base is EPGL's licence fee and is not this script's business. It is
      // read only so a surprise is visible rather than silent.
      console.log(`  · ${key}: licence fee ${String(sub.amount)} (unchanged)`);
      if (fee.amount === NEW) {
        console.log(`  (already) ${key}: ${KEY} = ${NEW}`);
      } else if (fee.amount !== OLD) {
        throw new Error(`${key}: ${KEY} is ${String(fee.amount)}, not ${OLD} — someone changed it since 23 September, so stop rather than overwrite it`);
      } else {
        console.log(`  ~ ${key}: ${KEY} ${OLD} -> ${NEW}`);
        fee.amount = NEW;
        changes++;
      }

      const before = String(j.guidance ?? "");
      let next = before;
      for (const t of TEXT) {
        if (next.includes(t.replace)) continue;
        if (!next.includes(t.find)) {
          // Matched in full, so a phrase this does not recognise is left alone
          // rather than written over. The two environments have drifted before.
          console.log(`  · ${key}: no "${t.find.slice(0, 44)}…" here`);
          continue;
        }
        next = next.split(t.find).join(t.replace);
        console.log(`  ~ ${key}: wording updated`);
        changes++;
      }
      if (next !== before) j.guidance = next;

      for (const re of STALE) {
        const hits = String(j.guidance ?? "").match(re);
        if (hits?.length) {
          console.log(`  ! ${key}: still says ${[...new Set(hits)].join(", ")} — read it and fix it by hand`);
        }
      }
    }

    /**
     * And the knowledge base, which answers a COLD question about the fee and
     * is a separate store from the journey. A price corrected in one and not
     * the other is how "what does the licence cost?" and "what will I pay?"
     * come back with different numbers. Reported, never rewritten: these are
     * EPGL's documents.
     */
    const docs = await db.select().from(kbDocuments).where(eq(kbDocuments.agentId, row.id));
    const chunks = await db.select().from(kbChunks).where(eq(kbChunks.agentId, row.id));
    const titleOf = new Map(docs.map((d) => [d.id, d.title]));
    console.log("\nKnowledge base:");
    let kbTouched = 0;
    for (const c of chunks) {
      let next = c.content;
      for (const r of KB) next = next.replace(r.find, r.replace);
      const title = titleOf.get(c.documentId) ?? c.documentId;
      if (next !== c.content) {
        console.log(`  ~ ${title}`);
        kbTouched++;
        changes++;
        if (!DRY) await db.update(kbChunks).set({ content: next }).where(eq(kbChunks.id, c.id));
      }
      /**
       * What is left AFTER the replacements, not before.
       *
       * Checked against the original first time round, which reported a chunk
       * this script had just corrected — and a false alarm in a report like
       * this is worse than no report, because the next person stops reading it.
       */
      const left = next.match(/100,?700/g);
      if (left?.length) {
        console.log(`  ! ${title} still says ${[...new Set(left)].join(", ")} in a wording this does not recognise — read it`);
      }
    }
    if (!kbTouched) console.log("  (already) nothing carrying the old figure");

    if (!changes) { console.log("\nAlready applied — nothing to change."); return; }
    if (DRY) { console.log(`\n--dry-run: ${changes} change(s) NOT written.`); return; }
    await db.update(agents).set({ definition: def as unknown as typeof row.definition }).where(eq(agents.id, row.id));
    console.log(`\n${changes} change(s) written.`);
  } finally {
    await pool.end();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
