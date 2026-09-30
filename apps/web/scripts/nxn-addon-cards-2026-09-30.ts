/**
 * An add-on is offered as a CARD, with its price on it (2026-09-30).
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
const MARKER = "ADD-ONS ARE CARDS (2026-09-30)";

const RULE =
  ` ${MARKER}: an ADD-ON is offered as a \`\`\`cards block, never as a yes/no \`\`\`buttons block.` +
  ` The authorised agent and the key delivery are add-ons: each has a price, and a price belongs ON the thing being bought rather than in a sentence above two pills.` +
  ` Two cards, the same shape the key-delivery choice already uses — a title, one line saying what it is, and what it costs.` +
  ` The declining card is a card too ("No agent for now", "Free"), so the customer is choosing between two things rather than answering a question about one.` +
  ` The first authorised agent is included, so its card reads Free; say the price of a second only if they ask for one.` +
  ` This does NOT change ordinary confirmations — "proceed?", "are these details right?" — which stay as \`\`\`buttons. The test is whether the choice has a PRICE.`;

/** The instruction that told it to use buttons for this, verbatim. */
const REPLACE = [
  {
    find:
      "offer it EXACTLY ONCE as a short line plus a ```buttons block with 'Add an authorised agent' and 'Not now'",
    replace:
      "offer it EXACTLY ONCE as a short line plus a ```cards block with two cards — 'Add an authorised agent' (Free, the first is included) and 'No agent for now' (Free) — never a yes/no buttons block",
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
      for (const r of REPLACE) {
        if (!next.includes(r.find)) continue;
        next = next.split(r.find).join(r.replace);
        console.log(`  ~ ${j.key}: the buttons instruction for the agent offer`);
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
