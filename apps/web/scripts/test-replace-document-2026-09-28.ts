/**
 * "Upload a different Emirates ID" has to produce somewhere to upload it
 * (2026-09-28).
 *
 * EPGL. Partner 2's Emirates ID came back carrying the same number as Partner
 * 1's, the assistant flagged it — correctly — and offered two buttons: "The
 * document is correct" and "Upload a different Emirates ID for Partner 2". The
 * customer pressed the second, and the reply was:
 *
 *     Please upload Isam Eldien Garieballa's correct Emirates ID here:
 *     Already uploaded: Partner 2 — Emirates ID — Mr. Isam golden eid.pdf.
 *     Nothing to do here.
 *
 * The guard that wrote that line is right about the case it was built for: a
 * model asking again, unprompted, for a file the customer can see marked
 * Uploaded. It could not tell that from the customer ASKING to send a different
 * one — and there, "nothing to do here" is not just unhelpful, it is false. The
 * wrong Emirates ID stayed on the application because the only way to correct
 * it had been taken off the screen.
 *
 * The upload itself never needed changing: setDocument has always replaced by
 * key. Only the control had to survive.
 *
 * Run from apps/web:  npx tsx scripts/test-replace-document-2026-09-28.ts
 */
import { readFileSync } from "node:fs";
import { asksToReplace, collectedUploadGuard, replaceCollected } from "../lib/uploadGuard";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`); }
};

const BLOCK = "```upload\nkey: partner_2_emirates_id\n```\n";
const collected = (k: string) =>
  k === "partner_2_emirates_id" ? { label: "Partner 2 — Emirates ID", fileName: "Mr. Isam golden eid.pdf" } : null;

const run = (prose: string, replacing: boolean) => {
  const g = collectedUploadGuard(collected, () => null, replacing);
  return g.push(prose) + g.flush();
};

console.log("\nThe button that was pressed");
check('"Upload a different Emirates ID for Partner 2"', asksToReplace("Upload a different Emirates ID for Partner 2"));
for (const said of [
  "upload a different document",
  "Upload another passport copy",
  "I want to upload the correct Emirates ID",
  "can I re-upload the file?",
  "please replace that document",
  "replace it",
  "that's the wrong document",
  "I attached the wrong file",
  "change the document",
  "ارفع مستند آخر",
  "أريد رفع هوية صحيحة",
  "استبدال الملف",
  "إعادة رفع",
]) check(`  "${said}"`, asksToReplace(said), said);

console.log("\nAnd the button beside it, which must never read as one");
// This is the shape that matters most: the other half of the same pair.
for (const said of [
  "The document is correct",
  "the document is correct, continue",
  "yes that's right",
  "correct",
  "المستند صحيح",
  "نعم صحيح",
  "Proceed",
  "here is the trade licence",
  "I uploaded it already",
]) check(`  "${said}" is not a replacement`, !asksToReplace(said), said);
check("nothing said is not a replacement", !asksToReplace("") && !asksToReplace("   "));

console.log("\nWhat the customer now sees");
const prose = "Please upload Isam Eldien Garieballa's correct Emirates ID here:\n\n";
{
  const out = run(prose + BLOCK, true);
  check("the upload control survives", out.includes("```upload"), out);
  check("...with the key it was addressed to", /key: partner_2_emirates_id/.test(out));
  check("...and no 'nothing to do here'", !/Nothing to do here/.test(out), out);
  check("...and the sentence is untouched", out.startsWith(prose));
}
{
  // The original bug is still guarded: an unprompted re-ask is still rewritten.
  const out = run("Let's start with Partner 2's Emirates ID. Please upload it below.\n\n" + BLOCK, false);
  check("an unprompted re-ask is still answered, not re-asked", /Nothing to do here/.test(out), out);
  check("...naming the file already in", /Mr\. Isam golden eid\.pdf/.test(out));
  check("...and offering no control", !out.includes("```upload"), out);
}
check("the rewrite itself is unchanged", /Already uploaded/.test(replaceCollected(BLOCK.trimEnd(), collected)));

console.log("\nThe rest of the guard still applies while replacing");
{
  // A reply that asks something else does not also carry a file picker — the
  // replacement flag is about "already uploaded", not about the other rules.
  const out = run("Is this the right person?\n\n```buttons\n- Yes\n- No\n```\n\n" + BLOCK, true);
  check("a block under a question still goes", !out.includes("```upload"), out);
  check("...and the buttons stay", out.includes("```buttons"));
}
{
  const out = run("No need to upload it right now — come back to it whenever you have it.\n\n" + BLOCK, true);
  check("a deferred document still drops its control", !out.includes("```upload"), out);
}

console.log("\nWired to the customer's own words");
const route = readFileSync(new URL("../app/api/chat/route.ts", import.meta.url), "utf8");
check("the guard is told", /asksToReplace\(body\.userMessage\)/.test(route));
// The model offering to replace something is not the customer accepting, and an
// internal directive is not the customer saying anything at all.
check("...from the message THEY sent, not the reply", !/asksToReplace\(finalText\)/.test(route));
check("...and never on an internal turn", /!isPulse && !isPaymentSettled && !isDocumentUploaded && asksToReplace/.test(route));

console.log("\nAnd the upload really does replace");
const engine = readFileSync(new URL("../../../packages/core/src/case/engine.ts", import.meta.url), "utf8");
check("setDocument replaces by key rather than appending",
  /const documents = \[\.\.\.state\.documents\.filter\(\(d\) => d\.key !== doc\.key\), doc\];/.test(engine));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
