/**
 * EPGL's account pulse was Emirates Post's (2026-09-23).
 *
 * Signing in to the licensing assistant produced, underneath the customer's
 * postal licence:
 *
 *   PO Boxes
 *   No PO Boxes are currently showing on your Emirates Post account. If you hold
 *   a box and it's not appearing here, let me know its number and emirate and
 *   I'll look it up directly.
 *
 * with "Rent a new PO Box" offered first. The model was following its
 * instructions exactly: there was one PULSE_DIRECTIVE, written for Emirates
 * Post, and it says to cover EVERY PO Box, to say so when there are none, and
 * to ALWAYS include renting a new one among the closing options.
 *
 * EPGL licenses postal ACTIVITY. A PO Box is a different Emirates Post product,
 * it cannot be bought here, and the applicant did not ask about one.
 *
 * Run from apps/web:  npx tsx scripts/test-epgl-pulse-2026-09-23.ts
 */
import { readFileSync } from "node:fs";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, got?: unknown) {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`); }
}

const route = readFileSync(new URL("../app/api/chat/route.ts", import.meta.url), "utf8");
const epgl = route.slice(route.indexOf("const EPGL_PULSE_DIRECTIVE ="), route.indexOf("// Internal directive fired when the customer completes payment"));
const nxn = route.slice(route.indexOf("const PULSE_DIRECTIVE ="), route.indexOf("const EPGL_PULSE_DIRECTIVE ="));

console.log("\nThere are two pulses now, and the right one is chosen");
check("EPGL has its own", /const EPGL_PULSE_DIRECTIVE =/.test(route));
check("...selected by agent", /agent\.definition\.slug === "epgl-dialog" \? EPGL_PULSE_DIRECTIVE : PULSE_DIRECTIVE/.test(route));
// Everything else keeps exactly what it had. This change is about EPGL being
// wrong, not about the Emirates Post pulse being wrong.
check("Emirates Post's is untouched", /covering EVERY PO Box on their account/.test(nxn));

console.log("\nAnd EPGL's says nothing about PO Boxes");
/**
 * What the MODEL is sent, not what the file says: the comments explain the bug
 * and therefore quote it, and a search that cannot tell the two apart fails on
 * its own explanation.
 */
const sent = epgl.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
// The prohibition itself names them, so only the INSTRUCTIONS are searched.
const instructions = sent.slice(0, sent.indexOf("NEVER MENTION PO BOXES"));
for (const phrase of ["PO Box", "po box", "box number", "emirate and"]) {
  check(`  no "${phrase}" in what it asks for`, !instructions.includes(phrase), phrase);
}
check("...and it forbids them outright", /NEVER MENTION PO BOXES/.test(epgl));
check("...saying why, so it is not an arbitrary rule", /different Emirates Post service/.test(epgl));
check("...including the two ways it went wrong", /do not report that they have none, and never offer to rent one/.test(epgl));

console.log("\nWhat it does ask for");
check("the company and its licence", /the company name, its postal licence number, its trade licence number and expiry date/.test(epgl));
check("...with the signed-in lookup first, which needs no argument", /takes no argument and is the one to call first/.test(epgl));
check("anything needing attention, flagged first", /flagged first/.test(epgl));
check("...including an expiry that is close but not yet due", /inside the next two months/.test(epgl));
check("recent activity in words a person recognises", /written as something a person would recognise/.test(epgl));
check("...with the reference at the end, never the front", /never at the front/.test(epgl));
check("an unlinked sign-in is handled without blocking them", /do not present that as a prerequisite/.test(epgl));
check("it closes on licensing, not on renting", /renew their postal activity licence, apply for a new one/.test(epgl));

console.log("\nThe habits worth keeping from the one it replaces");
check("one line before any tool runs", /before calling any tool, write ONE short line of greeting/.test(epgl));
check("...and the reason: the customer is watching a spinner otherwise", /the only thing they can see while the lookups run/.test(epgl));
check("no name is fetched just to say hello", /never call a tool to find it/.test(epgl));
check("nothing is invented", /never invent a licence, a date, a status or a fee/.test(epgl));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
