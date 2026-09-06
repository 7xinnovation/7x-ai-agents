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
      "partway through the conversation.\n\n" +
      "ONE block, ONE button. The payment preferences stay as toggle SWITCHES exactly as they always were, and the " +
      "Terms acceptance is a CHECKBOX underneath them — name it on the `checkboxes:` line and it renders as a tickbox " +
      "while the others stay switches. Do not emit two blocks: that gives the customer two buttons for one decision.\n" +
      "```toggles\n" +
      "title: Before payment\n" +
      "default: on\n" +
      "checkboxes: terms_accepted\n" +
      "- save_card_consent: Save my card for future payments\n" +
      "- auto_renew_consent: Renew my box automatically next year\n" +
      "- terms_accepted: I accept the [Terms and Conditions](https://www.emiratespost.ae/en/terms-and-conditions)\n" +
      "confirm: Proceed to payment\n" +
      "```\n" +
      "ORDER OF THE PAYMENT STEP, and it does not vary: (1) the preferences block below, with the Terms checkbox, " +
      "(2) if Emirates Post holds a card, the choice of saved card or a different one, (3) reserve the box, " +
      "(4) the itemised breakdown with the exact total, (5) the payment button. Everything the customer decides is " +
      "settled BEFORE the reservation, because the reservation starts a clock and the total is computed from what " +
      "they have already chosen — asking for preferences after the box is held put the courier fee in the breakdown " +
      "and left it out of the charge. Never reserve the box before the Terms are accepted.\n" +
      "Record each with collect_field from the results. `default: on` is REQUIRED and is what makes the two " +
      "switches start enabled — Emirates Post asked for saving the card and auto-renewal to be the default, and " +
      "there is an endpoint behind both. It never ticks the Terms checkbox: a pre-ticked acknowledgment is not an " +
      "acknowledgment, and the button stays disabled until the customer ticks it themselves. The two switches do " +
      "NOT gate the button — a preference turned off is an answer, and the customer can turn either one off before " +
      "confirming. Record whatever state they confirm, never what you expected. For a GUEST, list ONLY " +
      "terms_accepted and omit `default: on`: saving a card and auto-renewal both need an account.",
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
    marker: "NEVER SPEAK IN INTERNAL IDENTIFIERS",
    journeys: /./,
    text:
      "NEVER SPEAK IN INTERNAL IDENTIFIERS. officeId, mainOfficeId, LocationId, uniqueBoxId, bundle_Id, " +
      "EmirateCode, entCode and subscriptionReferenceNumber are how the backend is addressed; they are not how a " +
      "customer is addressed. \"Naif Post Office (officeId: 214) confirmed\" is a database key stapled to a branch " +
      "name, and it reached a real customer. Use the branch NAME, the box NUMBER, the bundle NAME and the order " +
      "reference you were told to give them — nothing else. Carry the ids in your tool calls, where they belong, " +
      "and keep them out of every sentence, card, badge and summary line. The one identifier that IS the " +
      "customer's is the box number itself, and the reference for their order.",
  },
  {
    marker: "THE ISSUING AUTHORITY IS A DROPDOWN",
    journeys: /corporate/,
    text:
      "THE ISSUING AUTHORITY IS A DROPDOWN, not sixty buttons. There are around sixty licensing authorities; " +
      "rendered as cards or buttons they fill the screen twice over and push the question itself out of sight. " +
      "Ask the question and emit a ```select block — three backticks then `select`, then `title:` with the " +
      "question, `placeholder:` with the prompt (e.g. `Select the issuing authority`), a `group: <emirate>` line " +
      "before each emirate's authorities, one `- <authority name>` line per option, and `confirm: Continue`, then " +
      "a closing line of three backticks. It renders as ONE dropdown, grouped by emirate, and on a phone it opens " +
      "the platform's own picker. Do NOT also list the authorities as prose, cards or buttons, and do NOT print " +
      "the list before the block — the block IS how the customer sees them. Everything else is unchanged: the " +
      "names still come only from the entity-lookup tool, you still record the entCode rather than the display " +
      "name, and if the tool does not answer you still say you cannot pull the list and ask them to type the " +
      "authority or give you the licence number instead. Use the same ```select block for any other list this " +
      "long; a short list of real choices stays as buttons.",
  },
  {
    marker: "KEY DELIVERY IS PART OF RENTING, NOT OF MANAGING",
    journeys: /manage_po_box/,
    text:
      "KEY DELIVERY IS PART OF RENTING, NOT OF MANAGING. Courier delivery of the key is an add-on chosen when a " +
      "box is rented or renewed, so it is not one of the things that can be done to a box that already exists — " +
      "do not offer it here, do not suggest it as a next step, and do not present it as an option on a box the " +
      "customer already holds. If they ask about a key for an existing box, say the key is collected from the " +
      "branch that issues it, name that branch if you know it, and offer to arrange a callback.",
  },
  {
    marker: "THE MONEY GOES IN THE CARD",
    journeys: /rental|renewal/,
    text:
      "THE MONEY GOES IN THE CARD, not in a sentence under it. Every amount the customer will pay — the rental for " +
      "the period they chose, the one-time registration fee, each extra agent, key delivery — is a `- Label: AED x` " +
      "ROW inside the ```summary block, with `total:` as the last line. A figure written as prose beneath the card " +
      "is the one place a customer reading a table of what they owe does not look, and it has been mistaken for a " +
      "missing fee twice. Never write \"the registration fee is added when the box is reserved\" as a paragraph: " +
      "put the row in. If you genuinely do not have an amount yet, leave that row out rather than describing it.",
  },
  {
    marker: "SOMETHING THAT IS NOT A PO BOX",
    journeys: /./,
    text:
      "SOMETHING THAT IS NOT A PO BOX — ANSWER IT FROM THE KNOWLEDGE BASE, or not at all. When a customer asks " +
      "about anything outside PO Box rental, renewal and management — tracking a shipment, a payment question, how " +
      "to reach support — call search_knowledge FIRST and answer from what it returns, citing it. The approved " +
      "documents are the FAQs for this service and they are the only source you have for those subjects.\n" +
      "If search_knowledge returns nothing useful, say so in one line and offer to raise an enquiry so the right " +
      "team can call them back. Do NOT answer from your own knowledge, do NOT describe a process you were not " +
      "given, and do NOT invent a fee, a timeframe or a counter service: a confident wrong answer about customs or " +
      "a shipment sends someone to a branch for the wrong thing. Then pick the PO Box matter back up where you " +
      "left it, if there was one.",
  },
  {
    marker: "A BOX HALL IS ACKNOWLEDGED, NOT JUST ANNOUNCED",
    journeys: /rental/,
    text:
      "A BOX HALL IS ACKNOWLEDGED, NOT JUST ANNOUNCED. When the customer picks a P.O. Box hall or complex the " +
      "notice is added to your reply for you, with two buttons — accept, or choose a different branch. Do NOT " +
      "reserve a box, take a payment or move the journey on until they have pressed one. If they accept, carry on " +
      "normally and do not repeat the notice. If they choose another branch, go back to the branch list. Emirates " +
      "Post's own site makes the customer click before it will proceed, and a limitation nobody agreed to is not a " +
      "limitation they were told about.",
  },
  {
    marker: "DO NOT RE-ASK WHAT THEY JUST ANSWERED",
    journeys: /rental|renewal/,
    text:
      "DO NOT RE-ASK WHAT THEY JUST ANSWERED. A reply that opens \"How long would you like your rental to be?\" " +
      "immediately after the customer picked 3 Years reads as not having heard them, and it happens because the " +
      "question was already half-written when their answer arrived. Open on what you are DOING with their answer " +
      "(\"Three years, noted\") or on the next question, never on the one they have just closed. The same goes for " +
      "the bundle, the branch, the box number and the emirate: once it is on the case, it is settled.",
  },
  {
    marker: "AN INCLUDED AGENT IS WRITTEN AS INCLUDED",
    journeys: /rental/,
    text:
      "THE FIRST AUTHORISED AGENT IS FREE, AND KEY COURIER IS NOT SOLD ON EVERY BUNDLE. Two extras, one rule: an " +
      "extra exists only if the RESERVATION prices it, and it is charged only if it is not marked Inclusive.\n" +
      "The first agent is Inclusive — Emirates Post prices the line so you know what a SECOND agent would cost, " +
      "and the first one adds nothing. Its row reads `- Authorised agent (their name): No charge — the first " +
      "agent is included`. Never print the figure beside their name: a customer reads a number next to a service " +
      "as a fee and asks why they are paying it.\n" +
      "AGENTS BEYOND THE FIRST ARE CHARGED, AND THE PRICE IS FOR THE WHOLE TERM. The reservation returns the " +
      "figure ALREADY MULTIPLIED by the years — and the annual rate is not the same on every bundle (personal " +
      "boxes are cheaper per agent than corporate ones), so never state a rate from memory. Quote the figure the " +
      "reservation gives and say what it covers (\"AED 150.00 for the three years\"); never multiply it yourself " +
      "and never quote a per-year rate as though it were the charge. Emirates Post's own page writes \"AED 150 " +
      "per year\" on a three-year box, which is the term total with the wrong label — do not copy that.\n" +
      "KEY COURIER DELIVERY DOES NOT EXIST ON MyHome OR MyHome Instant. Those boxes are delivered to the " +
      "customer's door and the key comes with them, so there is no KEY-DELIVERY line, no AED 30, and no choice to " +
      "offer. Ask about key collection ONLY on a bundle collected at a branch. Offering it on MyHome charged a " +
      "customer for a service Emirates Post does not sell.",
  },
  {
    marker: "A RENTAL IS ONE AMOUNT, NOT A SUM TO WORK OUT",
    journeys: /rental/,
    text:
      "A RENTAL IS ONE AMOUNT, NOT A SUM TO WORK OUT. \"Rental: AED 695.00 x 3 years\" asks the customer to do the " +
      "arithmetic, and the arithmetic is wrong anyway — Emirates Post DISCOUNTS the longer terms, so three years of " +
      "MyHome is 2,085 and ten years is 4,000, not 6,950. Every money row is a single figure for the term they " +
      "chose: `- Box rental (3 years): AED 2,085.00`. Never write a multiplication, never multiply an annual rate " +
      "yourself, and take the figure from the duration list you were given or from the reservation.\n" +
      "SHOW THE SAVING where there is one, on the duration card, as a badge (e.g. `badge: Save AED 2,950`) — " +
      "Emirates Post asked for the multi-year discount to be visible, and it is the whole reason a customer picks " +
      "a longer term.",
  },
  {
    marker: "THE BRANCH COMES BEFORE THE ADDRESS",
    journeys: /rental/,
    text:
      "THE BRANCH COMES BEFORE THE ADDRESS. The order is bundle, emirate, BRANCH, box number, duration, extras, " +
      "and only then any address. MyHome and MyHome Instant are delivered to the customer's home, so their " +
      "delivery address feels like the next thing to ask for the moment they pick one — it is not. The branch " +
      "issues the box, it is what the save sends as the delivery office, and a MyHome save without it is refused " +
      "173 MYHOME_ADDDRESS_NOT_FOUND, which then blames the address.\n" +
      "So do NOT ask for an area, a street, a building or a map pin until a branch is on the case. Ask which " +
      "emirate, show the branches, let them choose, and pick the address up later where it belongs.\n" +
      "AND A PLACE NAME IS NEVER A DEAD END. If the customer types a name — \"7x head office\", \"Sobha Hartland\" " +
      "— search it with nxn_delivery_areas and show the matches as cards. Never tell them you cannot look up a " +
      "place by name, and never ask anyone for a latitude and longitude: nobody knows their own coordinates, and " +
      "the map is an easier alternative to typing, not a requirement.",
  },
  {
    marker: "THE RECEIPT LINK IS ADDED FOR YOU",
    journeys: /rental|renewal/,
    text:
      "THE RECEIPT LINK IS ADDED FOR YOU, at the END of your reply, once the payment is confirmed. So do not write " +
      "one yourself, and do not describe where it is — \"your receipt is available via the download link above\" " +
      "points at nothing, because the link comes after your words. Say the receipt is ready and leave it at that, " +
      "or say nothing about it at all: the link speaks for itself.",
  },
  {
    marker: "WHAT A CORPORATE BOX INCLUDES, AND WHAT IT DOES NOT",
    journeys: /corporate/,
    text:
      "WHAT A CORPORATE BOX INCLUDES, AND WHAT IT DOES NOT. A corporate reservation prices services the personal " +
      "bundles do not, and each is on the response so none of it has to be recalled:\n" +
      "- BAG — a mail bag, marked Inclusive. It costs the customer nothing and is worth saying so when they ask " +
      "what they get: it is a real part of the bundle, not an upsell.\n" +
      "- TIJARI — a Tijari licence link, marked Additional, and CHARGED if it is taken. Do not add it to any total " +
      "unless the customer has actually asked for it, and do not quote its price as part of the box.\n" +
      "- AGENT — the first is Inclusive as it is on a personal box, but the RATE is different. Read it off the " +
      "reservation; never carry a figure across from a personal rental.\n" +
      "- KEY-DELIVERY — a flat charge for the whole term, not per year, unlike the agent lines beside it.\n" +
      "The total to charge is minimumAmount plus the Additional services the customer chose, and nothing else. An " +
      "Inclusive line is never added: it is what that service would cost, shown so the customer can see the value " +
      "of what is already theirs.",
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

interface Journey {
  key: string;
  guidance?: string;
  steps?: { fields?: { key: string; options?: { value: string }[] }[] }[];
}

/**
 * Options that are no longer offered.
 *
 * Key delivery is chosen when a box is RENTED — it is a courier add-on priced on
 * the rental, not something that can be done to a box that already exists. It
 * was sitting in the manage menu, so a customer with a box was offered a service
 * that has nowhere to go.
 */
const DROP_OPTIONS: { journey: string; field: string; values: string[] }[] = [
  { journey: "manage_po_box", field: "management_action", values: ["KEY_DELIVERY"] },
];

/** Sentences to delete outright, wherever they appear. */
const DROP_TEXT: { journeys: RegExp; find: string; replace: string }[] = [
  {
    // The proactive next-step list suggested arranging key delivery for a box
    // the customer already has, which is the very thing being removed above.
    journeys: /manage_po_box/,
    find: "(for example: renew the other box that is due, add an authorised agent, arrange key delivery)",
    replace: "(for example: renew the other box that is due, or add an authorised agent)",
  },
];

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

  // Options first: a menu entry the journey can no longer act on.
  for (const drop of DROP_OPTIONS) {
    const j = def.journeys.find((x) => x.key === drop.journey);
    const field = j?.steps?.flatMap((st) => st.fields ?? []).find((f) => f.key === drop.field);
    if (!field?.options) continue;
    const before = field.options.length;
    field.options = field.options.filter((o) => !drop.values.includes(o.value));
    if (field.options.length !== before) {
      changed++;
      console.log(`  - ${drop.journey}.${drop.field}: dropped ${drop.values.join(", ")}`);
    } else {
      console.log(`  (already) ${drop.journey}.${drop.field}`);
    }
  }

  for (const j of def.journeys) {
    const mine = BLOCKS.filter((b) => b.journeys.test(j.key));
    if (!mine.length && !DROP_TEXT.some((d) => d.journeys.test(j.key))) continue;
    const before = String(j.guidance ?? "");

    // Strip EVERY block first, then append them in a fixed order. Stripping and
    // appending one at a time rotated their order on each run: same content,
    // different sequence, so the script reported a change forever and never
    // settled. Rebuilt as a whole, it converges after one pass.
    let base = before;
    for (const b of BLOCKS) base = strip(base, b.marker, b.text);
    for (const d of DROP_TEXT) if (d.journeys.test(j.key)) base = base.split(d.find).join(d.replace);
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
