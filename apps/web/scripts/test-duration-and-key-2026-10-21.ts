/**
 * Two bugs Emirates Post reported on 21 October.
 *
 * 1. A customer with a box held for ONE year changed to two. The duration card,
 *    the line items and the case all moved; the hold did not. Every figure
 *    downstream is computed from the hold, so the summary read
 *
 *        Annual rental (2 years)   AED 600.00
 *        One-time registration     AED  70.00
 *        Key delivery (courier)    AED  30.00
 *        Total                     AED 400.00
 *
 *    — 400 being 370 for one year plus the courier. The payment card and the
 *    gateway order were opened for the same 400.
 *
 * 2. The customer pressed "Skip to payment" and the order summary came out
 *    reading "Key collection: Branch pickup (free)" without the options ever
 *    having been shown. Free, so nobody was overcharged; still a choice stated
 *    back to somebody who never made it.
 *
 * Run from apps/web:  npx tsx scripts/test-duration-and-key-2026-10-21.ts
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { holdTermMismatch, durationYears, yearsUntil } from "@/lib/integrations";
import { saidKeyPreference } from "@dialog/core";
import { rentalTotal } from "@/lib/rentalTotal";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => { console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : extra ?? ""); ok ? pass++ : fail++; };
const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(resolve(here, "..", p), "utf8");

// The day it was reported, so the offered dates below mean what they meant then.
const NOW = new Date("2026-10-21T12:00:00Z");
const in1y = "2027-10-20";
const in2y = "2028-10-20";

// ------------------------------------------------- 1. the reservation's term
check("a 1-year hold against a 1-year choice is fine", holdTermMismatch(in1y, "1_YEAR", NOW) === null);
check("a 2-year hold against a 2-year choice is fine", holdTermMismatch(in2y, "2_YEAR", NOW) === null);
{
  // EXACTLY WHAT WAS REPORTED.
  const m = holdTermMismatch(in1y, "2_YEAR", NOW);
  check("a 1-year hold against a 2-year choice is caught", m?.held === 1 && m?.chosen === 2, m);
}
check("and the other way round", holdTermMismatch(in2y, "1 year", NOW)?.held === 2);
check("the customer's wording does not matter", holdTermMismatch(in1y, "2 years", NOW) !== null);
check("nor does 24 months", holdTermMismatch(in1y, "24_MONTH", NOW)?.chosen === 2);

// An unknown term is not a mismatch: refusing a rental over an unparseable date
// would be its own bug.
check("no hold date, no mismatch", holdTermMismatch(null, "2_YEAR", NOW) === null);
check("no chosen duration, no mismatch", holdTermMismatch(in1y, null, NOW) === null);
check("an unreadable date is not a mismatch", holdTermMismatch("not a date", "2_YEAR", NOW) === null);
check("an unreadable duration is not a mismatch", holdTermMismatch(in1y, "soonish", NOW) === null);
check("the helpers agree on the term", yearsUntil(in2y, NOW) === 2 && durationYears("2_YEAR") === 2);

// The arithmetic that produced 400, so the number in the report is reproduced
// rather than asserted.
{
  const oneYear = rentalTotal({ base: 370, agentExtraPrice: 50, keyDeliveryPrice: 30 }, { agentCount: 1, keyDelivery: true });
  check("the reported AED 400 is the 1-year hold plus the courier", oneYear.total === 400, oneYear);
  const twoYear = rentalTotal({ base: 670, agentExtraPrice: 50, keyDeliveryPrice: 30 }, { agentCount: 1, keyDelivery: true });
  check("...and AED 700 is what a 2-year hold would have produced", twoYear.total === 700, twoYear);
}

// --------------------------------------------- 2. the key-collection choice
check('"Skip to payment" is not a key preference', !saidKeyPreference("Skip to payment"));
check("...nor is the preferences answer that followed it",
  !saidKeyPreference("Save my card for future payments: Yes. Renew my box automatically next year: Yes. I accept the Terms and Conditions: Yes. Proceed to payment."));
check("...nor silence", !saidKeyPreference("") && !saidKeyPreference(undefined));
check("...nor renting a box", !saidKeyPreference("I want to rent a personal MyBox for one year."));
check("...nor changing the duration", !saidKeyPreference("Mira, can I change the subscription period to two years?"));

check("collecting from the branch counts", saidKeyPreference("I'll collect from the branch"));
check("the branch-pickup chip counts", saidKeyPreference("Branch pickup (free)"));
check("picking it up counts", saidKeyPreference("I'll pick it up myself"));
check("the courier chip counts", saidKeyPreference("Deliver to address (AED 30 courier fee)"));
check("asking for the key to be delivered counts", saidKeyPreference("please deliver the key to me"));
check("having it delivered counts", saidKeyPreference("have it delivered"));
check("Arabic pickup counts", saidKeyPreference("سأستلم من الفرع"));
check("Arabic delivery counts", saidKeyPreference("أريد توصيل المفتاح إلى العنوان"));

// ----------------------------------------------------------- the enforcement
{
  const intg = read("lib/integrations.ts");
  check("a save against a wrong-term hold is refused", /THE RESERVATION IS FOR THE WRONG TERM/.test(intg));
  check("and the refusal says nothing was sent", /NOTHING WAS SENT AND NOTHING IS LOST/.test(intg));
  check("and names Rental\\/Select as the way out", /Call Rental\/Select again for the SAME box/.test(intg));

  const route = read("app/api/chat/route.ts");
  check("a stale hold states no total at all", /if \(staleHold\(\)\) return null;/.test(route));
  // authoritativeAmount feeds the summary card, the prose guard, the pay card
  // and the figure handed to the model: fixing it at source covers all four.
  check("...which is the one source the card, the prose and the pay button share",
    route.split("authoritativeAmount(").length - 1 >= 4, route.split("authoritativeAmount(").length - 1);

  const tools = read("../../packages/core/src/ai/tools.ts");
  check("an unasked key choice is not recorded", /key_delivery\(_option\)\?\$/.test(tools));
  check("and the model is told to ask, with both prices", /collect from the branch \(free\), or have it couriered to an address \(AED 30\)/.test(tools));
  check("re-recording an existing value is still allowed", /const already = String\(state\.data\[fieldKey\] \?\? ""\)\.trim\(\) !== "";/.test(tools));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
