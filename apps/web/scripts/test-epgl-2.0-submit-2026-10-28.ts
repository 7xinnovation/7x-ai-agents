/**
 * The paid application that was told it had failed (28 October 2026).
 *
 * LR-54086: composite 200, advice P14234 raised, card paid, paymentNotification
 * 200 Success, their push confirming Paid and Under Review — and then
 * "I'm not able to record your submission right now due to a system issue on
 * our end. Please contact EPGL directly."
 *
 * Three copies of one instruction had to agree and did not. These are the
 * checks for all three.
 *
 * Run from apps/web:  npx tsx scripts/test-epgl-2.0-submit-2026-10-28.ts
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { GUIDANCE, MARKER, WRONG, RIGHT, corrected } from "./epgl-2.0-submit-2026-10-28";
import { GUIDANCE as PREVIOUS, MARKER as PREVIOUS_MARKER, replaceBlock } from "./epgl-2.0-payment-2026-10-27";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => { console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : extra ?? ""); ok ? pass++ : fail++; };
const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(resolve(here, p), "utf8");
const prompt = read("../../../packages/core/src/ai/prompt.ts");
const tools = read("../../../packages/core/src/ai/tools.ts");

// ---- 1. the rendered numbered steps -----------------------------------------
const flow = prompt.slice(prompt.indexOf("if (f.submitBeforePayment && f.saveTool)"), prompt.indexOf("Keep the case panel live"));
/** The EPGL branch on its own — the one LR-54086 was driven by — comments
 *  stripped, because what the model reads is the pushed strings. */
const epglBranch = flow
  .slice(0, flow.indexOf("} else {"))
  .split("\n")
  .filter((l) => !l.trim().startsWith("//"))
  .join("\n");
check("the submit-before-pay flow never asks for submit_case", (() => {
  const mentions = epglBranch.match(/[^.`]*submit_case[^.`]*/g) ?? [];
  return mentions.length > 0 && mentions.every((m) => /Do NOT call submit_case|nothing left to file/.test(m));
})(), (epglBranch.match(/[^.`]*submit_case[^.`]*/g) ?? []).join(" | "));
check("...and says so in as many words", /Do NOT call submit_case/.test(flow));
check("...and points at the reference that already exists",
  /quote the reference \$\{f\.saveTool\} returned/.test(flow));
check("the pay-then-save flow only names submit_case when nothing else files it",
  /if \(!f\.saveTool\)\n\s+lines\.push\(`  4\. Once payment is confirmed[^`]*submit_case ONCE to finalise/.test(flow));
check("...and tells a saveTool journey to quote that tool's reference instead",
  /else\n\s+lines\.push\(`  5\. Once payment is confirmed[^`]*Do NOT call submit_case/.test(flow));
check("the trailer that always said this is still there",
  /completed through the integration tools described above — finish it there; do NOT call submit_case/.test(prompt));
check("the reason is written where the next person will look",
  /system issue on our end/.test(flow) && /LR-54086/.test(flow));

// ---- 2. the guard in submit_case ---------------------------------------------
const submit = tools.slice(tools.indexOf('case "submit_case"'), tools.indexOf('default:\n      return { result: `Unknown tool'));
check("submit_case reads the journey's saveTool", /const apiSaveTool = subJourney\?\.submission\?\.apiFlow\?\.saveTool;/.test(submit));
check("...and never reaches the CRM when there is one", submit.indexOf("apiSaveTool") < submit.indexOf("adapters.crm"));
check("an already-filed journey is answered with its real reference",
  /ALREADY FILED[\s\S]{0,200}\$\{state\.reference\}/.test(submit));
check("...and is NOT an error", /ALREADY FILED[\s\S]{0,600}?\n\s+state,\n\s+events,\n\s+\}\n\s+:/.test(submit));
check("...and is never described as a failure", /never describe this as a failure or a system issue/.test(submit));
check("a saveTool journey with no reference yet is sent to the right tool",
  /WRONG TOOL: this journey is filed with \$\{apiSaveTool\}/.test(submit));
check("...and the customer is not told anything failed",
  /do not tell the customer their submission failed/.test(submit));
check("...and no callback is offered for it", /do not offer a callback for this/.test(submit));
check("the ops-mailbox throw is still what it was — this guard is what keeps it unreachable",
  /No ops mailbox configured/.test(read("../lib/registry.ts")));
check("the incident is recorded against the code it explains", /LR-54086/.test(submit) && /P14234/.test(submit));

// ---- 3. the agent's own guidance ---------------------------------------------
check("the wrong sentence is gone from the block", !GUIDANCE.includes(WRONG));
check("...and the 27 October block still has it, unedited", PREVIOUS.includes(WRONG));
check("the correction is in", GUIDANCE.includes(RIGHT));
check("...and names the composite as the filing", /the composite IS the filing/.test(RIGHT));
check("...and the LR-xxxxx as the reference", /LR-xxxxx is the reference/.test(RIGHT));
check("the block is under the new marker", GUIDANCE.startsWith(MARKER));
check("...and the old marker is gone", !GUIDANCE.includes(PREVIOUS_MARKER));
check("everything else in the block is untouched", (() => {
  for (const probe of ["PAYING IS FOUR STEPS", "THE PRICE COMES FROM THEM", "A BIG FILE TAKES TWO CALLS",
                       "THE WEIGHT CEILING IS A REJECTION", "AN OUTSOURCING PERMIT", "THE LICENCE ITSELF"])
    if (!GUIDANCE.includes(probe)) return false;
  return true;
})());
check("the paragraph it lives in survives whole",
  GUIDANCE.includes("NOTHING OF YOURS SUBMITS THE APPLICATION TO EMIRATES POST") &&
  GUIDANCE.includes("it went to Emirates Post when they paid"));
check("only that one sentence changed",
  GUIDANCE.length === PREVIOUS.length - WRONG.length + RIGHT.length - PREVIOUS_MARKER.length + MARKER.length);
check("a block that no longer carries the sentence fails loudly rather than writing nothing", (() => {
  try { corrected("something else entirely", PREVIOUS_MARKER, MARKER); return false; } catch { return true; }
})());

// ---- 4. the replacement, against text shaped like the live guidance ----------
const live = `EPGL 2.0 VALUES (2026-10-22). product codes and object names.\n\n---\n\n${PREVIOUS}\n\n---\n\n1.x renewal text: CRITICAL COMPOSITE RULE and the rest.`;
const after = replaceBlock(live, GUIDANCE, MARKER, [PREVIOUS_MARKER]);
check("the values block in front of it survives", after.startsWith("EPGL 2.0 VALUES (2026-10-22)"));
check("the 1.x renewal text behind it survives", after.endsWith("1.x renewal text: CRITICAL COMPOSITE RULE and the rest."));
check("the old block is gone from the live text", !after.includes(WRONG));
check("the new block is in it", after.includes(RIGHT) && after.includes(MARKER));
check("running it twice changes nothing", replaceBlock(after, GUIDANCE, MARKER, [PREVIOUS_MARKER]) === after);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
