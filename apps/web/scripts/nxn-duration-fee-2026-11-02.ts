/**
 * Say the term AND what it costs, at the moment it is chosen (2 Nov 2026).
 *
 * Emirates Post: "I suggest including both the selected subscription duration
 * and the corresponding fee in Mira's confirmation message to make the
 * selection clearer for customers." In the transcript they sent, the customer
 * taps 1 Year and the reply is "Got it. Would you like to add an authorised
 * agent to this PO Box?" — the term is not repeated and the price is not named,
 * and the next figure the customer sees is the total at the payment step.
 *
 * The figure is already there to be said. The duration cards are stamped from
 * the ladder Emirates Post actually priced (lib/durationCards), so the card the
 * customer just tapped carries a real total; this asks for that number to be
 * repeated rather than for a new one to be worked out.
 *
 * WHICH IS THE WHOLE RISK, AND WHY THE RULE IS WORDED THE WAY IT IS. Nothing
 * here may be computed. An annual rate times five is not the five-year price —
 * MyHome Instant's five years is 4,000, not 4,975 — and the one failure mode
 * worse than a silent confirmation is a confident wrong number in it. So: quote
 * the card, or say the price is confirmed when the box is reserved.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/nxn-duration-fee-2026-11-02.ts --env <file> [--slug nxn-dialog] [--apply]
 */
import { databaseUrlFrom } from "./lib/envFile";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const SLUG = arg("--slug") ?? "nxn-dialog";
const APPLY = process.argv.includes("--apply");

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { agents } from "@dialog/db";
import { eq } from "drizzle-orm";

export const MARKER = "CONFIRM THE TERM WITH ITS PRICE (2026-11-02";

/** Only where a term is actually chosen. The manage journey rents nothing. */
export const JOURNEYS = /_(rental|renewal)$/;

export const RULE = `
${MARKER} — from Emirates Post). When the customer picks a subscription length — tapping a duration card, or typing "1 year" at the question — your acknowledgement names BOTH the term and what it costs, before you move on to the next question.

"Got it — 1 year, AED 370.00." Then the next question. Not "Got it." on its own, which is what they reported: the term was not repeated, the price was not named, and the next figure the customer saw was the total on the payment card.

QUOTE THE CARD. NEVER WORK THE NUMBER OUT. The figure is the one on the duration card the customer just chose, exactly as it was shown. Do not multiply an annual rate by the number of years, do not add the registration fee yourself, and do not carry a figure across from a different bundle or a different box. An annual rate times five is not the five-year price, and a confident wrong number is worse than the silence this replaces.

IF THAT CARD CARRIED NO PRICE, say so in the same breath — "Got it — 5 years. The price is confirmed when the box is reserved." A term Emirates Post has not priced has no price to state, and an honest blank is right where an invented figure is not.

SAY IT ONCE. This is the short acknowledgement, not a breakdown: one line, then the next question. The rental and registration lines belong in the summary card, where they already are, and repeating the whole arithmetic here makes the turn longer rather than clearer.

IN ARABIC, the same: "تم — سنة واحدة، 370.00 درهم." Then the next question.
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

    console.log(`${SLUG} — journeys: ${(def.journeys ?? []).map((j: any) => j.key).join(", ")}\n`);
    const changes: string[] = [];
    for (const j of def.journeys ?? []) {
      const key = String(j.key ?? "");
      if (!JOURNEYS.test(key)) { console.log(`   skip ${key} — nothing is rented in it`); continue; }
      const g = String(j.guidance ?? "");
      if (g.includes(MARKER)) { console.log(`   ${key} — already applied`); continue; }
      j.guidance = `${g.trimEnd()}\n\n${RULE}`;
      changes.push(`${key}: +${RULE.length} chars`);
    }

    if (!changes.length) { console.log("\nnothing to do."); return; }
    console.log(`\n${changes.length} change(s):`);
    for (const c of changes) console.log(`   ~ ${c}`);
    if (APPLY) {
      await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
      console.log("\nwritten.");
    } else console.log("\nDry run — nothing written. Add --apply to write.");
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.endsWith("nxn-duration-fee-2026-11-02.ts")) {
  main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
}
