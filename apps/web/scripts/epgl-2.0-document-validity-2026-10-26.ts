/**
 * EPGL 2.0: which document slots EPGL refuse without an expiry (26 Oct 2026).
 *
 * `validityRequired` has been in their catalogue all along and the journey
 * generator did not carry it onto the slot, so nothing on our side knew which
 * documents owe a date. It matters for one reason: the CREATE call runs
 * allOrNone=true, so a document item EPGL refuse takes the Account, the owners
 * and the application down with it.
 *
 * That is not a hypothetical. On 26 October an insurance certificate and a
 * lease contract — the two slots in the test pack whose PDFs print no expiry
 * the extractor can read — came back "Valid_To__c is required for this
 * document" and rolled the whole submission back. Sixteen files uploaded,
 * every question answered, and nothing created.
 *
 * Patches the flag onto the existing slots rather than regenerating the step,
 * so nothing else on the journey moves. Matched by salesforceType, which is
 * EPGL's own name for the slot and the only thing that cannot drift.
 *
 * Idempotent. Dry run by default. Run from apps/web:
 *   npx tsx scripts/epgl-2.0-document-validity-2026-10-26.ts --env <file> [--apply]
 */
import { config } from "dotenv";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
const envArg = process.argv.indexOf("--env");
config({
  path:
    envArg !== -1 && process.argv[envArg + 1]
      ? resolve(process.argv[envArg + 1]!)
      : resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env"),
});
import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";

const here = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes("--apply");
const SLUG = "epgl-dialog";

/** documentType -> validityRequired, straight from their catalogue. */
export function validityByType(catalogue: {
  products?: { documents?: { documentType?: string; validityRequired?: boolean }[] }[];
}): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const p of catalogue.products ?? [])
    for (const d of p.documents ?? []) {
      if (!d.documentType) continue;
      out.set(d.documentType, out.get(d.documentType) || Boolean(d.validityRequired));
    }
  return out;
}

async function main() {
  const catalogue = JSON.parse(readFileSync(join(here, "fixtures/epgl-catalogue-2026-10-22.json"), "utf8"));
  const wants = validityByType(catalogue);
  console.log(`catalogue: ${wants.size} document types, ${[...wants.values()].filter(Boolean).length} need an expiry`);
  for (const [t, v] of [...wants].sort()) if (v) console.log(`  ${t}`);

  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) { console.log(`\n${SLUG} is not on this database`); return; }
  const def = row.definition as { journeys?: { steps?: { documents?: Record<string, unknown>[] }[] }[] };

  let touched = 0, unmatched = 0;
  for (const j of def.journeys ?? [])
    for (const st of j.steps ?? [])
      for (const d of st.documents ?? []) {
        const type = d.salesforceType as string | undefined;
        if (!type) continue;                       // our own slot: never sent, never gated
        if (!wants.has(type)) { unmatched++; console.log(`  ! no catalogue entry for ${type}`); continue; }
        const next = wants.get(type)!;
        if (d.validityRequired !== next) { d.validityRequired = next; touched++; }
      }
  console.log(`\nslots updated: ${touched}${unmatched ? `, unmatched: ${unmatched}` : ""}`);
  if (!touched) { console.log("nothing to do"); return; }
  if (!APPLY) { console.log("\nDry run. Add --apply to write."); return; }
  await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
  console.log("written");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
