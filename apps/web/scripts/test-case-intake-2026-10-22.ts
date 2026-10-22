/**
 * What kind of case this is, and what we already know to put on it (2026-10-22).
 *
 * Emirates Post's CRM takes a case type picklist their queue routes on, plus an
 * emirate, a PO Box and a tracking number. All four were going across empty
 * with the type hardcoded to "Inquiry", so a complaint about a lost parcel
 * arrived looking exactly like a question about opening hours.
 *
 * The bar here is deliberately asymmetric. Inquiry is the default and silence
 * means Inquiry: calling a question a complaint inflates the number their team
 * is measured on, and calling a complaint a question buries it. An inferred
 * field we are not sure of is left empty, because an empty one costs a question
 * on the callback and a wrong one sends an officer to the wrong parcel.
 *
 * Run from apps/web:  npx tsx scripts/test-case-intake-2026-10-22.ts
 */
import { caseTypeFrom, trackingNumberFrom, poBoxNumberFrom, emirateCodeFrom, caseIntakeFrom } from "@dialog/core";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => { console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : extra ?? ""); ok ? pass++ : fail++; };

// --------------------------------------------------------------- the default
check("silence is an Inquiry", caseTypeFrom(undefined) === "Inquiry");
check("an empty string is an Inquiry", caseTypeFrom("   ") === "Inquiry");
check("a plain question is an Inquiry", caseTypeFrom("What are your opening hours on Friday?") === "Inquiry");
check("a renewal fee question is an Inquiry", caseTypeFrom("I want to check the renewal fee for my PO Box") === "Inquiry");
check("wanting to rent a box is an Inquiry", caseTypeFrom("How do I rent a new PO Box in Dubai?") === "Inquiry");

// -------------------------------------------------------------- complaints
check("the word itself", caseTypeFrom("I want to make a complaint") === "Complaint");
check("a lost parcel", caseTypeFrom("My parcel is lost and nobody can tell me where it is") === "Complaint");
check("a parcel that never arrived", caseTypeFrom("My package never arrived") === "Complaint");
check("still not received", caseTypeFrom("I still have not received my mail from last month") === "Complaint");
check("damaged goods", caseTypeFrom("My package was damaged when it got here") === "Complaint");
check("nobody responded", caseTypeFrom("I emailed twice and no one responded") === "Complaint");
check("unacceptable service", caseTypeFrom("The service at the branch was unacceptable") === "Complaint");
check("disappointed", caseTypeFrom("I am very disappointed with how this was handled") === "Complaint");
check("charged twice", caseTypeFrom("I was charged twice for the same renewal") === "Complaint");
check("Arabic complaint", caseTypeFrom("أريد تقديم شكوى") === "Complaint");

// ------------------------------------------------------------- compliments
check("the word itself", caseTypeFrom("I'd like to pass on a compliment") === "Compliment");
check("praise for the staff", caseTypeFrom("The staff at Bani Yas were excellent") === "Compliment");
check("praise the other way round", caseTypeFrom("Excellent service from your team today") === "Compliment");
check("Arabic thanks", caseTypeFrom("شكرا لكم، خدمة ممتازة") === "Compliment");

// ---------------------------------------------------------------- feedback
check("the word itself", caseTypeFrom("I have some feedback about the app") === "Feedback");
check("a suggestion", caseTypeFrom("A suggestion: let people renew from the app") === "Feedback");
check("'you should'", caseTypeFrom("You should add more pickup points") === "Feedback");
check("'would be better if'", caseTypeFrom("It would be better if the branch opened earlier") === "Feedback");
check("Arabic suggestion", caseTypeFrom("لدي اقتراح لتحسين الخدمة") === "Feedback");

// ------------------------------------------------- what it costs to be wrong
check(
  "a complaint wrapped in praise is still a complaint",
  caseTypeFrom("The staff were lovely but my parcel never arrived") === "Complaint"
);
check(
  "'feedback' about terrible service is a complaint",
  caseTypeFrom("I want to give feedback — the service was terrible") === "Complaint"
);
check("a polite thank-you alone is not a Compliment case", caseTypeFrom("Thanks, that's all I needed") === "Inquiry");
check("'no' on its own is not a complaint", caseTypeFrom("No, that is not my box number") === "Inquiry");

// -------------------------------------------------------- tracking numbers
check("their own format", trackingNumberFrom("My tracking number is EP123456789AE") === "EP123456789AE");
check("lowercase is lifted", trackingNumberFrom("tracking ep123456789ae please") === "EP123456789AE");
check("an Emirates ID is not a tracking number", trackingNumberFrom("my eid is 784-1990-1234567-1") === "");
check("a box number is not a tracking number", trackingNumberFrom("PO Box 50500") === "");
check("a bare long number is not one either", trackingNumberFrom("reference 123456789") === "");

// ------------------------------------------------------------ PO Box number
check("from the journey, which validated it", poBoxNumberFrom("", { po_box_number: "50500" }) === "50500");
check("a numeric field is fine too", poBoxNumberFrom("", { po_box_number: 50500 }) === "50500");
check("the journey beats the sentence", poBoxNumberFrom("box 12345", { po_box_number: "50500" }) === "50500");
check("from the sentence when it says so", poBoxNumberFrom("my PO Box 50500 in Dubai") === "50500");
check("'box 50500'", poBoxNumberFrom("box 50500") === "50500");
check("Arabic", poBoxNumberFrom("صندوق بريد 50500") === "50500");
check("a loose number is NOT a box number", poBoxNumberFrom("I paid 370 for it last year") === "");
check("a year is not a box number", poBoxNumberFrom("I renewed it in 2025") === "");

// ----------------------------------------------------------------- emirate
check("Dubai", emirateCodeFrom("my box is in Dubai") === "DXB");
check("Abu Dhabi", emirateCodeFrom("the Abu Dhabi branch") === "AUH");
check("Al Ain sits under Abu Dhabi", emirateCodeFrom("the branch in Al Ain") === "AUH");
check("Sharjah", emirateCodeFrom("Sharjah please") === "SHJ");
check("Ras Al Khaimah", emirateCodeFrom("Ras Al Khaimah") === "RAK");
check("Arabic Dubai", emirateCodeFrom("صندوقي في دبي") === "DXB");
check("a code already held by the journey", emirateCodeFrom("", { emirate: "DXB" }) === "DXB");
check("a name held by the journey", emirateCodeFrom("", { emirate: "Sharjah" }) === "SHJ");
check("the journey beats the sentence", emirateCodeFrom("posting to Dubai", { emirate: "AUH" }) === "AUH");
check("no emirate mentioned is empty, not a guess", emirateCodeFrom("I need a callback") === "");

// -------------------------------------------------------------- all together
{
  const i = caseIntakeFrom("My parcel EP123456789AE to PO Box 50500 in Dubai never arrived", {});
  check("type", i.caseType === "Complaint", i);
  check("tracking", i.trackingNumber === "EP123456789AE", i);
  check("box", i.poBoxNumber === "50500", i);
  check("emirate", i.emirateCode === "DXB", i);
}
{
  const i = caseIntakeFrom("Can someone call me about my PO Box?", {});
  check("a bare callback request fills nothing it does not know", i.caseType === "Inquiry" && !i.trackingNumber && !i.poBoxNumber && !i.emirateCode, i);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
