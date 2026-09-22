/**
 * Shipment tracking (2026-09-22).
 *
 * The most-asked thing this assistant could not do. `lib/metrics.ts` has said so
 * for weeks — "shipment.lookup is emitted by a tool that does not exist" — and
 * counted the demand instead: 42 of thirty days' intents on production, every
 * one answered with a link to a web page.
 *
 * Emirates Post gave us their EMX gateway today. The two fixtures below are
 * their real answers, captured from staging and production, and they are here
 * because three things in that payload are easy to get wrong and impossible to
 * notice afterwards:
 *
 *   1. THE DATES ARE DAY-FIRST. "28/02/2026" settles it. Read as MM/DD, every
 *      parcel whose day is 12 or under would have been shown a plausible,
 *      wrong date, and nobody would ever have reported it.
 *   2. THE STATUS TEXT CARRIES A NAME. "Delivered - Received  by :  CHELLIA
 *      SAMIRA" — a tracking number is the only thing anyone has to present, so
 *      whoever types one would have been handed the recipient.
 *   3. "NULL" IS A STRING in their location field, and an empty location is an
 *      empty string, not an absent key.
 *
 * Run from apps/web:  npx tsx scripts/test-tracking-2026-09-22.ts
 */
import { normalise, normaliseAwb, parseStamp, withoutNames } from "../lib/emxTracking";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, got?: unknown) {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`); }
}

/** Their staging answer for CP175823258AE, verbatim. */
const STAGING = [{
  trackingNumber: "CP175823258AE",
  trackingReferenceNo: "CP175823258AE",
  sender: { name: "ABDELMAJID OSMAN ABDELMAJID BUSHARA", contactNumber: "" },
  receiver: { name: "", contactNumber: "" },
  lastStatus: { code: "P-53", descriptionAr: "سُلِّمت إلى", descriptionEn: "Delivered " },
  events: [
    { timeStamp: "03/02/2026 08:04:55 AM", status: { code: "P-53", descriptionAr: "سُلِّمت إلى", descriptionEn: "Delivered " }, locationAr: "Al Jumeirah Post Office", locationEn: "Al Jumeirah Post Office", url: "NULL" },
    { timeStamp: "03/02/2026 08:03:54 AM", status: { code: "P-58", descriptionAr: "سُلِّمت عند المنفذ", descriptionEn: "Received at counter" }, locationAr: "Al Falah Post Office", locationEn: "Al Falah Post Office", url: "NULL" },
  ],
  weight: { value: 77, unit: "Grams" },
}];

/** Production, RR020059668AE — the one that proves the date order and the name. */
const PRODUCTION = [{
  trackingNumber: "RR020059668AE",
  lastStatus: { descriptionAr: "سُلِّمت إلى", descriptionEn: "Delivered - Received  by :  CHELLIA SAMIRA" },
  events: [
    { timeStamp: "01/03/2026 12:43:00 PM", status: { descriptionEn: "Delivered - Received  by :  CHELLIA SAMIRA", descriptionAr: "سُلِّمت إلى : CHELLIA SAMIRA" }, locationEn: "", locationAr: "" },
    { timeStamp: "28/02/2026 09:09:00 AM", status: { descriptionEn: "Arrived at", descriptionAr: "وصلت إلى" }, locationEn: "DZ21082", locationAr: "DZ21082" },
    { timeStamp: "16/02/2026 03:37:28 PM", status: { descriptionEn: "Shipped to ANNABA", descriptionAr: "شحنت إلى" }, locationEn: "DUBAI SORTING CENTRE", locationAr: "DUBAI SORTING CENTRE" },
    { timeStamp: "13/02/2026 07:04:43 AM", status: { descriptionEn: "Yet to be received", descriptionAr: "لم تُستلم بعد" }, locationEn: "", locationAr: "" },
  ],
  weight: { value: 0, unit: "Grams" },
}];

console.log("\nThe number the customer types");
check("an S10 number passes", normaliseAwb("CP175823258AE") === "CP175823258AE");
check("spaces and dashes are how people read it back", normaliseAwb(" rr 020-059-668 ae ") === "RR020059668AE");
check("a sentence is not a tracking number", normaliseAwb("where is my parcel") === null);
check("nor is an empty string", normaliseAwb("") === null);
check("nor something too short to be one", normaliseAwb("AB12") === null);
check("nor one carrying a query of its own", normaliseAwb("CP1758&awbNumber=X") === null, normaliseAwb("CP1758&awbNumber=X"));

console.log("\nDay-first, and it is not a preference");
check("28/02 can only be the 28th of February", parseStamp("28/02/2026 09:09:00 AM")?.date === "28-02-2026");
check("...and the ambiguous one is read the same way", parseStamp("03/02/2026 08:04:55 AM")?.date === "03-02-2026");
check("midday is 12:xx, not 00:xx", parseStamp("01/03/2026 12:43:00 PM")?.time === "12:43");
check("midnight is 00:xx", parseStamp("01/03/2026 12:05:00 AM")?.time === "00:05");
check("an afternoon hour is shifted", parseStamp("16/02/2026 03:37:28 PM")?.time === "15:37");
check("a morning hour is not", parseStamp("13/02/2026 07:04:43 AM")?.time === "07:04");
check("nonsense is refused rather than guessed", parseStamp("not a date") === null);
check("...including an impossible month", parseStamp("01/13/2026 10:00:00 AM") === null);

console.log("\nWhose parcel it is stays out of the answer");
check("the name after the colon goes", withoutNames("Delivered - Received  by :  CHELLIA SAMIRA") === "Delivered", withoutNames("Delivered - Received  by :  CHELLIA SAMIRA"));
check("...and without a colon too", withoutNames("Delivered by JOHN SMITH") === "Delivered", withoutNames("Delivered by JOHN SMITH"));
// The rule that would have broken tracking to protect nobody.
check("a PLACE survives — 'delivered to' is a status, not a person", withoutNames("Delivered to Post Office") === "Delivered to Post Office");
check("...as does an ordinary counter scan", withoutNames("Received at counter") === "Received at counter");
check("...and a shipping leg naming a city", withoutNames("Shipped to ANNABA") === "Shipped to ANNABA");
check("the trailing space their gateway leaves is trimmed", withoutNames("Delivered ") === "Delivered");
// The verb survives even when everything after it is cut, so a status is never
// emptied — which matters, because an empty one would fall back to the original
// and restore the name that had just been removed.
check("the verb survives when the name was the rest of it", withoutNames("Received by :") === "Received", withoutNames("Received by :"));
check("...and a status with nothing to cut is untouched", withoutNames("In transit") === "In transit");

console.log("\nThe staging shipment, end to end");
{
  const t = normalise(STAGING, "CP175823258AE")!;
  check("it reads", !!t);
  check("the number comes back", t.trackingNumber === "CP175823258AE");
  check("the current status is the last one", t.statusEn === "Delivered", t.statusEn);
  check("...in Arabic too", t.statusAr === "سُلِّمت إلى", t.statusAr);
  check("both events survive", t.events.length === 2, t.events.length);
  check("newest first, as they send them", t.events[0]!.time === "08:04" && t.events[1]!.time === "08:03");
  check("the location is carried", t.events[0]!.locationEn === "Al Jumeirah Post Office");
  check("the weight is readable", t.weight === "77 Grams", t.weight);
  const json = JSON.stringify(t);
  check("THE SENDER'S NAME IS NOWHERE IN IT", !/BUSHARA/i.test(json));
  check("...and neither is the sender field", !/sender/i.test(json));
  check("...nor the receiver", !/receiver/i.test(json));
}

console.log("\nThe production shipment, end to end");
{
  const t = normalise(PRODUCTION, "RR020059668AE")!;
  check("the current status is stripped of the name", t.statusEn === "Delivered", t.statusEn);
  check("...and so is the Arabic, which carried it after a colon", !/CHELLIA/i.test(t.statusAr), t.statusAr);
  check("every event survives", t.events.length === 4, t.events.length);
  check("the delivery date is the 1st of March", t.events[0]!.date === "01-03-2026");
  check("the one before it is the 28th of February", t.events[1]!.date === "28-02-2026");
  check("an empty location is omitted, not shown blank", t.events[0]!.locationEn === undefined);
  check("a real one is kept", t.events[1]!.locationEn === "DZ21082");
  check("a zero weight is not reported as '0 Grams'", t.weight === undefined, t.weight);
  const json = JSON.stringify(t);
  check("THE RECIPIENT'S NAME IS NOWHERE IN IT", !/CHELLIA|SAMIRA/i.test(json), json.slice(0, 200));
}

console.log("\nAnd the answers that are not shipments");
check("an empty array is 'not found', not a crash", normalise([], "CP175823258AE") === null);
check("null is too", normalise(null, "CP175823258AE") === null);
check("so is a body with nothing in it", normalise([{}], "CP175823258AE") === null);
check("a shipment with no events but a status still reads",
  normalise([{ lastStatus: { descriptionEn: "Yet to be received" } }], "CP1AE")?.statusEn === "Yet to be received");
check("...and falls back to the number we asked about",
  normalise([{ lastStatus: { descriptionEn: "Yet to be received" } }], "CP175823258AE")?.trackingNumber === "CP175823258AE");
check("their literal string NULL is not a location",
  normalise([{ events: [{ timeStamp: "13/02/2026 07:04:43 AM", status: { descriptionEn: "Posted" }, locationEn: "NULL" }] }], "X")?.events[0]!.locationEn === undefined);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
