/**
 * EPGL 2.0: submit_case is not ours to call on this journey (28 Oct 2026).
 *
 * On 28 October an applicant completed a new-regulation application end to
 * end. Salesforce accepted it as LR-54086, the advice P14234 was raised and
 * paid in full, their own push confirmed `adviceStatus: "Paid"` and moved the
 * application to Under Review. The assistant then told them:
 *
 *   "Your payment of AED 1,000 went through successfully — but I'm not able to
 *    record your submission right now due to a system issue on our end...
 *    Please contact EPGL directly to confirm your application reference."
 *
 * Nothing had gone wrong. Every call in that turn answered 200. What failed
 * was `submit_case`, which this agent's CRM binding routes to the ops mailbox
 * adapter — and that adapter throws when no mailbox is configured, which
 * neither environment has. The model read a genuine tool error and reported it
 * honestly; the error was about a tool that should never have been called.
 *
 * It was called because two instructions disagreed. The journey's rendered
 * flow numbered submit_case as step 5, while the paragraph closing the same
 * prompt said a journey with a saveTool is finished through the integration
 * and must NOT call submit_case. The numbered steps win, as they have every
 * previous time this file has recorded them winning. And THIS block told the
 * model the same wrong thing in so many words — "Do still call submit_case
 * once the payment reads paid — that closes the case on our side and is where
 * their reference comes from" — written on 27 October to undo an earlier
 * version that had told it not to.
 *
 * That sentence was wrong on its own terms. The reference does not come from
 * submit_case on this journey: the orchestrator writes the reference the
 * composite returned onto the case the moment it answers, in the same shape
 * submit_case writes. There was nothing left for it to close.
 *
 * Both halves of the contradiction are fixed in code alongside this script —
 * the rendered step no longer names submit_case, and submit_case itself now
 * refuses a saveTool journey with the real reference instead of throwing. This
 * script fixes the third copy, the one in the agent's own guidance.
 *
 * Idempotent. Dry run by default. Run from apps/web:
 *   npx tsx scripts/epgl-2.0-submit-2026-10-28.ts [--env <file>] [--apply]
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const envArg = process.argv.indexOf("--env");
config({ path: envArg !== -1 && process.argv[envArg + 1]
  ? resolve(process.argv[envArg + 1]!)
  : resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });
import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";
import { GUIDANCE as PREVIOUS, MARKER as PREVIOUS_MARKER, replaceBlock } from "./epgl-2.0-payment-2026-10-27";

const APPLY = process.argv.includes("--apply");
const SLUG = "epgl-dialog";
const JOURNEY = "new_license";
export const MARKER = "EPGL 2.0 — NEW REGULATION (2026-10-28)";
const OLD_MARKERS = [
  PREVIOUS_MARKER,
  "EPGL 2.0 — NEW REGULATION (2026-10-21)",
  "EPGL 2.0 — NEW REGULATION (2026-10-20)",
];

/** The sentence that sent an applicant to ring EPGL about a paid application. */
export const WRONG =
  "Do still call submit_case once the payment reads paid — that closes the case on our side and is where their reference comes from — but it files nothing with Emirates Post and must never be described as if it did.";

/** What replaces it. Same place in the same paragraph, opposite instruction. */
export const RIGHT =
  "Do NOT call submit_case either. On this journey the composite IS the filing and its LR-xxxxx is the reference — there is nothing left for submit_case to close, and calling it files a second request against a payment that already has one. When the payment reads paid, say so, quote the LR-xxxxx the create returned, and stop.";

/** Built from the 27 October block so the two cannot drift apart. */
export function corrected(previous: string, previousMarker: string, marker: string): string {
  if (!previous.includes(WRONG)) throw new Error("the 27 October sentence is not where it was — read the block before rerunning");
  return previous.replace(WRONG, RIGHT).replace(previousMarker, marker);
}

export const GUIDANCE = corrected(PREVIOUS, PREVIOUS_MARKER, MARKER);

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) { console.log(`${SLUG} is not on this database`); return; }
  const def = row.definition as any;
  const j = (def.journeys ?? []).find((x: any) => x.key === JOURNEY);
  if (!j) { console.log(`no ${JOURNEY} journey here`); return; }

  const text = String(j.guidance ?? "");
  const guidance = replaceBlock(text, GUIDANCE, MARKER, OLD_MARKERS);
  console.log(`guidance: ${guidance === text ? "unchanged" : "rewritten"} (text ${text.length} -> ${guidance.length})`);
  console.log(`  ${guidance.includes(RIGHT) ? "ok     " : "MISSING"} the corrected sentence is in`);
  console.log(`  ${guidance.includes(WRONG) ? "STILL THERE" : "ok     "} the wrong sentence is gone`);
  console.log(`  ${guidance.includes("PAYING IS FOUR STEPS") ? "ok     " : "MISSING"} the rest of the payment block survived`);
  console.log(`  ${guidance.includes("CRITICAL COMPOSITE RULE") || guidance.length > 60000 ? "ok     " : "CHECK  "} the 1.x text below it survived`);
  if (!APPLY) { console.log("\nDry run. Add --apply to write."); return; }

  j.guidance = guidance;
  await db.update(agents).set({ definition: def as Record<string, unknown> as never }).where(eq(agents.id, row.id));
  console.log("\nwritten");
}

if (process.argv[1]?.includes("epgl-2.0-submit-2026-10-28")) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
