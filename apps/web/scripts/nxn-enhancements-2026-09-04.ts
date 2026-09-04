/**
 * NXN enhancements (2026-09-04), from Emirates Post's review.
 *
 * Three changes to how the rental and renewal journeys are run, all of them
 * things the customer sees:
 *
 *   1. Key delivery: say that customer service will call to arrange it. The
 *      courier does not simply arrive, and a customer who is not told waits in
 *      for a delivery that was never booked.
 *   5. The Terms and Conditions checkbox moves to the payment step, beside the
 *      auto-renewal and save-card toggles, rather than sitting on its own
 *      earlier in the conversation.
 *   6. A customer with a saved card must also be offered a NEW card. Emirates
 *      Post holding a card is not consent to use it, and someone paying on a
 *      company card for a corporate box should not have to hunt for the option.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/nxn-enhancements-2026-09-04.ts [--env <file>] [--dry-run]
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

const SLUG = "nxn-dialog";
const DRY = process.argv.includes("--dry-run");

/** Each block is identified by its marker so a re-run replaces rather than appends. */
const BLOCKS: { marker: string; journeys: RegExp; text: string }[] = [
  {
    marker: "KEY DELIVERY IS ARRANGED BY PHONE",
    journeys: /rental/,
    text:
      "KEY DELIVERY IS ARRANGED BY PHONE. When the customer chooses to have the key delivered rather than collecting " +
      "it, tell them in the same breath that Emirates Post customer service will contact them to arrange the " +
      "delivery — it is not dispatched automatically and no date is set at checkout. Say it when they pick the " +
      "option and again in the confirmation, because someone who is not told waits in for a courier who was never " +
      "booked. Do not promise a delivery date, a time window or a tracking number: you do not have any of them.",
  },
  {
    marker: "TERMS AND CONDITIONS GO WITH THE PAYMENT TOGGLES",
    journeys: /rental|renewal/,
    text:
      "TERMS AND CONDITIONS GO WITH THE PAYMENT TOGGLES, not earlier. Do NOT ask for acceptance as its own step " +
      "partway through the conversation. At the payment step, present ONE ```toggles block containing the " +
      "acceptance and the payment preferences together, then the proceed button:\\n" +
      "```toggles\\n" +
      "title: Before payment\\n" +
      "style: checkbox\\n" +
      "- terms_accepted: I accept the Terms and Conditions\\n" +
      "- save_card_consent: Save my card for future payments\\n" +
      "- auto_renew_consent: Renew my box automatically next year\\n" +
      "confirm: Proceed to payment\\n" +
      "```\\n" +
      "Record each one with collect_field from the toggle results. terms_accepted is MANDATORY and payment is " +
      "refused server-side without it, so if they proceed without ticking it, say plainly that the Terms have to be " +
      "accepted before paying and show the block again. The other two are genuinely optional and must default to " +
      "OFF — never enable auto-renewal or card saving on a customer's behalf. For a GUEST, offer only " +
      "terms_accepted: saving a card and auto-renewal both need an account.",
  },
  {
    marker: "A SAVED CARD IS AN OFFER, NOT THE ONLY OPTION",
    journeys: /rental|renewal/,
    text:
      "A SAVED CARD IS AN OFFER, NOT THE ONLY OPTION. When Emirates Post already holds a card for this customer, " +
      "name it (e.g. \\\"Visa ending 4242\\\") and offer BOTH ways to pay, as buttons, before you take the payment:\\n" +
      "```buttons\\n" +
      "- Pay with my saved Visa ending 4242\\n" +
      "- Pay with a different card\\n" +
      "```\\n" +
      "If they choose a different card, take the payment WITHOUT the saved card so the payment page opens blank for " +
      "them to enter one. Emirates Post holding a card is not the customer's consent to use it — somebody paying " +
      "for a corporate box on a company card should not have to ask for the option — so never charge the saved card " +
      "just because it is there, and never present it as the only way to proceed.",
  },
  {
    marker: "SAY WHEN THE BOX EXPIRES",
    journeys: /corporate_po_box_rental/,
    text:
      "SAY WHEN THE BOX EXPIRES, in the customer's own terms. A corporate rental runs to a fixed expiry date rather " +
      "than a rolling year from today, so state BOTH the date and the span it covers when you present the period " +
      "options and again in the pre-payment summary — for example \"expires 31 December 2027, so this covers 2 years " +
      "and 4 months\". Take the dates from the expiry-dates tool and never compute one yourself. If the span is " +
      "shorter than a full year because of when they are applying, say so plainly rather than letting them work it " +
      "out from a date: a company budgeting for a year should not discover at renewal that they bought eight months.",
  },
  {
    marker: "A CORPORATE BOX IS APPROVED BEFORE IT IS OPEN",
    journeys: /corporate_po_box_rental/,
    text:
      "A CORPORATE BOX IS APPROVED BEFORE IT IS OPEN, and the customer should be able to follow that. When the " +
      "rental is submitted, tell them plainly what happens next: Emirates Post reviews the trade licence and the " +
      "authorisation, the box shows as PENDING APPROVAL until they do, and the reference you just gave them is what " +
      "to quote. If they come back and ask where it has got to, look it up with the customer's own box list rather " +
      "than guessing — status \"Pending approval\" means the review is still running and is NOT a failure or a " +
      "payment problem, \"Active\" means it is open, and \"Rejected\" means they need to speak to Emirates Post. " +
      "Never tell a customer their corporate box is ready while it is still pending.",
  },
  {
    marker: "A PENDING BOX CANNOT BE MANAGED YET",
    journeys: /manage_po_box|renewal/,
    text:
      "A PENDING BOX CANNOT BE MANAGED YET. A box whose status is \"Pending approval\" or \"Rejected\" is not open, " +
      "so do NOT offer to renew it, add an agent to it, change its subscription, or set auto-renewal — none of those " +
      "can complete and each one ends in a backend error the customer reads as a fault of their own. If they ask, " +
      "say the box is still being approved, name the reference, and offer to help with anything else. Only a box " +
      "showing as Active can be managed.",
  },
];

interface Journey { key: string; guidance?: string }

/**
 * Blocks are DELIMITED, not guessed at.
 *
 * The first version of this split the guidance into paragraphs, found the one
 * containing the marker, and removed forward until something looked like the
 * next heading. It ate the following block, so two runs left the prompt with
 * one and a half copies -- the same failure as the callback script, and for the
 * same reason: prose has no reliable structure to key on.
 *
 * An explicit start and end sentinel is unambiguous, and invisible to the model
 * beyond being two odd-looking lines.
 */
const open_ = (m: string) => `<!--nxn:${m}-->`;
const close_ = (m: string) => `<!--/nxn:${m}-->`;

function strip(text: string, marker: string, body: string): string {
  const a = open_(marker);
  const b = close_(marker);
  // Delimited copies first.
  for (;;) {
    const i = text.indexOf(a);
    if (i === -1) break;
    const j = text.indexOf(b, i);
    if (j === -1) { text = text.replace(a, ""); continue; }
    text = text.slice(0, i) + text.slice(j + b.length);
  }
  // Then any UNDELIMITED copies left by an earlier version of this script, which
  // appended without being able to find what it had written before. Four copies
  // of each block had accumulated on some journeys. The body is a known constant,
  // so exact removal is safe where paragraph-guessing was not.
  while (text.includes(body)) text = text.replace(body, "");
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

function wrap(marker: string, body: string): string {
  return `${open_(marker)}\n${body}\n${close_(marker)}`;
}

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`${SLUG} not found`);
  const def = row.definition as unknown as { journeys: Journey[] };
  let changed = 0;

  for (const j of def.journeys) {
    const mine = BLOCKS.filter((b) => b.journeys.test(j.key));
    if (!mine.length) continue;
    const before = String(j.guidance ?? "");

    // Strip EVERY block first, then append them in a fixed order. Stripping and
    // appending one at a time rotated their order on each run: same content,
    // different sequence, so the script reported a change forever and never
    // settled. Rebuilt as a whole, it converges after one pass.
    let base = before;
    for (const b of BLOCKS) base = strip(base, b.marker, b.text);
    const next = [base, ...mine.map((b) => wrap(b.marker, b.text))].filter(Boolean).join("\n\n").trim();

    if (next === before) { console.log(`  (already) ${j.key}`); continue; }
    j.guidance = next;
    changed++;
    for (const b of mine) {
      console.log(`  ${before.includes(open_(b.marker)) ? "~" : "+"} ${j.key}: ${b.marker.slice(0, 42)}`);
    }
  }

  if (!changed) { console.log("\nnothing to do."); return; }
  if (DRY) { console.log(`\n--dry-run: ${changed} change(s) not written.`); return; }
  await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
  console.log(`\n${changed} change(s) written.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
