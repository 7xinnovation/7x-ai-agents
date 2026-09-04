/**
 * The rental save's field list, and two notes that contradict it.
 *
 * `apiFlow.notes` has been telling the model, since 27 August, that Rental/Save
 * has FOUR required fields: totalAmount, userProfile, paymentProperties and
 * subscriptionReferenceNumber. That was true of the schema's `required` array
 * and false of the call. A rental with key courier also needs
 * `additionalServiceDetailList` and `keyDeliveryAddress`, and a save that omits
 * them buys a box with no delivery — which is exactly what happened on 4 Sep:
 * the summary charged AED 30 for a courier the payload never requested.
 *
 * Two other paragraphs in the same notes are stale and actively wrong now:
 *
 *   "RECORDING THE RENTAL (internal checkout)" tells it to take the payment on
 *   request_payment first, which the paragraph above it forbids outright for
 *   this journey. It is left over from before the backend gateway.
 *
 *   "NEVER put a Total on that card" was right while the registration fee could
 *   not be known before the hold. It can now — it is read back from Emirates
 *   Post's own NEW-REG line — and that sentence is why a review card said
 *   "Registration fee and exact total: confirmed when box is reserved".
 *
 * Idempotent: each edit is skipped when its result is already in place.
 *
 * Run from apps/web:
 *   npx tsx scripts/nxn-save-fields-2026-09-04.ts [--env <file>] [--dry-run]
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

const FIELDS_OLD =
  "RENTAL/SAVE REQUIRED FIELDS (2026-08-27): The tool schema now lists them; all four are required and the call 400s without any one of them.";
const FIELDS_NEW =
  "RENTAL/SAVE — WHAT THE PAYLOAD MUST CARRY (2026-09-04): the schema's `required` list is four fields, and a rental needs more than four. Send ALL of these:";

/** The whole four-field bullet list, replaced with the real one. */
const OLD_BULLETS =
  "- totalAmount: the number actually charged, matching the payment exactly.\n" +
  "- userProfile: the signed-in customer — customerNameEN, mobileNumber, email, idNumber. Take these from the known customer record or what they gave you; never invent an Emirates ID.\n" +
  "- paymentProperties: at minimum paymentReturnUrl, plus saveCreditCard and isAutomaticSubscriptionEnabled from the consent toggles the customer set.\n" +
  "- subscriptionReferenceNumber: use the payment reference from the settled payment. THIS ONE IS UNCONFIRMED — Emirates Post has not documented where it comes from.";

const NEW_BULLETS =
  "- subscriptionReferenceNumber: the reference from the Rental/Select response, never your own.\n" +
  "- totalAmount: the reservation's minimumAmount PLUS every extra the customer chose. It is set for you from the reservation and the services in this payload, so send your best figure and do not argue with the one that comes back.\n" +
  "- userProfile: customerNameEN, mobileNumber, email, idNumber, language.\n" +
  "- paymentProperties: paymentReturnUrl, saveCreditCard and isAutomaticSubscriptionEnabled from the toggles. savedCard ONLY when the saved-cards tool returned one, and then exactly the five fields it gave you — expiry, scheme, cardToken, maskedPan, cardholderName. Never write a cardToken yourself: the last four digits of a card are not a token, and sending them returns 157.\n" +
  "- boxNumber, emirateCode, newBundleId and expiryDate: the box, the emirate, the bundle and the expiry from the reservation.\n" +
  "- physicalBoxRequired: true for MyBox and every corporate bundle (the box is collected at a branch); false for MyHome and MyHome Instant, which are delivered. Sending false where true belongs returns 154 ERROR_GETTING_PRICING_DETAILS.\n" +
  "- KEY COURIER, when the customer chose it: `additionalServiceDetailList: [{ quantity: 1, serviceType: \"KEY-DELIVERY\" }]` AND `keyDeliveryAddress: { name, mobileNo, emirateCode, deliveryAddress }`. BOTH, every time. A save that omits them buys a box with no delivery while the summary above it charged for one — that is a customer paying for a courier nobody was asked to send. If the customer did not choose courier delivery, omit both.\n" +
  "- listBoxAgentDetail: one entry per authorised agent beyond the first, when they asked for any.\n" +
  "- myHomeProfile: MyHome and MyHome Instant only, as described below.";

const CHECKOUT_OLD_START = "RECORDING THE RENTAL (internal checkout).";
const TOTAL_OLD =
  "BEFORE THE BOX IS HELD you do NOT know the total, so do not state one. Rental/Bundle gives the annual rental and nothing else — the mandatory registration charge is not in it, which is how a review card came to read AED 720 against a real 765. The pre-payment review lists the rental and any chosen extras, then a line saying registration and any mandatory charges are added when the box is reserved and the exact total is shown before paying. NEVER put a Total on that card.";
const TOTAL_NEW =
  "BEFORE THE BOX IS HELD the registration fee IS known — it is given to you with the bundles, read back from Emirates Post's own NEW-REG line — so state it as its own row with its amount, alongside the rental and any chosen extras. What you must NOT do is invent a figure: a row that names the fee without an amount (\"registration fee and exact total: confirmed when box is reserved\") tells the customer nothing and is not an acceptable substitute. Put a Total on that card only when every line on it carries an amount.";

interface Journey { key: string; submission?: { apiFlow?: { notes?: string } } }

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`${SLUG} not found`);
  const def = row.definition as unknown as { journeys: Journey[] };
  let changed = 0;

  for (const j of def.journeys) {
    const notes = j.submission?.apiFlow?.notes;
    if (!notes) continue;
    let next = notes;
    const did: string[] = [];

    if (next.includes(FIELDS_OLD)) { next = next.replace(FIELDS_OLD, FIELDS_NEW); did.push("field-list heading"); }
    if (next.includes(OLD_BULLETS)) { next = next.replace(OLD_BULLETS, NEW_BULLETS); did.push("the fields themselves"); }

    // The stale internal-checkout paragraph, removed whole. Delimited by the
    // blank line that ends it, so nothing after it is touched.
    const i = next.indexOf(CHECKOUT_OLD_START);
    if (i !== -1) {
      const end = next.indexOf("\n\n", i);
      next = (next.slice(0, i) + (end === -1 ? "" : next.slice(end + 2))).replace(/\n{3,}/g, "\n\n");
      did.push("stale internal-checkout paragraph");
    }

    if (next.includes(TOTAL_OLD)) { next = next.replace(TOTAL_OLD, TOTAL_NEW); did.push("the pre-hold total"); }

    if (next === notes) { console.log(`  (already) ${j.key}`); continue; }
    j.submission!.apiFlow!.notes = next;
    changed++;
    console.log(`  ~ ${j.key}: ${did.join("; ")}`);
  }

  if (!changed) { console.log("\nnothing to do."); return; }
  if (DRY) { console.log(`\n--dry-run: ${changed} journey(s) not written.`); return; }
  await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
  console.log(`\n${changed} journey(s) written.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
