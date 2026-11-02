/**
 * The rule written after the packs were filed says what the log found.
 * Run from apps/web:  npx tsx scripts/test-epgl-20-submission-defects-2026-11-02.ts
 */
import { MARKER, RULE, OLD_SLOT, NEW_SLOT } from "./epgl-20-submission-defects-2026-11-02";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}`); }
};
const has = (...bits: string[]) => bits.every((b) => RULE.includes(b));

console.log("\nthe slot the trade licence is asked for under");
check("the 1.x key is no longer named as the one to use", !NEW_SLOT.includes("key: trade_license"));
check("the catalogue's keys are", NEW_SLOT.includes("trade_licence") && NEW_SLOT.includes("trade_licence_initial_name_approval"));
check("and the legacy slot is named as the thing to avoid", NEW_SLOT.includes("legacy trade_license slot"));
check("the old sentence is gone from the new one", !NEW_SLOT.includes(OLD_SLOT));

console.log("\nthe document type");
check("copied from the catalogue, not written", has("A DOCUMENT TYPE IS COPIED, NEVER WRITTEN"));
check("not from the label or the file name", has("not the name of the file"));
check("the exact spelling that cost every run a retry", has('"Trade License"', '"Trade Licence"'));

console.log("\nthe documents that went missing");
check("the catalogue list is checked before the create", has("EVERY REQUIRED DOCUMENT, BEFORE THE CREATE"));
check("both of the missing ones are named", has("Memorandum of Association", "Site Locations and Contracts"));
check("and submitting around a missing one is refused", has("do not submit around it"));

console.log("\nthe empty composite");
check("named exactly as it went", has("compositeRequest: []"));
check("no items, no call", has("no items means no call"));

console.log("\nretrying, and not retrying");
check("a refusal we can fix is fixed once, silently", has("A REFUSAL YOU CAN FIX IS FIXED SILENTLY, AND ONLY ONCE"));
check("the sentence the customer should never have read is quoted", has("needs correcting"));
check("and it does not reopen the locked case", has("THIS IS NOT A LICENCE TO RETRY"));

console.log("\nthe card and the reference");
check("they travel together", has("THE REFERENCE TRAVELS WITH THE CARD"));
check("LR-54104 is named", has("LR-54104"));
check("no reference, no card", has("do not open a card"));

console.log("\nthe rule itself");
check("carries its marker", RULE.includes(MARKER));
check("no fenced block leaks out of it", !/\n```/.test(RULE));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
