/**
 * Show AED 30 for key courier (2026-09-01).
 *
 * The card had been showing AED 25, which was wrong, so it was reduced to "fee
 * applies, shown before payment" — honest, but a customer choosing between two
 * options should see the number. 30 is the real figure, confirmed live from
 * GetChargesForAdditionalServices (AdditionalServiceType=3) for both MyBox and
 * MyHome on 31 Aug 2026.
 *
 * It is a DISPLAY figure only. The amount charged still comes from priceDetails
 * on the Rental/Select response, and it is not declared as a journey surcharge —
 * that is what used to add itself to the total a second time. MyHome does not
 * offer key courier at all (the key comes with the box), so the option does not
 * appear there.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/nxn-key-delivery-fee-2026-09-01.ts [--env <file>]
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
const JOURNEYS = ["personal_po_box_rental", "corporate_po_box_rental"];
const MARKER = "THE KEY COURIER FEE (2026-09-01)";

const EN = "Deliver to address (AED 30 courier fee)";
const AR = "التوصيل إلى عنوان (رسوم بريد سريع 30 درهم)";

const NOTE = `

${MARKER}: the key courier fee is AED 30. Show that figure on the delivery option and in the review, so the customer is choosing with the price in front of them.
It is a DISPLAY figure and nothing more. What the customer pays still comes from priceDetails on the Rental/Select response — quote that in the payment summary, and if it ever differs from 30, priceDetails is right and 30 is stale.
MyHome and MyHome Instant do NOT offer key courier: the key comes with the box, and priceDetails carries no KEY-DELIVERY line for them. Do not offer the choice at all on those bundles and do not charge for it.`;

const OLD_PERSONAL =
  'Stage 3 Key Delivery (OPTIONAL): present both options — "Collect from branch" (free) and "Deliver to address (courier fee applies)". Do NOT quote a figure for the courier: the fee is whatever Emirates Post prices for this bundle, it is not the same for every bundle, and for MyHome the key comes with the box so delivery is not offered at all. If delivery is chosen, say a courier fee applies and show the exact amount in the payment summary once the box is held. If no, default to branch collection.';
const NEW_PERSONAL =
  'Stage 3 Key Delivery (OPTIONAL): present both options WITH the fee visible BEFORE the customer chooses — "Collect from branch" (free) and "Deliver to address (AED 30 courier fee)". For MyHome and MyHome Instant do not offer the choice at all: the key comes with the box. If delivery is chosen, show the AED 30 line in the review and confirm the exact amount from the hold in the payment summary. If no, default to branch collection.';

const OLD_CORP =
  "Stage 5 Key Delivery (OPTIONAL): present the options — branch collection (free) or delivery to the company/another address (courier fee applies). Do NOT quote a figure for the courier: the fee is whatever Emirates Post prices for this bundle, and some bundles do not offer key delivery at all. If delivery is chosen, say a courier fee applies and show the exact amount in the payment summary once the box is held.";
const NEW_CORP =
  "Stage 5 Key Delivery (OPTIONAL): present the options WITH the fee visible BEFORE the customer chooses — branch collection (free) or delivery to the company/another address (AED 30 courier fee). If delivery is chosen, show the AED 30 line in the review and confirm the exact amount from the hold in the payment summary.";

interface Journey {
  key: string;
  guidance?: string;
  steps?: { key: string; fields?: { key: string; options?: { value: string; label?: { en?: string; ar?: string } }[] }[] }[];
  submission?: { apiFlow?: { notes?: string } };
  [k: string]: unknown;
}

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`${SLUG} not found`);
  const def = row.definition as unknown as { journeys: Journey[] };
  let changed = 0;

  for (const j of def.journeys) {
    if (!JOURNEYS.includes(j.key)) continue;
    let touched = false;

    for (const [from, to] of [[OLD_PERSONAL, NEW_PERSONAL], [OLD_CORP, NEW_CORP]] as const) {
      if (typeof j.guidance === "string" && j.guidance.includes(from)) {
        j.guidance = j.guidance.split(from).join(to);
        touched = true;
        console.log(`  + ${j.key} guidance`);
      }
    }

    const f = j.submission?.apiFlow;
    if (f && !String(f.notes ?? "").includes(MARKER)) {
      f.notes = String(f.notes ?? "") + NOTE;
      touched = true;
      console.log(`  + ${j.key} apiFlow notes`);
    }

    for (const step of j.steps ?? []) {
      for (const field of step.fields ?? []) {
        for (const opt of field.options ?? []) {
          if (opt.value !== "deliver" || !opt.label) continue;
          if (opt.label.en === EN && opt.label.ar === AR) continue;
          opt.label.en = EN;
          opt.label.ar = AR;
          touched = true;
          console.log(`  + ${j.key}.${step.key}.${field.key}: option relabelled`);
        }
      }
    }

    if (touched) changed++;
  }

  if (!changed) { console.log("nothing to do"); return; }
  await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
  console.log(`\n${changed} journey(s) updated.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
