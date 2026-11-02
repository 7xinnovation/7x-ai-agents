/**
 * The sentence that named a Salesforce field never gets out (2026-11-02).
 *
 * The reply this is built from, as the customer saw it:
 *   "Filing your application with EPGL now — I'll have a reference number and
 *    payment options for you in a moment. The tier value I sent wasn't
 *    accepted. Let me correct that and resubmit now. I can see the issue —
 *    Licensing_Tier_Declared__c isn't a valid field on the Account for this
 *    product. Let me resubmit with the correct fields now. Your application is
 *    filed as LR-54109. The licence fee is AED 1,000."
 *
 * Run from apps/web:  npx tsx scripts/test-internals-guard-2026-11-02.ts
 */
import { internalsGuard, leaksInternals } from "@/lib/internalsGuard";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : `\n       ${JSON.stringify(got)}`}`); }
};

/** Stream text through the guard in small pieces, as the model writes it. */
function streamed(text: string, size = 7): string {
  const g = internalsGuard();
  let out = "";
  for (let i = 0; i < text.length; i += size) out += g.push(text.slice(i, i + size));
  return out + g.flush();
}

const REPLY =
  "Filing your application with EPGL now — I'll have a reference number and payment options for you in a moment. " +
  "The tier value I sent wasn't accepted. Let me correct that and resubmit now. " +
  "I can see the issue — Licensing_Tier_Declared__c isn't a valid field on the Account for this product. " +
  "Let me resubmit with the correct fields now. " +
  "Your application is filed as LR-54109. The licence fee is AED 1,000.";

console.log("\nthe reply that was reported");
const out = streamed(REPLY);
check("the field name is gone", !out.includes("Licensing_Tier_Declared__c"), out);
check("so is the sentence around it", !out.includes("isn't a valid field"), out);
check("the filing line survives", out.includes("Filing your application with EPGL now"), out);
check("the reference survives", out.includes("LR-54109"), out);
check("the fee survives", out.includes("AED 1,000"), out);
check("and the whole thing still reads as sentences", !/\s{3,}/.test(out.trim()), out);

console.log("\nwhat counts as ours");
check("a Salesforce API name", leaksInternals("EPG_Trade_license_no__c is missing."));
check("a relationship name", leaksInternals("Account__r was not found."));
check("an Apex trace", leaksInternals("Class.CompositeHandler.handleRequest: line 86, column 1"));
check("the composite's own vocabulary", leaksInternals("The compositeRequest was empty."));
check("a governor limit", leaksInternals("System.LimitException: Too many SOQL queries: 101"));

console.log("\nwhat is left alone");
check("a licence request number", !leaksInternals("Your application is filed as LR-54109."));
check("a trade licence number", !leaksInternals("Trade licence CN-1234567 expires on 31 December 2027."));
check("a fee", !leaksInternals("The licence fee is AED 40,000."));
check("Arabic prose", !leaksInternals("تم تقديم طلبك بنجاح، والرقم المرجعي هو LR-54109."));
check("an ordinary underscore word", !leaksInternals("Use the upload_box below."));

console.log("\nthe blocks are the UI, not prose");
const withBlock =
  "Please upload the trade licence.\n```upload\nkey: trade_licence\n```\nI can see the issue — Foo_Bar__c isn't valid.\nAnything else?";
const blockOut = streamed(withBlock);
check("the block comes through whole", blockOut.includes("```upload\nkey: trade_licence\n```"), blockOut);
check("the leak after it does not", !blockOut.includes("Foo_Bar__c"), blockOut);
check("and the question after that does", blockOut.includes("Anything else?"), blockOut);

console.log("\nstreaming");
check("a field name split across chunks is still caught", !streamed(REPLY, 3).includes("Licensing_Tier_Declared__c"));
check("one-character chunks too", !streamed(REPLY, 1).includes("Licensing_Tier_Declared__c"));
const g = internalsGuard();
g.push(REPLY); g.flush();
check("and the guard counts what it withheld", g.dropped() >= 1, g.dropped());

console.log("\nnothing is lost when there is nothing to drop");
const clean = "Your application is filed as LR-54109.\n\nThe licence fee is AED 1,000. How would you like to pay?";
check("a clean reply is returned unchanged", streamed(clean) === clean, streamed(clean));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
