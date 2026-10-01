/**
 * The trial balance arrives as a CSV (2026-10-01).
 *
 * "Trial balance will be in CSV so can we make it accept that and read it
 * accordingly on the renewal flow."
 *
 * It is exported from an accounting system, not scanned and not printed to
 * PDF, so the slot has to accept the format AND something has to read it. The
 * reading is in packages/core/src/ai/extract.ts: a file that was neither a PDF
 * nor an image used to fall out of the extractor with an empty result, which
 * reads as success everywhere downstream — the file is stored, the slot turns
 * green, and nothing has looked at it. A document accepted unread is worse than
 * one refused, because only the refusal tells the customer to send something
 * else.
 *
 * This script is the other half: the format on the slot itself.
 *
 * Matched by LABEL as well as key, because the slot was added on 30 September
 * from Emirates Post's feedback and its key is not guaranteed to be the same on
 * both environments. Every slot it changes is printed.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/epgl-trial-balance-csv-2026-10-01.ts --env <file> [--dry-run]
 */
import { databaseUrlFrom } from "./lib/envFile";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { agents } from "@dialog/db";
import { eq } from "drizzle-orm";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const ENV = arg("--env");
if (!ENV) throw new Error("--env <envfile> is required");
const DRY = process.argv.includes("--dry-run");
const SLUG = "epgl-dialog";
const FORMAT = "csv";
const MATCH = /trial.?balance|ميزان.?المراجعة/i;

interface Doc { key: string; label?: Record<string, string>; acceptedFormats?: string[] }

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrlFrom(ENV!) });
  const db = drizzle(pool, { schema: { agents } });
  try {
    const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG));
    if (!row) throw new Error(`No agent ${SLUG} in this database`);
    const def = JSON.parse(JSON.stringify(row.definition)) as {
      journeys?: { key: string; steps?: { documents?: Doc[] }[] }[];
    };
    let changes = 0;
    let seen = 0;

    for (const j of def.journeys ?? []) {
      for (const step of j.steps ?? []) {
        for (const d of step.documents ?? []) {
          const text = `${d.key} ${Object.values(d.label ?? {}).join(" ")}`;
          if (!MATCH.test(text)) continue;
          seen++;
          const formats = Array.isArray(d.acceptedFormats) ? d.acceptedFormats : [];
          if (formats.map((f) => f.toLowerCase()).includes(FORMAT)) {
            console.log(`  (already) ${j.key}/${d.key}: ${formats.join(", ")}`);
            continue;
          }
          d.acceptedFormats = [...formats, FORMAT];
          console.log(`  ~ ${j.key}/${d.key}: ${formats.join(", ")} -> ${d.acceptedFormats.join(", ")}`);
          changes++;
        }
      }
    }

    // A slot that cannot be found is not a no-op worth passing over in silence:
    // the whole point of the run is that this document accepts a CSV.
    if (!seen) throw new Error(`No document slot here matches ${MATCH} — nothing was changed`);

    if (!changes) { console.log("\nAlready applied — nothing to change."); return; }
    if (DRY) { console.log(`\n--dry-run: ${changes} change(s) NOT written.`); return; }
    await db.update(agents).set({ definition: def as unknown as typeof row.definition }).where(eq(agents.id, row.id));
    console.log(`\n${changes} change(s) written.`);
  } finally {
    await pool.end();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
