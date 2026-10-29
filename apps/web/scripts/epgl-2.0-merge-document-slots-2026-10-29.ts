/**
 * EPGL 2.0: one card per document, where there were two (29 October 2026).
 *
 * Three documents were asked for twice — the MOA, partner 1's passport and
 * partner 1's Emirates ID — because our hand-named slots and the slots
 * generated from EPGL's catalogue are separate rows that nothing reconciled.
 * The applicant uploaded the same PDF under both keys, and the panel still
 * showed an unticked row for a file already on file.
 *
 * Why it could not simply be deleted, and what the merge does instead, is in
 * scripts/lib/epglDocumentPairs. The short of it: the catalogue twin was the
 * only copy that reached Salesforce, so its name and its validity rule move
 * onto the slot the applicant fills before the twin goes.
 *
 * Leaves partners 2–8 and the trade licence alone, both for reasons stated in
 * that module. Idempotent, dry run by default. Run from apps/web:
 *   npx tsx scripts/epgl-2.0-merge-document-slots-2026-10-29.ts --env <file> [--apply]
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
import { mergeDocumentSlots, MERGE_INTO, type Journey } from "./lib/epglDocumentPairs";

const APPLY = process.argv.includes("--apply");
const SLUG = "epgl-dialog";
/** 2.0 only. The renewal journey files through the 1.x submit and has no catalogue slots. */
const JOURNEY = "new_license";

function slotLines(j: Journey): string[] {
  return (j.steps ?? []).flatMap((s) =>
    (s.documents ?? []).map(
      (d) => `  ${s.key}.${d.key}${d.salesforceType ? `  → "${d.salesforceType}"` : ""}${d.validityRequired ? "  [expiry]" : ""}`
    )
  );
}

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) { console.log(`${SLUG} is not on this database`); return; }
  const def = row.definition as { journeys?: Journey[] };
  const journey = (def.journeys ?? []).find((j) => j.key === JOURNEY);
  if (!journey) { console.log(`${SLUG} has no ${JOURNEY} journey here`); return; }

  const before = slotLines(journey);
  const report = mergeDocumentSlots(journey);
  const after = slotLines(journey);

  console.log(`${JOURNEY}: ${before.length} document slots before, ${after.length} after\n`);
  for (const m of report.merged) console.log(`  merged   ${m}`);
  for (const r of report.removed) console.log(`  removed  ${r}`);
  for (const d of report.deduped) console.log(`  deduped  ${d}  (same key in two steps, untyped one dropped)`);
  for (const m of report.missing) console.log(`  ! no slot of ours named ${m} — the catalogue one is left where it is`);

  if (report.missing.length) {
    // A pair whose own slot is absent means the journey is not the one this
    // table was written against. Writing a half-merge would leave one document
    // on the catalogue slot and another on ours, which is the bug again.
    throw new Error(`${report.missing.length} pair(s) have no slot of ours; refusing to write a partial merge`);
  }

  const changed = report.merged.length + report.deduped.length;
  if (!changed) { console.log("\nnothing to do — already merged"); return; }

  // Every type in the table must now sit on exactly one slot. If a merge left
  // two, the push would send the file twice and EPGL would keep the last one.
  for (const type of Object.keys(MERGE_INTO)) {
    const holders = (journey.steps ?? []).flatMap((s) => (s.documents ?? []).filter((d) => d.salesforceType === type));
    if (holders.length !== 1) throw new Error(`"${type}" ends up on ${holders.length} slots, expected exactly 1`);
  }
  // And nothing may share a key any more.
  const keys = (journey.steps ?? []).flatMap((s) => (s.documents ?? []).map((d) => d.key));
  const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
  if (dupes.length) throw new Error(`duplicate slot keys remain: ${[...new Set(dupes)].join(", ")}`);

  console.log(`\nslots now:\n${after.join("\n")}`);
  if (!APPLY) { console.log("\nDry run. Add --apply to write."); return; }
  await db.update(agents).set({ definition: def as Record<string, unknown> as never }).where(eq(agents.id, row.id));
  console.log("\nwritten");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
