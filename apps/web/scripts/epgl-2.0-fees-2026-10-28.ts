/**
 * EPGL 2.0 is not charged like EPGL 1.x (28 October 2026).
 *
 * LR-54087: the card charged AED 1,000, the advice said 1,000, the summary
 * afterwards said 1,000 — and the message beside the card said:
 *
 *   Amount: AED 2,000 (licence fee AED 1,000 + online payment fee AED 1,000)
 *
 * with a button reading "Pay with Card (AED 2,000)". Nothing was overcharged.
 * The applicant was simply told, twice, to expect a figure twice the one they
 * were about to pay, and they pressed a button saying so.
 *
 * The surcharge came off the journey's own guidance. Below the 2.0 block sat
 * the 1.x paragraph, verbatim: "An annual licensing fee of AED 100,000...
 * Paying through the online gateway adds an online payment fee of AED 1,000,
 * so a card payment comes to AED 101,000." Every number in it is wrong for the
 * new regulation — the fee is 500 to 40,000 depending on the product, there is
 * no gateway surcharge, and 101,000 is a worked example of precisely the
 * arithmetic the model performed.
 *
 * It was left there because the 2.0 block opens by saying the older text
 * "applies only to renewals", and a paragraph was added on 27 October telling
 * the model that THE ONLINE PAYMENT FEE NAMED FURTHER DOWN IS NOT THIS
 * LICENCE'S. Neither worked, and the second arguably helped: a warning that
 * names a fee is still a mention of a fee. Renewal has its own copy of the 1.x
 * guidance — guidance is per journey — so nothing needed this one.
 *
 * So it is replaced with the real fee structure, from the catalogue EPGL
 * publish and the price list Emre holds, which agree to the dirham on all ten
 * products. The 27 October paragraph goes too: there is no longer anything
 * further down to point at, and the rule that matters ("quote the pricing
 * call") is already in the block above it.
 *
 * The prices are stated so a wrong number can be RECOGNISED. They are not a
 * substitute for the pricing call, which stays the only thing to quote from.
 *
 * Idempotent. Dry run by default. Run from apps/web:
 *   npx tsx scripts/epgl-2.0-fees-2026-10-28.ts [--env <file>] [--apply]
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const envArg = process.argv.indexOf("--env");
config({ path: envArg !== -1 && process.argv[envArg + 1]
  ? resolve(process.argv[envArg + 1]!)
  : resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });
import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";

const APPLY = process.argv.includes("--apply");
const SLUG = "epgl-dialog";
const JOURNEY = "new_license";

/** The 1.x paragraph, exactly as it sits in the new-licence guidance. */
export const OLD_FEES =
  "FEE STRUCTURE (2026-08-14): EPGL charges TWO separate fees. (1) An annual licensing fee of AED 100,000, paid in advance when the licence is issued and at each renewal — the minimum fee for the licence period. Paying through the online gateway adds an online payment fee of AED 1,000, so a card payment comes to AED 101,000; the Virtual IBAN route is the fee itself, AED 100,000. Say which of the two applies when you present the choice, not afterwards. (2) A levy of 10% on revenue from LEVIABLE services only (never on total revenue), minimum AED 2 per shipment, assessed per quarter from the Form 9. These are separate charges; never present one as a floor, cap or top-up of the other, and never add them into a single \"licence fee\". NEVER calculate, estimate or extrapolate a levy amount yourself — the per-shipment minimum depends on shipment counts you do not have. Quote levy figures only as read from the Form 9 record (calculated levy, due fees for the period, amount paid, payable balance). If a Form 9 has no calculated figure yet, say the amount is confirmed by EPGL in the payment request rather than working it out. The exact payable amount is always the figure in the payment request EPGL issues after the document review.";

/** What replaces it: the new regulation's own prices, and nothing added. */
export const NEW_FEES =
  "FEE STRUCTURE — NEW REGULATION (2026-10-28). THERE IS ONE CHARGE AND NOTHING IS ADDED TO IT. A new-regulation application is charged its product's licence or permit fee and that is the whole amount: no gateway surcharge, no online payment fee, no admin or processing fee, and no VAT — the catalogue marks every one of these fees vatApplicable false. The AED 1,000 online payment fee and the AED 100,000 annual fee belong to the PREVIOUS licensing service and to renewals; neither exists here, and a card total higher than the quoted fee is always wrong. " +
  "The published fees, which the catalogue and EPGL's own price list agree on: CEP30-UAE-SME-DOM AED 1,000; CEP30-UAE-SME-INTL AED 2,000; CEP30-NONUAE-SME-DOM AED 5,000; CEP30-NONUAE-SME-INTL AED 10,000; CEP30-GEN-DOM AED 20,000; CEP30-GEN-INTL AED 40,000; FOODMED AED 500; INTERMED AED 5,000; LOCKERS AED 1,000 (a permit, not a licence); OUTSOURCE no application fee at all, settled instead as 10% of revenue every six months once the permit is held. " +
  "THESE FIGURES ARE FOR RECOGNISING A WRONG ONE, NOT FOR QUOTING. The pricing call is what you quote, always, because it prices THIS application — if what it returns does not match the figure above for the product chosen, say what it returned and raise it; do not correct it yourself and do not quote the list instead. " +
  "NEVER PUT AN AMOUNT IN A PAYMENT BUTTON. The payment-method buttons say \"Pay with Card\", \"Pay with Noqodi (UAE Pay)\", \"Bank transfer (Virtual IBAN)\" and nothing more. The secure card states the amount itself, and a figure typed into a button is a second claim about the price that can disagree with it — on 28 October one read \"Pay with Card (AED 2,000)\" above a card charging 1,000. " +
  "ONE PRODUCT'S FEE IS ABOVE THE ONLINE LIMIT. The catalogue's onlinePaymentThresholdAed is what may be taken online; CEP30-GEN-INTL at AED 40,000 is over it. Read the threshold from the catalogue rather than remembering this, and when a fee exceeds it the payment is arranged by Emirates Post rather than taken in the chat.";

/** The 27 October paragraph, which pointed at the text now removed. */
export const OLD_POINTER =
  "THE ONLINE PAYMENT FEE NAMED FURTHER DOWN IS NOT THIS LICENCE'S. That gateway surcharge belongs to the previous licensing service. A new-regulation application is charged exactly what the pricing call quotes, with nothing added, so never quote a card total higher than the quoted fee.\n\n";

export function rewrite(text: string): string {
  if (!text.includes(OLD_FEES) && text.includes("FEE STRUCTURE — NEW REGULATION")) return text;
  if (!text.includes(OLD_FEES)) throw new Error("the 1.x fee paragraph is not where it was — read the guidance before rerunning");
  return text.replace(OLD_FEES, NEW_FEES).replace(OLD_POINTER, "");
}

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) { console.log(`${SLUG} is not on this database`); return; }
  const def = row.definition as any;
  const j = (def.journeys ?? []).find((x: any) => x.key === JOURNEY);
  if (!j) { console.log(`no ${JOURNEY} journey here`); return; }
  const text = String(j.guidance ?? "");
  const next = rewrite(text);

  console.log(`guidance: ${next === text ? "unchanged" : "rewritten"} (${text.length} -> ${next.length})`);
  console.log(`  ${next.includes("FEE STRUCTURE — NEW REGULATION") ? "ok     " : "MISSING"} the 2.0 fee structure is in`);
  console.log(`  ${/online payment fee of AED 1,000/.test(next) ? "STILL THERE" : "ok     "} the 1.x surcharge is gone`);
  console.log(`  ${/AED 101,000/.test(next) ? "STILL THERE" : "ok     "} the 101,000 worked example is gone`);
  console.log(`  ${next.includes(OLD_POINTER.trim()) ? "STILL THERE" : "ok     "} the paragraph that pointed at it is gone`);
  console.log(`  ${next.includes("NEVER PUT AN AMOUNT IN A PAYMENT BUTTON") ? "ok     " : "MISSING"} the button rule is in`);
  console.log(`  ${next.includes("PARTNER DOCUMENTS") ? "ok     " : "MISSING"} the paragraph after it survived`);
  const r = (def.journeys ?? []).find((x: any) => x.key === "renewal");
  console.log(`  ${/online payment fee of AED 1,000/.test(String(r?.guidance ?? "")) ? "ok     " : "CHECK  "} renewal keeps its own 1.x fee text (it is correct there)`);
  if (!APPLY) { console.log("\nDry run. Add --apply to write."); return; }

  j.guidance = next;
  await db.update(agents).set({ definition: def as Record<string, unknown> as never }).where(eq(agents.id, row.id));
  console.log("\nwritten");
}

if (process.argv[1]?.includes("epgl-2.0-fees-2026-10-28")) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
