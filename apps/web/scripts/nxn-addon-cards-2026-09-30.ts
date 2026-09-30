/**
 * An add-on is offered as a CARD, with its price on it (2026-09-30).
 *
 * REVISED SAME DAY (b). The first pass priced BOTH cards "Free", and production
 * showed "Add an authorised agent — Free" beside "No agent for now — Free",
 * which reads as a pricing table on which everything is free. It is not. The
 * first agent is INCLUDED in Emirates Post's reservation amount — they return
 * its price line marked Inclusive — and agents beyond the first are charged.
 * Declining, meanwhile, has no price at all.
 *
 * The distinction is not pedantry. Adding the first agent's list price on top
 * of a total that already contained it is a bug we have already had: AED 450
 * shown for a 400 rental, refused by Emirates Post with "121
 * MISMATCH_IN_AMOUNT: TotalAmountShouldBe:400". "Included" is the word that is
 * true read from either direction.
 *
 * "It shouldn't ask for the agent with this button design — it should be like
 * what it used to be", with a screenshot of the key-delivery choice: two cards,
 * each with a title, a line saying what it is, and what it costs.
 *
 * The authorised agent was coming through as "Yes, add an agent / No, skip",
 * because the guidance treats anything binary as a yes/no and says to use
 * buttons for those. But an add-on is not a yes/no: it has a price — the first
 * agent is free, the second is not — and a price belongs on the thing being
 * bought, not in a sentence above two pills. Key delivery has always been a
 * card for exactly that reason.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/nxn-addon-cards-2026-09-30.ts --env <file> [--dry-run]
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
const SLUG = "nxn-dialog";
const MARKER = "ADD-ONS ARE CARDS (2026-09-30b)";

const RULE =
  ` ${MARKER}: an ADD-ON is offered as a \`\`\`cards block, never as a yes/no \`\`\`buttons block.` +
  ` The authorised agent and the key delivery are add-ons: each has a price, and a price belongs ON the thing being bought rather than in a sentence above two pills.` +
  ` Two cards, the same shape the key-delivery choice already uses — a title, one line saying what it is, and what it costs.` +
  ` The declining card is a card too, so the customer is choosing between two things rather than answering a question about one — but it carries NO price line at all. Declining is not a price, and "Free" on both cards side by side reads as a claim that the service is free rather than as a choice between two.` +
  ` THE FIRST AUTHORISED AGENT IS INCLUDED, NOT FREE, and the difference is worth the word: Emirates Post's reservation amount already contains the annual rent, the registration fee AND the first agent, whose own price line comes back from them marked Inclusive.` +
  ` So that card is priced "Included" — never "Free", never "AED 0.00" — with its description saying it is already part of the rental price. Agents BEYOND the first are charged: give that price only when the customer asks for a second, and take it from the reservation rather than from memory.` +
  ` This does NOT change ordinary confirmations — "proceed?", "are these details right?" — which stay as \`\`\`buttons. The test is whether the choice has a PRICE.`;

/** The instruction that told it to use buttons for this, verbatim. */
const REPLACE = [
  {
    find:
      "offer it EXACTLY ONCE as a short line plus a ```buttons block with 'Add an authorised agent' and 'Not now'",
    replace:
      "offer it EXACTLY ONCE as a short line plus a ```cards block with two cards — 'Add an authorised agent', priced 'Included' because the reservation amount already contains the first one, and 'No agent for now' with no price line at all — never a yes/no buttons block",
  },
];

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrlFrom(ENV!) });
  const db = drizzle(pool, { schema: { agents } });
  try {
    const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG));
    if (!row) throw new Error(`No agent ${SLUG} in this database`);
    const def = JSON.parse(JSON.stringify(row.definition)) as Record<string, any>;
    let changes = 0;

    for (const j of def.journeys ?? []) {
      const before = String(j.guidance ?? "");
      if (!before) continue;
      let next = before;
      /**
       * Its own earlier revision goes first, so a re-run REPLACES rather than
       * leaving two rules that disagree about a price standing side by side.
       */
      const SUPERSEDED = " ADD-ONS ARE CARDS (2026-09-30):";
      const at = next.indexOf(SUPERSEDED);
      if (at !== -1) {
        next = next.slice(0, at);
        console.log(`  - ${j.key}: removed the superseded 2026-09-30 rule`);
      }
      for (const r of REPLACE) {
        if (!next.includes(r.find)) continue;
        next = next.split(r.find).join(r.replace);
        console.log(`  ~ ${j.key}: the buttons instruction for the agent offer`);
      }
      /**
       * And the wording the first pass wrote into the corporate journey, which
       * said "Free" on both cards. Matched in full so it is replaced rather
       * than added to.
       */
      const FIRST_PASS =
        "offer it EXACTLY ONCE as a short line plus a ```cards block with two cards — 'Add an authorised agent' (Free, the first is included) and 'No agent for now' (Free) — never a yes/no buttons block";
      if (next.includes(FIRST_PASS)) {
        next = next.split(FIRST_PASS).join(REPLACE[0]!.replace);
        console.log(`  ~ ${j.key}: corrected the first pass's "Free" wording`);
      }
      if (!next.includes(MARKER)) {
        next += RULE;
        console.log(`  + ${j.key}: ${MARKER}`);
      }
      if (next !== before) { j.guidance = next; changes++; }
      else console.log(`  (already) ${j.key}`);
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
