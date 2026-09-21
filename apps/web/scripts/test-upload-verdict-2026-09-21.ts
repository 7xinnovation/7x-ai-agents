/**
 * "The same rejection error message is displayed twice in a row" (21 September).
 *
 * It was not said twice — it was RENDERED twice. Every ```upload block for a
 * document key read one shared status map, so the card in the message written
 * before the file arrived showed the rejection that happened after it, directly
 * above the message reporting the same thing. Seen on Partner 3's passport
 * (Emirates ID mismatch) and on the MOA (company name mismatch).
 *
 * Run from apps/web:  npx tsx scripts/test-upload-verdict-2026-09-21.ts
 */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : ` — ${JSON.stringify(got)}`}`); }
};
const md = readFileSync(new URL("../app/embed/[agent]/Markdown.tsx", import.meta.url), "utf8");
const exp = readFileSync(new URL("../app/embed/[agent]/Experience.tsx", import.meta.url), "utf8");

console.log("\nThe verdict is scoped to one card");
check("the control knows which message it is in", /messageIndex\?: number;/.test(md));
check("...and which message owns each document", /ownerIndex\?: Record<string, number>;/.test(md));
check("a superseded card reads no status at all", /const st = owns \? ctx\.statuses\[dkey\] : undefined;/.test(md));
check("...so it shows neither the rejection", /st\?\.status === "rejected" && st\?\.rejectionReason/.test(md));
check("...nor a tick that belongs to a later upload", /const uploaded = st\?\.status === "uploaded" \|\| st\?\.status === "accepted";/.test(md));
check("but it keeps its upload button", /ctx\.onUpload\(dkey, e\.target\.files\[0\]\)/.test(md));

console.log("\nOwnership is the LAST message that asked");
check("it is computed from the transcript", /const uploadOwner = useMemo<Record<string, number>>/.test(exp));
check("...over assistant messages only", /if \(m\.role !== "assistant"\) return;/.test(exp));
check("...reading the upload blocks' keys", /```\[ \\t\]\*upload/.test(exp) || /upload\[\\s\\S\]\*\?```/.test(exp));
check("...and the later message wins", /at\[k\[1\]\] = i;/.test(exp));
check("each message renders with its own index", /ownerIndex: uploadOwner, messageIndex: i/.test(exp));

console.log("\nCallers that render a single message are unaffected");
check("both fields are optional", /ownerIndex\?: Record<string, number>;\s*\n\s*messageIndex\?: number;/.test(md));
check("...and absent means 'this card owns it'", /ctx\.ownerIndex === undefined \|\| ctx\.messageIndex === undefined/.test(md));

console.log("\nThe reason is recorded where the code is");
const prose = md.replace(/\n\s*\*\s?/g, " ");
check("what was seen, not just what was changed", /rendered twice/i.test(prose) && /written before the file arrived/.test(prose));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
