/**
 * The FAQ closes a finished journey (2026-09-07).
 *
 * Emirates Post asked for their FAQ at the end of a completed PO Box journey.
 * The rule that matters is WHEN: "the case has a reference" stays true for every
 * reply afterwards, and that is exactly how "Download your receipt" ended up
 * under an answer about issuing authorities.
 *
 * Run from apps/web:
 *   npx tsx scripts/test-faq-close-2026-09-07.ts
 */
import { faqLine, faqUrl, mentionsFaq, journeyJustCompleted } from "@/lib/faqLine";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => {
  console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : extra ?? "");
  ok ? pass++ : fail++;
};

// ── the link itself ─────────────────────────────────────────────────────────
check("English goes to the English FAQ", faqUrl("en") === "https://www.emiratespost.ae/faq");
check("Arabic goes to the ARABIC FAQ", faqUrl("ar") === "https://www.emiratespost.ae/ar/faq");
check("an unknown locale falls back to English", faqUrl(undefined) === "https://www.emiratespost.ae/faq");
check("the line is a markdown link", /^\n\n\[.+\]\(https:\/\/www\.emiratespost\.ae\/faq\)$/.test(faqLine("en")), faqLine("en"));
check("the Arabic line is Arabic", /الأسئلة الشائعة/.test(faqLine("ar")), faqLine("ar"));
check("...and points at the Arabic page", faqLine("ar").includes("/ar/faq"));

// ── not twice ───────────────────────────────────────────────────────────────
check("a reply that already links the FAQ is recognised", mentionsFaq(`Done.${faqLine("en")}`));
check("...in Arabic too", mentionsFaq(`تم.${faqLine("ar")}`));
check(
  "the ENGLISH page in an Arabic reply still counts as linked",
  mentionsFaq("انظر https://www.emiratespost.ae/faq للمزيد")
);
check("a reply with no FAQ is not", !mentionsFaq("Your booking is confirmed. Order 260972889."));
check("another site's faq page does not count", !mentionsFaq("https://example.com/faq"));

// ── when it appears ─────────────────────────────────────────────────────────
const PAID = { status: "paid", reference: "pay-1" };
const NONE = { status: "none", reference: null };
check(
  "a submission this turn finishes the journey",
  journeyJustCompleted({ submittedThisTurn: true, paymentBefore: PAID, paymentAfter: PAID })
);
check(
  "so does a payment settling this turn",
  journeyJustCompleted({ submittedThisTurn: false, paymentBefore: NONE, paymentAfter: PAID })
);
check(
  "the NEXT reply does not close the journey again",
  !journeyJustCompleted({ submittedThisTurn: false, paymentBefore: PAID, paymentAfter: PAID })
);
check(
  "nor does one three replies later",
  !journeyJustCompleted({ submittedThisTurn: false, paymentBefore: PAID, paymentAfter: PAID })
);
check(
  "a second transaction closes on its own",
  journeyJustCompleted({ submittedThisTurn: false, paymentBefore: PAID, paymentAfter: { status: "paid", reference: "pay-2" } })
);
check(
  "an unfinished journey closes nothing",
  !journeyJustCompleted({ submittedThisTurn: false, paymentBefore: NONE, paymentAfter: NONE })
);
check(
  "a payment marked paid with no reference is not a completion",
  !journeyJustCompleted({ submittedThisTurn: false, paymentBefore: NONE, paymentAfter: { status: "paid", reference: null } })
);
check(
  "a failed payment is not a completion",
  !journeyJustCompleted({ submittedThisTurn: false, paymentBefore: NONE, paymentAfter: { status: "failed", reference: "pay-3" } })
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
