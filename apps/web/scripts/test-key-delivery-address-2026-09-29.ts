/**
 * A courier needs an address, and nobody was asking for one (2026-09-29).
 *
 * "When I clicked deliver to my address it used to give me the option to put in
 * the address based on the map, but it's skipped it."
 *
 * It had. The reply went straight to "Emirates Post customer service will
 * contact you to arrange the key delivery" and then to the contact details, and
 * the case came out of that turn with no home_street, no home_area, no address
 * of any kind — for a delivery the customer is paying AED 30 for.
 *
 * The map block WAS being appended by the route, but only when the reply
 * PROMISED a map and the case held no address. This reply promised nothing, so
 * nothing was appended. A promise is the wrong trigger: choosing the courier is
 * the trigger.
 *
 * And the save would have gone through. Emirates Post accepts a rental with a
 * KEY-DELIVERY line and no destination; the customer finds out when the key
 * does not arrive.
 *
 * Run from apps/web:  npx tsx scripts/test-key-delivery-address-2026-09-29.ts
 */
import { readFileSync } from "node:fs";
import { wantsKeyDelivery, choseKeyDelivery } from "../lib/rentalTotal";
import { addressAlreadyKnown } from "../lib/locateGuard";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`); }
};
const route = readFileSync(new URL("../app/api/chat/route.ts", import.meta.url), "utf8");
const integrations = readFileSync(new URL("../lib/integrations.ts", import.meta.url), "utf8");

console.log("\nTheir tap is the trigger, not the model's note of it");
/**
 * The first pass read key_delivery off the CASE — a field the model has to
 * record with collect_field — and on the turn that matters it had not. So the
 * fix inherited the bug it was fixing, and the address was skipped again.
 */
check("the customer's own message decides", /choseKeyDelivery\(body\.userMessage\) \|\|/.test(route));
check("...with the case and the priced summary as extra triggers", /wantsKeyDelivery\(data\.key_delivery \?\? data\.key_delivery_option\) \|\|\s*\n\s*courierSeen;/.test(route));
// The exact label on the button that was pressed, twice, in two different
// wordings.
check('"Deliver to my address (AED 30 courier fee)"', choseKeyDelivery("Deliver to my address (AED 30 courier fee)"));
check('"Deliver to address (AED 30)"', choseKeyDelivery("Deliver to address (AED 30)"));
check('"have it delivered"', choseKeyDelivery("have it delivered"));
check("...and Arabic", choseKeyDelivery("التوصيل إلى العنوان"));
// The OTHER button must never match it.
check('"Collect from branch (free)" does not', !choseKeyDelivery("Collect from branch (free)"));
check('"Collect from Al Barsha Post Office (free)" does not', !choseKeyDelivery("Collect from Al Barsha Post Office (free)"));
check("...nor the Arabic for it", !choseKeyDelivery("الاستلام من الفرع"));
check("...nor an empty message", !choseKeyDelivery("") && !choseKeyDelivery("   "));
check("...and the block is appended, not hoped for", /const ask = locateBlock\(body\.locale\);\s*\n\s*send\(\{ type: "text", delta: ask \}\);/.test(route));
check("...for Emirates Post only", /if \(agent\.definition\.tenantSlug === "nxn"\) \{\s*\n\s*const data = finalState\.data/.test(route));
check("...and it is recorded", /action: "key_delivery_address_asked"/.test(route));

console.log("\nBut never twice");
check("an address already on the case suppresses it",
  /const haveAddress = Boolean\(keyDeliveryAddressFrom\(data\)\) \|\| addressAlreadyKnown\(data\);/.test(route));
check("...and a reply that already carries the block does too", /!\/```\\s\*locate\/i\.test\(finalText\)/.test(route));
// The words the buttons use, so the choice is actually recognised.
check('"deliver" reads as the courier', wantsKeyDelivery("deliver"));
check('...as does "courier"', wantsKeyDelivery("courier"));
check("...and collecting from the branch does not", !wantsKeyDelivery("collect") && !wantsKeyDelivery("branch"));
// The case in the report held none of these.
check("an empty case has no address", !addressAlreadyKnown({}));
check("...and a pinned one does", addressAlreadyKnown({ address_geo: "25.1972,55.2744 — Al Barsha 1" }));

console.log("\nAnd a courier with nowhere to go is not saved");
check("the save is refused", /if \(courierAsked && !body\.keyDeliveryAddress\) \{/.test(integrations));
check("...saying nothing has gone wrong", /NOT SAVED, AND NOTHING HAS GONE WRONG/.test(integrations));
// What it would have cost: a charge for a delivery with no destination, found
// out days later when the key did not arrive.
check("...and why", /Saving it would charge the customer for a delivery with no destination/.test(integrations));
check("...naming the fields to collect", /home_building, home_street, home_area, and home_villa_apt/.test(integrations));
check("...forbidding the panic", /do NOT offer a callback, and do NOT re-reserve the box/.test(integrations));
check("...and offering the way out", /they would rather collect the key from the branch/.test(integrations));
check("it is an error, so the model cannot read past it", /courierAsked && !body\.keyDeliveryAddress[\s\S]{0,1400}isError: true/.test(integrations));
check("it is audited", /action: "rental_save_blocked_no_address"/.test(integrations));
// The two repairs that already existed cover a payload that forgot the line or
// forgot to copy an address we hold. Neither covers having none at all.
check("the existing repairs still run first",
  integrations.indexOf("body.additionalServiceDetailList = [...services, { quantity: 1, serviceType: \"KEY-DELIVERY\" }]") <
    integrations.indexOf("rental_save_blocked_no_address"));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
