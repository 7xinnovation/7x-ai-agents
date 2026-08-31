/**
 * Stop quoting prices we made up (2026-08-31).
 *
 * Two figures in the review card were ours, not Emirates Post's. The key courier
 * fee was written into the journey as AED 25; it is 30, and for MyHome it is not
 * on offer at all — sending the line returns 223 INVALID_ADDITIONAL_SERVICE and
 * takes the whole rental down. And the total was the bundle price plus that fee,
 * which leaves out the mandatory registration charge: AED 720 shown against a
 * real 765.
 *
 * The authoritative breakdown is priceDetails on the Rental/Select response, and
 * that call happens at the last moment, on purpose — a hold cannot be released.
 * So the review before it does not get to state a total.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/nxn-price-truth-2026-08-31.ts [--env <file>]
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
const MARKER = "WHAT A PRICE MAY SAY (2026-08-31)";

const OLD_CORP =
  "Stage 5 Key Delivery (OPTIONAL): present the options WITH the fee visible BEFORE the customer chooses — branch collection (free) or delivery to the company/another address (AED 25 courier fee). If delivery is chosen, include the AED 25 in the review summary and payment total.";
const NEW_CORP =
  "Stage 5 Key Delivery (OPTIONAL): present the options — branch collection (free) or delivery to the company/another address (courier fee applies). Do NOT quote a figure for the courier: the fee is whatever Emirates Post prices for this bundle, and some bundles do not offer key delivery at all. If delivery is chosen, say a courier fee applies and show the exact amount in the payment summary once the box is held.";

const OLD_STAGE3 =
  'Stage 3 Key Delivery (OPTIONAL): present both options WITH the fee visible BEFORE the customer chooses — "Collect from branch" (free) and "Deliver to address" (AED 25 courier fee) as cards/buttons that carry the fee. Never reveal the delivery fee only at payment. If delivery is chosen, include the AED 25 line in the review summary and add it to the payment total.';
const NEW_STAGE3 =
  'Stage 3 Key Delivery (OPTIONAL): present both options — "Collect from branch" (free) and "Deliver to address (courier fee applies)". Do NOT quote a figure for the courier: the fee is whatever Emirates Post prices for this bundle, it is not the same for every bundle, and for MyHome the key comes with the box so delivery is not offered at all. If delivery is chosen, say a courier fee applies and show the exact amount in the payment summary once the box is held. If no, default to branch collection.';

const NOTE = `

${MARKER}: every figure you show has to have come from a tool. Two did not, and both reached customers.
BEFORE THE BOX IS HELD you do NOT know the total, so do not state one. Rental/Bundle gives the annual rental and nothing else — the mandatory registration charge is not in it, which is how a review card came to read AED 720 against a real 765. The pre-payment review lists the rental and any chosen extras, then a line saying registration and any mandatory charges are added when the box is reserved and the exact total is shown before paying. NEVER put a Total on that card.
AFTER Rental/Select the truth is in its response: minimumAmount is the real total for the box, and priceDetails breaks it down line by line. Show THAT as the payment summary, with the amounts and names Emirates Post used.
EXTRAS ARE ONLY WHAT priceDetails LISTS. A serviceType absent from it is not available for that bundle, whatever the customer asked for, and sending it returns 223 INVALID_ADDITIONAL_SERVICE. MyHome is the case in point: it has no KEY-DELIVERY line, because the box is delivered to their door. If the customer asked for key courier and the bundle does not price it, say the key comes with the box and charge nothing for it.
BRANCHES: the branch list carries freeBoxCount when it could be counted. A branch with 0 has nothing to rent — render it in the cards block with \`disabled: yes\` so it greys out, and never offer it or let the customer choose it, however usual a branch it is for them.`;

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

    for (const [from, to] of [[OLD_STAGE3, NEW_STAGE3], [OLD_CORP, NEW_CORP]] as const) {
      if (typeof j.guidance === "string" && j.guidance.includes(from)) {
        j.guidance = j.guidance.split(from).join(to);
        touched = true;
        console.log(`  + ${j.key} guidance: key-delivery stage rewritten`);
      }
    }

    const f = j.submission?.apiFlow;
    if (f && !String(f.notes ?? "").includes(MARKER)) {
      f.notes = String(f.notes ?? "") + NOTE;
      touched = true;
      console.log(`  + ${j.key} apiFlow notes`);
    }

    // The AED 25 also sits on the delivery option the customer taps.
    for (const step of j.steps ?? []) {
      for (const field of step.fields ?? []) {
        for (const opt of field.options ?? []) {
          if (opt.value !== "deliver" || !opt.label) continue;
          const en = "Deliver to address (courier fee applies)";
          const ar = "التوصيل إلى عنوان (تُطبق رسوم البريد السريع)";
          if (opt.label.en === en && opt.label.ar === ar) continue;
          opt.label.en = en;
          opt.label.ar = ar;
          touched = true;
          console.log(`  + ${j.key}.${step.key}.${field.key}: delivery option relabelled`);
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
