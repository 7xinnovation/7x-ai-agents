/**
 * QA bugs found while testing the 2026-08-11 renewal round.
 *
 *   B2  The licence lists its activities by NAME ("Transport of Letters"), not as
 *       numeric codes, so nothing landed in a field labelled "Postal activity
 *       code(s)". The label now admits names; the extraction rule in
 *       packages/core/src/ai/extract.ts is the other half.
 *       Region really is absent from that document (the address is "27 D62 -
 *       Dubai", no district), so the guidance stops asserting the trade licence
 *       always carries it — asking is correct, blaming the document is not.
 *
 *   B3  "Done, phone number updated to +44 7700 900123." followed immediately by
 *       "Actually, that number didn't go through." The agent announced the save
 *       before collect_field had returned, and the validation then rejected it.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/fix-epgl-qa-bugs-2026-08-11.ts
 *   prod: DATABASE_URL=<...> npx tsx scripts/fix-epgl-qa-bugs-2026-08-11.ts
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";

const SLUG = "epgl-dialog";
const MARKER = "QA FIXES (2026-08-11b):";

type L = { en: string; ar: string };
const t = (en: string, ar: string): L => ({ en, ar });
const sameLabel = (a: unknown, b: L) => {
  const x = a as L | undefined;
  return !!x && x.en === b.en && x.ar === b.ar;
};

const ACTIVITY_LABEL = t(
  "Postal activity code(s) or licensed activities",
  "رموز النشاط البريدي أو الأنشطة المرخصة"
);

const NO_PREANNOUNCE_RULE =
  "- NEVER ANNOUNCE A SAVE BEFORE IT HAPPENS: do not write \"Done\", \"Saved\", \"Recorded\" or \"updated to X\" for a value " +
  "until you have called collect_field for it AND seen the call succeed. Some values are validated and REJECTED (a " +
  "non-UAE phone number, a malformed Emirates ID), and text you have already sent cannot be taken back — saying " +
  "\"Done, phone number updated to +44 7700 900123\" and then \"actually that didn't go through\" in the same breath " +
  "reads as broken. Call the tool first and let the result decide what you say: on success confirm it plainly, on " +
  "rejection explain the rule and ask again, and never claim both.";

const DOC_GAPS_RULE =
  "- WHAT A LICENCE DOES AND DOES NOT CARRY: read the licensed ACTIVITIES from the licence even when they are printed " +
  "as names rather than numeric codes (\"Transport of Documents, Transport of Letters, Transport of Parcels\") — that " +
  "satisfies the activity field. The REGION / area is NOT on every licence: some print only \"<building> - <emirate>\" " +
  "with no district. When it is genuinely absent, simply ask the customer for the area their office is in — do not " +
  "tell them it is on their trade licence and do not imply they left something out.";

const BLOCK = [MARKER, NO_PREANNOUNCE_RULE, DOC_GAPS_RULE].join("\n");

interface Field { key: string; label?: L; [k: string]: unknown }
interface Step { fields: Field[]; [k: string]: unknown }
interface Journey { key: string; guidance?: string; steps: Step[]; [k: string]: unknown }
interface Definition { journeys: Journey[]; [k: string]: unknown }

function withBlock(guidance: string): string {
  const idx = guidance.indexOf(MARKER);
  if (idx === -1) return `${guidance.trimEnd()}\n\n${BLOCK}`;
  const after = guidance.slice(idx + MARKER.length).split("\n");
  let end = 0;
  for (let i = 1; i < after.length; i++) {
    const line = after[i]!;
    if (line.trim() === "" || line.startsWith("- ")) { end = i; continue; }
    break;
  }
  const base = guidance.slice(0, idx).trimEnd();
  const tail = after.slice(end + 1).join("\n").trim();
  return [`${base}\n\n${BLOCK}`, tail].filter(Boolean).join("\n\n");
}

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`${SLUG} not found`);
  const def = row.definition as unknown as Definition;
  const changes: string[] = [];

  for (const journey of def.journeys) {
    for (const step of journey.steps) {
      for (const f of step.fields) {
        if (f.key === "activity_codes" && !sameLabel(f.label, ACTIVITY_LABEL)) {
          f.label = ACTIVITY_LABEL;
          changes.push(`B2: ${journey.key}.activity_codes label admits activity names`);
        }
      }
    }
    const next = withBlock(journey.guidance ?? "");
    if (next !== journey.guidance) {
      journey.guidance = next;
      changes.push(`B2/B3: guidance rules on "${journey.key}"`);
    }
  }

  if (!changes.length) {
    console.log("No changes — already applied.");
    return;
  }
  await db.update(agents).set({ definition: def as never, updatedAt: new Date() }).where(eq(agents.id, row.id));
  console.log(`Updated ${SLUG} (${changes.length} changes):`);
  for (const c of changes) console.log(`  - ${c}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

export {};
