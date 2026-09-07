/**
 * UAT findings, 7 September — the ones that are the agent's manner, not its code.
 *
 * 11. Two messages for one action: "Let me fetch the Abu Dhabi branches for
 *     MyBox." immediately followed by "Here are the Abu Dhabi branches for
 *     MyBox:". The first says nothing the second does not.
 * 13. A payment page that has been opened once cannot be opened again — the
 *     link carries a single-use session, and reopening it shows the customer
 *     "the payment link is not exist". Recovering means a NEW order.
 * 14. Internal keys read out loud: "'Company employee' maps to key 19150."
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/nxn-uat-2026-09-07.ts [--env <file>] [--dry-run]
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
const DRY = process.argv.includes("--dry-run");

const BLOCKS: { marker: string; journeys: RegExp; text: string }[] = [
  {
    marker: "SAY IT ONCE",
    journeys: /rental|renewal|manage/,
    text:
      "SAY IT ONCE. Do not announce what you are about to do and then do it in the same breath: \"Let me fetch the " +
      "Abu Dhabi branches for MyBox.\" followed by \"Here are the Abu Dhabi branches for MyBox:\" is one message " +
      "wearing two hats, and the customer reads the same sentence twice. Fetch what you need and lead with the " +
      "ANSWER.\n\n" +
      "A short line before a call is worth writing only when the customer would otherwise be looking at nothing for " +
      "several seconds — a reservation, a save, a payment check. Even then it is one line, and it does not reappear " +
      "under the result.",
  },
  {
    marker: "A PAYMENT PAGE OPENS ONCE",
    journeys: /rental|renewal/,
    text:
      "A PAYMENT PAGE OPENS ONCE. The link Emirates Post returns carries a single-use checkout session: once the " +
      "customer has opened it, closing it without paying spends it, and opening the same link again shows them " +
      "\"Sorry, the payment link is not exist\" on the gateway's own error page. That is not a fault they can fix by " +
      "trying harder.\n\n" +
      "So if a customer tells you the payment page did not open, was closed, expired, or showed an error, do NOT " +
      "hand them the same link again and do NOT tell them to refresh it. FIRST check whether the payment actually " +
      "landed — an abandoned page and a completed payment look identical from the chat. If it did, confirm the " +
      "booking as normal. If it did not, create a NEW order with the save tool, priced exactly as before, and give " +
      "them the new link. Say plainly that you have set up a fresh payment page; do not explain sessions or links " +
      "to them.",
  },
  {
    marker: "NEVER READ OUT AN INTERNAL KEY",
    journeys: /rental|renewal|manage/,
    text:
      "NEVER READ OUT AN INTERNAL KEY. Emirates Post identifies some answers by number — who is renewing a box, " +
      "an office id, a bundle id, an entity code. Those numbers are how the two systems talk to each other and they " +
      "mean nothing to the customer. Never write a sentence like \"'Company employee' maps to key 19150.\", never " +
      "narrate a lookup, a retry or a correction you are making to a payload, and never record a bare number as the " +
      "customer's answer to a question asked in words — the answer is the words they chose.",
  },
];

interface Journey { key: string; guidance?: string }

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`${SLUG} not found`);
  const def = row.definition as unknown as { journeys?: Journey[] };
  let changed = 0;

  for (const j of def.journeys ?? []) {
    let guidance = j.guidance ?? "";
    for (const b of BLOCKS) {
      if (!b.journeys.test(j.key)) continue;
      const without = guidance.split(/\n{2,}/).filter((p) => !p.includes(b.marker)).join("\n\n").trim();
      guidance = `${without}\n\n${b.text}`.trim();
    }
    if (guidance === (j.guidance ?? "")) { console.log(`  (already) ${j.key}`); continue; }
    j.guidance = guidance;
    changed++;
    console.log(`  ~ ${j.key} (${guidance.length} chars)`);
  }

  if (changed && !DRY) await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
  console.log(changed ? (DRY ? `\n--dry-run: ${changed} not written.` : `\n${changed} written.`) : "\nnothing to do.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
