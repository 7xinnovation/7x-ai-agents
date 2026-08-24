/**
 * Stop re-asking what the customer already told us (2026-08-24).
 *
 * Reported from staging. The customer opened with everything:
 *
 *   "i want to renew my pobox number 34146 in dubai, use the same payment method
 *    and same renewal branch and period as current one"
 *
 * and got three yes/no gates in a row before anything happened:
 *   1. "Just to confirm: you'd like to renew PO Box 34146 in Dubai, correct?"
 *   2. "Are you renewing PO Box 34146 for yourself, or on behalf of a company?"
 *   3. "This box is registered as Corporate... Are you sure this is your personal
 *      PO Box?" plus "registered to C***** — is that you?"
 *
 * (1) echoes their own sentence back at them. (2) asks them to classify a record
 * the very next tool call describes — and it came back "Corporate", so the answer
 * was already sitting in the response. (3) is the one legitimate check in the set,
 * and by then it is the third interruption instead of the first.
 *
 * The journey guidance is part of the cause: "Stage 1 Retrieve & Confirm: ...
 * confirm which box to renew" reads as a mandatory gate even when the customer
 * named the box in their opening line. Reworded so confirmation means showing what
 * came back and continuing, with a question reserved for a genuine conflict.
 *
 * The general rules live in the platform prompt (packages/core/src/ai/prompt.ts);
 * this is the journey-specific half.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/fix-nxn-front-loaded-requests-2026-08-24.ts [--env <file>]
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const envArg = process.argv.indexOf("--env");
config({
  path:
    envArg !== -1 && process.argv[envArg + 1]
      ? resolve(process.argv[envArg + 1]!)
      : resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env"),
});

import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";

const SLUG = "nxn-dialog";
const MARKER = "WHAT THE CUSTOMER ALREADY TOLD YOU (2026-08-24):";

/** The Stage 1 phrasing that reads as a mandatory yes/no gate. */
const OLD_STAGE1 = "confirm which box to renew.";
const NEW_STAGE1 =
  "if the customer already named the box, do NOT ask them to confirm it — show what came back and carry on; " +
  "ask which box to renew only when they have not said, or when the retrieved record contradicts what they told you.";

const RULE = [
  `${MARKER} Read the customer's opening message as answers, not as a topic.`,
  "- A box number, emirate, duration, branch or payment preference they have already stated is COLLECTED. Do not echo it back for approval and do not ask for it again.",
  '- "Same as last time" (branch, duration, bundle, payment method) is an instruction you can carry out: take those values from the retrieved record and skip those questions entirely. If the record does not carry one of them, ask for that ONE thing and nothing else.',
  "- Never ask whether the box is personal or corporate. The Details response says which it is — call it first and read it.",
  "- If the retrieved record contradicts what the customer said (they called it their personal box and it is registered Corporate, or it is registered to someone else), that IS worth raising — but raise every such point ONCE, together, in a single message, and offer the way forward in the same breath. Never spread them across consecutive turns as separate yes/no questions.",
].join("\n");

interface Journey {
  key: string;
  guidance?: string;
  [k: string]: unknown;
}

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`${SLUG} not found`);
  const def = row.definition as unknown as { journeys: Journey[] };

  let changed = 0;
  for (const j of def.journeys) {
    if (!j.key.includes("renewal")) continue;
    let g = String(j.guidance ?? "");
    const before = g;

    if (g.includes(OLD_STAGE1)) g = g.split(OLD_STAGE1).join(NEW_STAGE1);
    if (!g.includes(MARKER)) g = `${g.trimEnd()}\n\n${RULE}`;

    if (g === before) {
      console.log(`  (skip) ${j.key}`);
      continue;
    }
    j.guidance = g;
    changed++;
    console.log(`  + ${j.key}`);
  }

  if (!changed) {
    console.log("nothing to do");
    return;
  }
  await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
  console.log(`\n${changed} journey(s) updated.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
