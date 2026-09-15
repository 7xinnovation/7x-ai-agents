/**
 * "Please upload the current MOA here: nothing to do here."
 *
 * Reported 15 September. The stale-MOA check does what it should — it KEEPS the
 * document and asks about it — so the slot still reads "uploaded". The customer
 * pressed "I have the current MOA — I'll upload it", and the reply asked them
 * to upload it and told them there was nothing to upload, in the same message,
 * with no control to do it with.
 *
 * The collected-document rewrite was written for a different moment: the
 * customer uploads from the panel and the agent asks again anyway. It has no
 * business firing on a document we have just questioned.
 *
 * Run from apps/web:  npx tsx scripts/test-questioned-document-2026-09-15.ts
 */
import { collectedUploadGuard, type CollectedDoc } from "../lib/uploadGuard";
import { NAME_CONFLICT_DOC_KEY } from "../lib/docIdentity";

const B = "```";
let failed = 0;
const check = (what: string, ok: boolean, got?: unknown) => {
  console.log(`${ok ? "  ok  " : "FAIL  "}${what}${ok || got === undefined ? "" : `\n        ${JSON.stringify(got)}`}`);
  if (!ok) failed++;
};

/** The chat route's callback, as it now reads. */
function collectedFor(caseData: Record<string, unknown>, uploaded: Record<string, string>) {
  return (key: string): CollectedDoc | null => {
    const fileName = uploaded[key];
    if (!fileName) return null;
    if (caseData[NAME_CONFLICT_DOC_KEY] === key) return null;
    return { label: "Memorandum of Association (MOA)", fileName };
  };
}
function run(caseData: Record<string, unknown>, uploaded: Record<string, string>, reply: string) {
  const g = collectedUploadGuard(collectedFor(caseData, uploaded), () => null);
  let out = "";
  for (const ch of reply) out += g.push(ch);
  return out + g.flush();
}

const REPLY = `Please go ahead and upload the current MOA here:\n\n${B}upload\nkey: moa\n${B}\n`;
const ON_FILE = { moa: "Yi Fang MOA 2020 (old).pdf" };

console.log("\nThe reported message");
{
  const out = run({ [NAME_CONFLICT_DOC_KEY]: "moa" }, ON_FILE, REPLY);
  check("the control renders, so the replacement can be uploaded", /key:\s*moa/.test(out), out);
  check("...and it is NOT declared done", !/Nothing to do here/.test(out), out);
  check("the sentence asking for it survives", /upload the current MOA/.test(out));
}

console.log("\nAnd the behaviour it must not undo");
{
  // FB-1425's original: the file IS in, nothing is in question, and the agent
  // asks anyway. That still gets the "already uploaded" line.
  const out = run({}, ON_FILE, REPLY);
  check("an undisputed document is still reported as already in", /Nothing to do here/.test(out), out);
  check("...naming the file on record", /Yi Fang MOA 2020 \(old\)\.pdf/.test(out));
  check("...and its control does not render again", !/```upload/.test(out), out);
}

console.log("\nThe question is about ONE document");
{
  const data = { [NAME_CONFLICT_DOC_KEY]: "moa" };
  const uploaded = { moa: "old.pdf", trade_license: "licence.pdf" };
  const tl = run(data, uploaded, `Here is the trade licence:\n\n${B}upload\nkey: trade_license\n${B}\n`);
  check("a different document is unaffected", /Nothing to do here/.test(tl), tl);
}

console.log("\nA document never uploaded is unaffected either way");
{
  const out = run({ [NAME_CONFLICT_DOC_KEY]: "moa" }, {}, REPLY);
  check("the control renders", /key:\s*moa/.test(out));
}

console.log(failed ? `\n${failed} failing` : "\nall good");
process.exit(failed ? 1 : 0);
