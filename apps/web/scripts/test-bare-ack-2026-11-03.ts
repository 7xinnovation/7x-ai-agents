/**
 * "No problem." gets a sentence (2026-11-03).
 *
 * Reported twice: the customer says the company on the application is the wrong
 * one, and the whole reply is two words and a file picker.
 *
 * Run from apps/web:  npx tsx scripts/test-bare-ack-2026-11-03.ts
 */
import { bareAckGuard, isBareAcknowledgement, askFor } from "@/lib/bareAckGuard";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : `\n       ${JSON.stringify(got)}`}`); }
};

const LABELS: Record<string, string> = {
  trade_license: "Trade License / Initial Approval",
  moa: "Memorandum of Association (MOA)",
};
const run = (text: string, size = 5, locale: "en" | "ar" = "en") => {
  const g = bareAckGuard((k) => LABELS[k], locale);
  let out = "";
  for (let i = 0; i < text.length; i += size) out += g.push(text.slice(i, i + size));
  out += g.flush();
  return { out, repaired: g.repaired() };
};

const REPORTED = "No problem.\n\n```upload\nkey: trade_license\n```\n";

console.log("\nthe message that was reported");
const r = run(REPORTED);
check("a sentence is put in", r.repaired, r);
check("and it names the document", r.out.includes("Please upload the Trade License / Initial Approval."), r.out);
check("before the control, not after", r.out.indexOf("Please upload") < r.out.indexOf("```upload"), r.out);
check("the acknowledgement is kept", r.out.startsWith("No problem."), r.out);
check("and the block is untouched", r.out.includes("```upload\nkey: trade_license\n```"), r.out);

console.log("\nwhat it leaves alone");
const full = "Thanks — that company is on file. Now I need the trade licence for the one you are applying for.\n\n```upload\nkey: trade_license\n```\n";
const rf = run(full);
check("a reply that already says something", !rf.repaired && rf.out === full, rf.out);
const noBlock = run("No problem.");
check("an acknowledgement with no upload after it", !noBlock.repaired && noBlock.out === "No problem.", noBlock.out);
const other = run("Of course.\n\n```cards\ntitle: x\n```\n");
check("a card block is not an upload", !other.repaired, other.out);
const unknown = run("No problem.\n\n```upload\nkey: something_new\n```\n");
check("a document we cannot name adds nothing", !unknown.repaired, unknown.out);

console.log("\nthe acknowledgements themselves");
for (const s of ["No problem.", "Of course!", "Got it", "Sure thing.", "Okay.", "لا مشكلة", "بالتأكيد."])
  check(`"${s}" is bare`, isBareAcknowledgement(s));
for (const s of ["No problem — I need the trade licence for the new company.", "Got it. Which emirate is it registered in?", "Sure, the fee is AED 1,000."])
  check(`"${s.slice(0, 32)}…" is not`, !isBareAcknowledgement(s));

console.log("\nArabic");
const ar = run("لا مشكلة.\n\n```upload\nkey: trade_license\n```\n", 5, "ar");
check("the sentence is Arabic", ar.out.includes(askFor(LABELS.trade_license!, "ar")), ar.out);

console.log("\nstreaming");
check("one character at a time", run(REPORTED, 1).repaired);
check("the whole thing in one push", run(REPORTED, 1000).repaired);
check("the fence split across chunks", run("No problem.\n\n``" + "`upload\nkey: moa\n```", 3).out.includes("Memorandum of Association"));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
