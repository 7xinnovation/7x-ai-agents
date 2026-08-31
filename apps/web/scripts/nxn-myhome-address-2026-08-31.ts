/**
 * Collect a MyHome delivery address the backend will actually accept (2026-08-31).
 *
 * A MyHome box is delivered to the customer's door, so Rental/Save carries a
 * myHomeProfile. Emirates Post matches its address against a fixed list of
 * delivery AREAS held on a separate masters service, keyed by code ("DXB-84") —
 * and the portal puts that code in myHomeAddress.regionName, of all fields. We
 * were sending the one line of free text the customer had typed for key delivery
 * ("Sobha Hartland"), and every MyHome save came back 173
 * MYHOME_ADDDRESSNOT_FOUND — an error that names no field and reads like a fault
 * on their side.
 *
 * The code is now resolved server-side and a save with an unrecognised area is
 * refused before it can be sent, so this adds the fields to collect it in and the
 * guidance to go looking for it.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/nxn-myhome-address-2026-08-31.ts [--env <file>]
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
const MARKER = "MYHOME DELIVERY ADDRESS (2026-08-31)";

const NOTE = `

${MARKER}: a MyHome or MyHome Instant box is delivered to the customer's home, so Rental/Save must carry myHomeProfile — and Emirates Post will only accept an address whose AREA is one it delivers to. The area is identified by a CODE ("DXB-84"), and it goes in myHomeProfile.myHomeAddress.regionName, not regionCode. Anything else comes back 173 MYHOME_ADDDRESSNOT_FOUND, which names no field and is NOT an outage.
Once a MyHome customer has given you an address: call nxn_delivery_areas with their emirate and what they said, show the matches as CARDS, and let them pick. Never choose an area for them and never pass the community or building name — the post is delivered to whatever area is recorded.
Send myHomeProfile as { emailID, mobileNo, myHomeAddress: { emirateCode, regionName: <the CODE>, streetOrLandmark, buildingName, villaOrApartmentNo, detailedAddress } }. detailedAddress is the address in the customer's own words; the other fields are what makes it findable. deliveryOfficeID is filled in for you from the branch they chose.
The key-delivery address is a SEPARATE thing (where the key is couriered) and does not stand in for this one.`;

const FIELDS = [
  { key: "home_area", type: "text", en: "Area / district (for MyHome delivery)", ar: "المنطقة (لتوصيل ماي هوم)" },
  { key: "home_street", type: "text", en: "Street", ar: "الشارع" },
  { key: "home_building", type: "text", en: "Building or villa name", ar: "اسم المبنى أو الفيلا" },
  { key: "home_villa_apt", type: "text", en: "Villa / apartment number", ar: "رقم الفيلا أو الشقة" },
];

const GUIDE =
  " MyHome and MyHome Instant only: the box is delivered to the customer's home, so as well as the key-delivery question you must take their HOME address — area, street, building or villa name, and villa/apartment number. The area is not free text: call nxn_delivery_areas with their emirate and whatever they typed, show the matches as CARDS, and record the one they pick. If nothing matches, ask which district the address sits in rather than choosing for them.";

interface Field { key: string; [k: string]: unknown }
interface Step { key: string; fields?: Field[]; [k: string]: unknown }
interface Journey {
  key: string;
  guidance?: string;
  steps?: Step[];
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

    const step = (j.steps ?? []).find((s) => s.key === "delivery");
    if (step) {
      step.fields = step.fields ?? [];
      for (const f of FIELDS) {
        if (step.fields.some((x) => x.key === f.key)) continue;
        step.fields.push({
          key: f.key,
          type: f.type,
          label: { en: f.en, ar: f.ar },
          validation: { required: false },
        });
        touched = true;
        console.log(`  + ${j.key}.delivery.${f.key}`);
      }
    } else {
      console.log(`  ! ${j.key} has no delivery step`);
    }

    const flow = j.submission?.apiFlow;
    if (flow && !String(flow.notes ?? "").includes(MARKER)) {
      flow.notes = String(flow.notes ?? "") + NOTE;
      touched = true;
      console.log(`  + ${j.key} apiFlow notes`);
    }

    if (typeof j.guidance === "string" && !j.guidance.includes("nxn_delivery_areas")) {
      j.guidance = j.guidance + GUIDE;
      touched = true;
      console.log(`  + ${j.key} guidance`);
    }

    if (touched) changed++;
  }

  if (!changed) { console.log("nothing to do"); return; }
  await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
  console.log(`\n${changed} journey(s) updated.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
