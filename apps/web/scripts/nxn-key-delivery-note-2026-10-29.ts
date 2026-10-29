/**
 * The key-delivery note goes ON the choice, not only into a sentence (2026-10-29).
 *
 * Emirates Post: "Key Delivery - 1 - Add a note informing the customer that
 * Customer Service will contact them to arrange the key delivery."
 *
 * The agent was already told to say this. The block below has existed since
 * September, in both rental journeys, in these words: "tell them in the same
 * breath that Emirates Post customer service will contact them to arrange the
 * delivery". So the gap is not that nobody wrote the rule — it is that a rule
 * about what to SAY produces a sentence in one reply, somewhere above a card,
 * and then the conversation moves on. The customer scrolls back to the card
 * they chose and the card says AED 30 and nothing else.
 *
 * A note that must survive being scrolled past belongs on the thing it
 * qualifies. `OptionCard` already has the slot — `priceNote`, "a small line
 * UNDER the price" — and the summary block takes a text value as readily as a
 * figure. So the note is pinned in three places that outlive the sentence: the
 * delivery card, the summary row, and the confirmation.
 *
 * SCOPED TO THE TWO RENTAL JOURNEYS ON PURPOSE. Key delivery is a courier
 * add-on priced on a rental; KEY_DELIVERY was removed from the manage-a-box
 * menu on 4 September because a box that already exists has nowhere to put it.
 * Adding this note there would advertise it again.
 *
 * Idempotent, by delimiters rather than by guesswork:
 *   npx tsx scripts/nxn-key-delivery-note-2026-10-29.ts --env <file> [--dry-run]
 *   DATABASE_URL='…' npx tsx scripts/nxn-key-delivery-note-2026-10-29.ts [--dry-run]
 */
import { databaseUrlFromArgs } from "./lib/envFile";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { agents } from "@dialog/db";
import { eq } from "drizzle-orm";

const DRY = process.argv.includes("--dry-run");
const SLUG = "nxn-dialog";
const MARKER = "KEY DELIVERY IS ARRANGED BY PHONE";
/** Only where key delivery is actually sold. */
const JOURNEYS = /^(personal_po_box_rental|corporate_po_box_rental)$/;

/** Exactly what is live today, so it is removed rather than duplicated. */
const PREVIOUS =
  "KEY DELIVERY IS ARRANGED BY PHONE. When the customer chooses to have the key delivered rather than collecting it, " +
  "tell them in the same breath that Emirates Post customer service will contact them to arrange the delivery — it is not " +
  "dispatched automatically and no date is set at checkout. Say it when they pick the option and again in the confirmation, " +
  "because someone who is not told waits in for a courier who was never booked. Do not promise a delivery date, a time window " +
  "or a tracking number: you do not have any of them.";

const BODY =
  `${MARKER}, AND THE CARD SAYS SO. Key delivery is not dispatched automatically and no date is set at checkout: ` +
  "Emirates Post customer service call the customer to arrange it.\n\n" +
  "That is not a sentence to remember — it goes ON the choice, where scrolling past cannot lose it. The delivery card in the " +
  "```cards block carries it as its `priceNote`, the small line under the price:\n" +
  "  `priceNote: Customer service will call you to arrange delivery`\n" +
  "and in an Arabic conversation\n" +
  "  `priceNote: ستتصل بك خدمة العملاء لترتيب التوصيل`\n" +
  "The branch-collection card carries NO such note: nothing is being arranged, and a note on both would say nothing.\n\n" +
  "It appears twice more, because the card is gone by the time the courier does not arrive. Put a row in the ```summary " +
  "block directly under the key-delivery charge — `Key delivery: Customer service will call to arrange it`, in Arabic " +
  "`توصيل المفتاح: ستتصل بك خدمة العملاء لترتيبه` — and say it once in words in the confirmation after payment.\n\n" +
  "Do NOT promise a delivery date, a time window or a tracking number. You hold none of them, and \"in a few days\" is a " +
  "promise too. If the customer asks when it will come, the honest answer is that customer service will call to agree a time.";

const open_ = (m: string) => `<!--nxn:${m}-->`;
const close_ = (m: string) => `<!--/nxn:${m}-->`;
const wrap = (m: string, body: string) => `${open_(m)}\n${body}\n${close_(m)}`;

/**
 * Remove every copy of this block — delimited first, then any bare one an
 * earlier script left behind. Delimiters, not paragraph-guessing: the 4
 * September note in nxn-enhancements records what guessing did, which was to
 * eat the block that followed and leave one and a half copies behind.
 */
function strip(text: string, marker: string, bodies: readonly string[]): string {
  const a = open_(marker);
  const b = close_(marker);
  for (;;) {
    const i = text.indexOf(a);
    if (i === -1) break;
    const j = text.indexOf(b, i);
    if (j === -1) { text = text.replace(a, ""); continue; }
    text = text.slice(0, i) + text.slice(j + b.length);
  }
  for (const body of bodies) while (text.includes(body)) text = text.replace(body, "");
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrlFromArgs() });
  const db = drizzle(pool, { schema: { agents } });
  try {
    const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG));
    if (!row) throw new Error(`No agent ${SLUG} in this database`);
    const def = JSON.parse(JSON.stringify(row.definition)) as { journeys?: Record<string, unknown>[] };
    let changed = 0;

    for (const j of def.journeys ?? []) {
      const key = String(j.key ?? "");
      const before = String(j.guidance ?? "");
      if (!before) continue;
      if (!JOURNEYS.test(key)) {
        // Named rather than skipped silently: "it is not in the manage journey"
        // is a decision, and a later reader should see it was made.
        if (before.includes(MARKER)) console.log(`  ! ${key}: carries the block but does not sell key delivery`);
        continue;
      }
      const had = before.includes(open_(MARKER));
      const next = `${strip(before, MARKER, [PREVIOUS, BODY])}\n\n${wrap(MARKER, BODY)}`.trim();
      if (next === before) { console.log(`  (already) ${key}`); continue; }
      j.guidance = next;
      changed++;
      console.log(`  ${had ? "~" : "+"} ${key}: ${MARKER} (${before.length} → ${next.length} chars)`);
    }

    /**
     * The block went in once per journey and took nothing with it. Checked
     * rather than assumed: a strip that removes one character too many is
     * invisible until a customer hits the paragraph that is no longer there.
     */
    for (const j of def.journeys ?? []) {
      const g = String(j.guidance ?? "");
      if (!JOURNEYS.test(String(j.key ?? ""))) continue;
      const opens = g.split(open_(MARKER)).length - 1;
      const closes = g.split(close_(MARKER)).length - 1;
      const stray = g.includes(PREVIOUS);
      console.log(`  check ${String(j.key)}: ${opens} open / ${closes} close delimiter(s), previous wording present: ${stray}`);
      if (opens !== 1 || closes !== 1 || stray) throw new Error(`${String(j.key)}: the block is not exactly once in place — refusing to write`);
    }

    if (!changed) { console.log("\nAlready applied — nothing written."); return; }
    if (DRY) { console.log(`\n--dry-run: ${changed} journey(ies) NOT written.`); return; }
    await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
    console.log(`\n${changed} journey(ies) written.`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
