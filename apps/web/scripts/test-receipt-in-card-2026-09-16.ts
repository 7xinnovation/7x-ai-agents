/**
 * The receipt, where the confirmation is.
 *
 * Reported 16 September with an arrow drawn from the application panel's
 * "Download receipt" to the APPLICATION CONFIRMED card in the chat. The link was
 * only ever in two places: the panel, permanently, and the chat message on the
 * turn the payment ARRIVES. EPGL settles the card one turn before the
 * confirmation is written — payment lands, the applicant sends one more message,
 * the assistant answers "Payment received — ... APPLICATION CONFIRMED" — so the
 * message a customer reads as the end of the journey was the one message that
 * never carried it.
 *
 * Run from apps/web:  npx tsx scripts/test-receipt-in-card-2026-09-16.ts
 */
import { insertReceiptRow, summaryFeeGuard } from "../lib/summaryFee";
import { shouldOfferReceipt, receiptHref } from "../lib/receiptFacts";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : `\n         ${JSON.stringify(got)}`}`); }
};

const B = "```";
const URL_ = receiptHref("a1f03189-e195-4676-93c8-9faae9df452f", "3b2f6e1c-0000-4000-8000-000000000001");

/** LR-37380's card, as it was reported. */
const CONFIRMED = `${B}summary
title: APPLICATION CONFIRMED — YI FANG TAIWAN FRUIT TEA L.L.C
- Application reference: LR-37380
- Payment: AED 1,000 — paid
- Documents: All submitted
- Postal activity: Letters & Post Items Delivery
${B}`;

/** The card that asks the customer to confirm, BEFORE any money moves. */
const REVIEW = `${B}summary
title: Please confirm your details
- Company name: YI FANG TAIWAN FRUIT TEA L.L.C
- Emirate: Dubai
total: AED 1,000.00
${B}`;

console.log("\nThe card that reports a finished transaction");
{
  const out = insertReceiptRow(CONFIRMED, URL_);
  check("carries the receipt", out.includes(`](${URL_})`), out);
  check("...labelled as a row the card renderer will parse", /\n- Receipt: \[Download receipt\]\(/.test(out), out);
  check("...below everything else", out.indexOf("Postal activity") < out.indexOf("Receipt"));
  check("...and inside the fence", out.trimEnd().endsWith(B) && !out.trimEnd().endsWith(`${B}\n${B}`), out.slice(-80));
  check("nothing else about the card changed", out.includes("- Payment: AED 1,000 — paid") && out.includes("title: APPLICATION CONFIRMED — YI FANG TAIWAN FRUIT TEA L.L.C"));
}

console.log("\nAnd the card that is still asking");
check("a pre-payment review card gets no receipt", insertReceiptRow(REVIEW, URL_) === REVIEW);
check("a card with no rows is left alone", insertReceiptRow(`${B}summary\n${B}`, URL_) === `${B}summary\n${B}`);
check("an unclosed card is left alone", insertReceiptRow(`${B}summary\n- Reference: LR-1`, URL_) === `${B}summary\n- Reference: LR-1`);
check("no url, no row", insertReceiptRow(CONFIRMED, "") === CONFIRMED);

console.log("\nNever twice");
{
  const once = insertReceiptRow(CONFIRMED, URL_);
  check("a second pass adds nothing", insertReceiptRow(once, URL_) === once);
  const written = CONFIRMED.replace("- Documents:", "- Receipt: see attached\n- Documents:");
  check("a card that already names a receipt is left alone", insertReceiptRow(written, URL_) === written);
}

console.log("\nArabic");
{
  const ar = insertReceiptRow(CONFIRMED.replace("- Payment: AED 1,000 — paid", "- الدفع: 1,000 درهم — مدفوع"), URL_, "ar");
  check("the row is Arabic", ar.includes("- الإيصال: [تحميل الإيصال]("), ar);
}

console.log("\nThrough the guard, one character at a time");
{
  const g = summaryFeeGuard(() => null, () => null, () => true, () => ({}), "en", () => URL_);
  let out = "";
  for (const ch of `Payment received — thank you.\n\n${CONFIRMED}\n\nWhat happens next:`) out += g.push(ch);
  out += g.flush();
  check("the card comes out with the receipt in it", out.includes(`- Receipt: [Download receipt](${URL_})`), out);
  check("the prose around it is untouched", out.startsWith("Payment received — thank you.") && out.endsWith("What happens next:"));
}
{
  // No settled payment: nothing to offer, and a card that says "paid" without
  // one is the model's word, not the system's.
  const g = summaryFeeGuard(() => null, () => null, () => true, () => ({}), "en", () => null);
  let out = "";
  for (const ch of CONFIRMED) out += g.push(ch);
  out += g.flush();
  check("no receipt when the caller has none to give", !out.includes("/api/receipt/"));
}

console.log("\nAnd the turn the message carries no card at all");
{
  const PAID = { status: "paid", reference: "pay-1" };
  check(
    "a submission this turn offers the receipt even though the money arrived earlier",
    shouldOfferReceipt(PAID, PAID, "ok", { submittedThisTurn: true })
  );
  check("...and a bare later turn does not", !shouldOfferReceipt(PAID, PAID, "ok", {}));
  check("the turn the payment arrives still offers it", shouldOfferReceipt({ status: "none", reference: null }, PAID, "ok"));
  check("asking for it still offers it", shouldOfferReceipt(PAID, PAID, "can I have the receipt?"));
  check("an unpaid case never offers one", !shouldOfferReceipt(null, { status: "initiated", reference: "p" }, "ok", { submittedThisTurn: true }));

  // LR-37381, 16 September. Submitted at 11:22, the money settled on a poll, and
  // the confirmation was written at 11:24 with no card in it. Every earlier rule
  // had already passed by then: the payment was not new, nothing was submitted
  // THIS turn, and the customer had not asked. So the chat had no receipt at all
  // while the email that went out two minutes later carried one.
  check(
    "the completed transaction offers it, whichever turn confirmed",
    shouldOfferReceipt(PAID, PAID, "ok", { caseComplete: true, alreadyOffered: false })
  );
  check(
    "...and having offered it once, never again",
    !shouldOfferReceipt(PAID, PAID, "ok", { caseComplete: true, alreadyOffered: true })
  );
  check(
    "...but they can still ask for it back",
    shouldOfferReceipt(PAID, PAID, "send me the receipt again", { caseComplete: true, alreadyOffered: true })
  );
  check(
    "a case that never reached the system of record is not complete",
    !shouldOfferReceipt(PAID, PAID, "ok", { caseComplete: false, alreadyOffered: false })
  );
}

console.log("\nWired into the turn");
{
  const route = readFileSync(new URL("../app/api/chat/route.ts", import.meta.url), "utf8");
  check("the guard is given the receipt for a settled payment", /liveState\.payment\.status === "paid" && liveState\.payment\.reference/.test(route));
  check("...built with the shared helper", /receiptHref\(liveState\.payment\.reference, session\.conversationId\)/.test(route));
  check("the trailing link knows the transaction is finished", /caseComplete: Boolean\(submittedRef \|\| finalState\.reference\)/.test(route));
  check("...and that it has been offered before", /alreadyOffered: Boolean\(session\.state\.receiptOfferedAt\)/.test(route));
  check("...and records the offer however it was made", /finalText\.includes\("\/api\/receipt\/"\) && !finalState\.receiptOfferedAt/.test(route));
  check("...and is still skipped when the card already carries one", /!finalText\.includes\("\/api\/receipt\/"\)/.test(route));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
