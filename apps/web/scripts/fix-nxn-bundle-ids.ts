/**
 * Record the bundle the way Emirates Post identifies it (2026-08-14).
 *
 * The `package` field was an enum whose values were invented and match nothing in
 * the API:
 *
 *   personal   MYBOX / MYHOME / MYHOME_INSTANT
 *   corporate  BASIC / PREMIUM / PREMIUM_PLUS
 *
 * What Rental/Bundle actually returns:
 *
 *   request=P   IN -> MyBox 300      MYHOME3 -> MyHome 695      MYHOMEF -> MyHome Instant 995
 *   request=C   LI -> Basic Box 995  BR -> Premium Box 2495     GO -> Premium+ Box 11995
 *
 * So a completed application recorded "Bundle type: MYBOX" for a product whose id
 * is "IN". BoxLocations happens to tolerate the wrong id, which is why nothing
 * looked broken — but Rental/Save takes the bundle id, so the first real rental
 * would either fail or book the wrong product. A field that is wrong in a way
 * nothing complains about is the kind that surfaces at the worst moment.
 *
 * The options are set to the REAL ids with the real English names, so the value
 * stored in the case is the value the backend expects, and the label the customer
 * sees is the one Emirates Post prints. Prices are deliberately NOT baked in here:
 * they come from the live Bundle call, and a price frozen into an enum is the next
 * version of this bug.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/fix-nxn-bundle-ids.ts [--env <file>] [--dry-run]
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
const dryRun = process.argv.includes("--dry-run");
const MARKER = "BUNDLE ID (2026-08-14):";

/** Straight from GET /api/Rental/Bundle on both environments. */
const BUNDLES: Record<string, Array<{ value: string; en: string; ar: string }>> = {
  personal_po_box_rental: [
    { value: "IN", en: "MyBox", ar: "ماي بوكس" },
    { value: "MYHOME3", en: "MyHome", ar: "ماي هوم" },
    { value: "MYHOMEF", en: "MyHome Instant", ar: "ماي هوم إنستانت" },
  ],
  corporate_po_box_rental: [
    { value: "LI", en: "Basic Box", ar: "الصندوق الأساسي" },
    { value: "BR", en: "Premium Box", ar: "الصندوق المميز" },
    { value: "GO", en: "Premium+ Box", ar: "الصندوق المميز بلس" },
  ],
};

const RULE =
  `${MARKER} The value you record for the bundle/package field is the bundle_Id from the Rental/Bundle tool (for example "IN", not "MyBox"), and it is the same value you pass as BundleId to BoxLocations, FreeBoxes, ExpiryDates and the save. ` +
  "Show the customer name_En; store and send bundle_Id. BoxLocations will accept a wrong id without complaining, so a mismatch stays invisible until the booking itself fails or reserves the wrong product.";

interface Field { key: string; options?: Array<{ value: string; label: { en: string; ar?: string } }>; [k: string]: unknown }
interface Journey { key: string; guidance?: string; steps: Array<{ fields: Field[] }>; [k: string]: unknown }

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`${SLUG} not found`);
  const def = row.definition as unknown as { journeys: Journey[] };

  let changed = false;
  for (const j of def.journeys) {
    const want = BUNDLES[j.key];
    if (!want) continue;

    for (const step of j.steps) {
      for (const f of step.fields) {
        if (f.key !== "package") continue;
        const current = (f.options ?? []).map((o) => o.value).join(",");
        const target = want.map((w) => w.value).join(",");
        if (current === target) {
          console.log(`  (skip) ${j.key}: options already [${target}]`);
          continue;
        }
        console.log(`  ${dryRun ? "would set" : "   +    "} ${j.key}: [${current}] -> [${target}]`);
        f.options = want.map((w) => ({ value: w.value, label: { en: w.en, ar: w.ar } }));
        changed = true;
      }
    }

    const g = String(j.guidance ?? "");
    if (!g.includes(MARKER)) {
      j.guidance = `${g.trimEnd()}\n\n${RULE}`;
      changed = true;
      console.log(`  ${dryRun ? "would add" : "   +    "} ${j.key}: bundle-id rule`);
    }
  }

  if (!changed) {
    console.log("nothing to do — already correct");
    return;
  }
  if (dryRun) {
    console.log("\n--dry-run, nothing written");
    return;
  }
  await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
  console.log("\nThe recorded bundle is now the id Emirates Post expects.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
