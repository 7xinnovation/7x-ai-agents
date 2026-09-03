/**
 * Every partner's passport and Emirates ID (2026-09-03), from the client's list:
 * "All partners' passport copies and EID copies must be uploaded by user. Number
 * of partners and details must be pulled from license / initial approval copy."
 *
 * HOW THIS IS EXPRESSED. The document matrix is declarative and each entry can
 * carry a `condition` evaluated against the case data, so a per-partner
 * requirement is N pairs of slots gated on the count:
 *
 *   partner_2_passport   condition: partner_count >= 2
 *   partner_2_emirates_id
 *
 * The slots for partners who do not exist never appear. The engine's condition
 * grammar was string-equality only until today; numeric comparison was added for
 * this, and an UNKNOWN count deliberately reads as false rather than zero -- zero
 * would drop every partner document the moment extraction missed the number, and
 * the application would look complete with nothing uploaded.
 *
 * WHY partner_count IS SEEDED FROM THE LICENCE. The client asked for the number
 * to be pulled from the licence or initial approval, not typed. The guidance
 * makes the model read it and confirm it; the count then decides the slots. A
 * customer who says "three partners" against a licence naming four is asked to
 * resolve it rather than being taken at their word.
 *
 * CAP. Eight partners. Beyond that the slots stop and the guidance tells the
 * model to raise a callback rather than silently accepting an incomplete set --
 * a limit nobody is told about is worse than one they are.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/epgl-partner-documents-2026-09-03.ts [--env <file>] [--dry-run]
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

const SLUG = "epgl-dialog";
const DRY = process.argv.includes("--dry-run");
const JOURNEYS = ["new_license", "renewal"];
const MAX_PARTNERS = 8;
const COUNT_KEY = "partner_count";
const MARKER = "PARTNER DOCUMENTS";

interface DocReq {
  key: string;
  label: { en: string; ar: string };
  description?: { en: string; ar: string };
  requirement: "mandatory" | "conditional" | "optional";
  condition?: string;
  acceptedFormats?: string[];
  maxSizeMb?: number;
}

function partnerDocs(): DocReq[] {
  const out: DocReq[] = [];
  for (let n = 1; n <= MAX_PARTNERS; n++) {
    const cond = `${COUNT_KEY} >= ${n}`;
    out.push({
      key: `partner_${n}_passport`,
      label: { en: `Partner ${n} — passport copy`, ar: `الشريك ${n} — صورة جواز السفر` },
      description: {
        en: "The photo page, showing the name, number and expiry date.",
        ar: "صفحة الصورة، موضحًا الاسم والرقم وتاريخ الانتهاء.",
      },
      requirement: "mandatory",
      condition: cond,
      acceptedFormats: ["pdf", "png", "jpg"],
      maxSizeMb: 10,
    });
    out.push({
      key: `partner_${n}_emirates_id`,
      label: { en: `Partner ${n} — Emirates ID`, ar: `الشريك ${n} — الهوية الإماراتية` },
      description: {
        en: "Both sides, valid and unexpired.",
        ar: "كلا الوجهين، سارية المفعول.",
      },
      requirement: "mandatory",
      condition: cond,
      acceptedFormats: ["pdf", "png", "jpg"],
      maxSizeMb: 10,
    });
  }
  return out;
}

const GUIDANCE =
  `${MARKER} — every partner named on the trade licence needs a PASSPORT COPY and an EMIRATES ID, and the ` +
  `number of partners is READ OFF the trade licence or initial approval, never asked for and never assumed. ` +
  `Once you have the licence, count the partners it names and record it with collect_field(${COUNT_KEY}, <number>); ` +
  `the upload slots for exactly that many partners then appear. Tell the customer how many you found and from which ` +
  `document, and ask them to confirm before you continue — if they say a different number, do not overwrite theirs ` +
  `with yours or yours with theirs: say the licence names N, ask which is right, and if the licence is out of date ` +
  `ask for the initial approval instead. A sole establishment with one owner is a count of 1, which is normal. ` +
  `Never mark the application ready while a partner's passport or Emirates ID is missing, and never accept one ` +
  `document as covering two partners. More than ${MAX_PARTNERS} partners is beyond what this form handles: say so ` +
  `plainly and offer a callback rather than proceeding with an incomplete set.`;

interface Journey { key: string; guidance?: string; steps?: { key: string; documents?: DocReq[] }[]; [k: string]: unknown }

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`${SLUG} not found`);
  const def = row.definition as unknown as { journeys: Journey[] };
  const docs = partnerDocs();
  let changed = 0;

  for (const j of def.journeys) {
    if (!JOURNEYS.includes(j.key)) continue;
    const steps = j.steps ?? [];
    // The step that already asks for documents, so the partner slots sit with the
    // trade licence and MOA rather than in a section of their own.
    const target = steps.find((s) => (s.documents?.length ?? 0) > 0) ?? steps[steps.length - 1];
    if (!target) { console.log(`  (skip) ${j.key}: no steps`); continue; }
    target.documents = target.documents ?? [];
    const existing = new Set(target.documents.map((d) => d.key));
    const added = docs.filter((d) => !existing.has(d.key));
    if (added.length) {
      target.documents.push(...added);
      changed++;
      console.log(`  + ${j.key}/${target.key}: ${added.length} partner document slot(s)`);
    } else {
      console.log(`  (already) ${j.key}: partner slots present`);
    }
    const g = String(j.guidance ?? "");
    if (!g.includes(MARKER)) {
      j.guidance = g ? `${g}\n\n${GUIDANCE}` : GUIDANCE;
      changed++;
      console.log(`  + ${j.key}: partner guidance`);
    }
  }

  const missing = JOURNEYS.filter((k) => !def.journeys.some((j) => j.key === k));
  if (missing.length) throw new Error(`journeys not found on ${SLUG}: ${missing.join(", ")}`);
  if (!changed) { console.log("\nnothing to do."); return; }
  if (DRY) { console.log(`\n--dry-run: ${changed} change(s) not written.`); return; }
  await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
  console.log(`\n${changed} change(s) written.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
