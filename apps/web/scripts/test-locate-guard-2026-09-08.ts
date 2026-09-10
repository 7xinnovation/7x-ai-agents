/**
 * Items 6 and 7 of the 8 September UAT list, which are the same bug.
 *
 * "You can share your address or pin your location on the map." Then, after the
 * customer answered "Pin": "Please go ahead and drop a pin on the map." No map
 * was rendered either time, so they typed an address instead — and reported
 * both "the Pin Location is not working" and "the choosing option is not
 * available".
 *
 * Run from apps/web:  npx tsx scripts/test-locate-guard-2026-09-08.ts
 */
import { promisesMapWithout, locateBlock, arabicLinks } from "../lib/locateGuard";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, got?: unknown) {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`); }
}

console.log("\nThe two replies that were reported");
check(
  "offering the map gets a map",
  promisesMapWithout("Great choice. What area in Abu Dhabi would you like your mail delivered to? You can share your address or pin your location on the map.")
);
check(
  "and so does telling them to drop a pin",
  promisesMapWithout("Please go ahead and drop a pin on the map. Once you share the coordinates, I'll look up the exact delivery area for you.")
);

console.log("\nArabic");
check("عل الخريطة", promisesMapWithout("يمكنك مشاركة عنوانك أو تحديد موقعك على الخريطة."));
check("the Arabic block carries an Arabic label", locateBlock("ar").includes("تحديد موقعي على الخريطة"));
check("the English one does not", locateBlock("en").includes("Pin my location on the map"));

console.log("\nNever twice");
check("a reply that already has a locate block is left alone", !promisesMapWithout("Pin your location on the map.\n\n```locate\nlabel: Pin my location\n```"));
check("...and one that has a branch map is too", !promisesMapWithout("Pick a branch on the map.\n\n```map\nemirate: DXB\nbundle: IN\n```"));

console.log("\nTalking ABOUT a pin is not offering one");
check(
  "the emirate-mismatch reply gets no map",
  !promisesMapWithout("That pin is in Dubai, but your box is in Abu Dhabi. A MyHome box is delivered to the same emirate it is registered in.")
);
check("a shared location is not an offer", !promisesMapWithout("Location shared: 2 61 Street, Al Satwa, Dubai, United Arab Emirates"));
check("...nor is confirming the one they dropped", !promisesMapWithout("Thanks — the pin you dropped is in Al Satwa."));

console.log("\nAnd it stays out of the way otherwise");
check("an ordinary reply", !promisesMapWithout("Your box is reserved. Here is your total: AED 370.00."));
check("a mention of the roadmap is not a map", !promisesMapWithout("That is on our roadmap for next year."));
check("empty", !promisesMapWithout(""));
check("branch cards without any map talk", !promisesMapWithout("Here are the Dubai branches:\n\n```cards\n- title: Al Barsha\n```"));

console.log("\nThe block itself");
check("it is a locate fence", /```locate/.test(locateBlock()));
check("...with a label line", /label: .+/.test(locateBlock()));
check("and it closes", (locateBlock().match(/```/g) ?? []).length === 2);


console.log("\nThe Terms, which is the one link a customer ACCEPTS");
// Emirates Post gave us the real pair on 10 September; everything used to point
// at one generic page. The acceptance is timestamped against the rental, so the
// document it names has to be the one they are renting under.
{
  const en = "Please accept the [Terms and Conditions](https://www.emiratespost.ae/terms-individual) to continue.";
  check("a personal link becomes the Arabic personal page",
    arabicLinks(en, "ar").includes("https://www.emiratespost.ae/ar/terms-individual"), arabicLinks(en, "ar"));
  const corp = "See [Terms](https://www.emiratespost.ae/terms-corporate).";
  check("a corporate link becomes the Arabic corporate page",
    arabicLinks(corp, "ar").includes("https://www.emiratespost.ae/ar/terms-corporate"), arabicLinks(corp, "ar"));
  check("personal is never swapped for corporate",
    !arabicLinks(en, "ar").includes("corporate"), arabicLinks(en, "ar"));
  check("English is left alone", arabicLinks(en, "en") === en);
  check("an already-Arabic link is not doubled",
    arabicLinks("https://www.emiratespost.ae/ar/terms-individual", "ar") === "https://www.emiratespost.ae/ar/terms-individual");
  const both = "personal https://www.emiratespost.ae/terms-individual and corporate https://www.emiratespost.ae/terms-corporate";
  const out = arabicLinks(both, "ar");
  check("both in one reply are each swapped for their own page",
    out.includes("/ar/terms-individual") && out.includes("/ar/terms-corporate"), out);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
