/**
 * The confirmation points at the FAQ (2026-09-07), from Emirates Post.
 *
 * When a PO Box journey finishes there is nothing more the chat can do for the
 * customer, and they may still have questions nobody thought to answer. Their
 * FAQ is where those are answered, so the confirmation says so.
 *
 * The link is appended deterministically on the completing turn either way (see
 * lib/faqLine) — this puts it INSIDE the confirmation card, where it reads as
 * part of the summary rather than as a line after it. Whichever happens first
 * wins; the appender stands down when the reply already carries it.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/nxn-faq-close-2026-09-07.ts [--env <file>] [--dry-run]
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
const MARKER = "CLOSE A FINISHED JOURNEY WITH THE FAQ";

const TEXT =
  `${MARKER}. When the transaction is done — the booking confirmed, the renewal confirmed, the payment settled and ` +
  "the reference given — end the confirmation summary with a row pointing at Emirates Post's FAQ, so someone with a " +
  "question that is not yours to answer knows where to go:\n" +
  "- English: `- Questions: [Emirates Post FAQ](https://www.emiratespost.ae/faq)`\n" +
  "- Arabic: `- الأسئلة: [الأسئلة الشائعة لبريد الإمارات](https://www.emiratespost.ae/ar/faq)`\n\n" +
  "Use the page that matches the language you are speaking — an Arabic conversation gets the /ar/ page. Put it " +
  "ONLY on the final confirmation, never on the summary shown before payment, and never twice: one row, at the end. " +
  "Do not paraphrase the URL, do not link any other page as the FAQ, and do not use it as a way to avoid answering " +
  "something you can answer yourself.";

interface Journey { key: string; guidance?: string }

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`${SLUG} not found`);
  const def = row.definition as unknown as { journeys?: Journey[] };
  let changed = 0;

  for (const j of def.journeys ?? []) {
    // Every journey that ends in a transaction: rentals, renewals, and the
    // management actions that take a payment.
    if (!/rental|renewal|manage/.test(j.key)) continue;
    const without = (j.guidance ?? "")
      .split(/\n{2,}/)
      .filter((p) => !p.includes(MARKER))
      .join("\n\n")
      .trim();
    const next = `${without}\n\n${TEXT}`.trim();
    if (next === j.guidance) { console.log(`  (already) ${j.key}`); continue; }
    j.guidance = next;
    changed++;
    console.log(`  ~ ${j.key} (${next.length} chars)`);
  }

  if (changed && !DRY) await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
  console.log(changed ? (DRY ? `\n--dry-run: ${changed} not written.` : `\n${changed} written.`) : "\nnothing to do.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
