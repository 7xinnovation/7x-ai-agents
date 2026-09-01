/**
 * Capture the address from a map pin, not from a district quiz (2026-09-01).
 *
 * Real conversation, Ajman box: the customer was asked for a delivery address,
 * typed "al bursha", was told it is not a delivery area in Ajman and asked which
 * district it was in; typed "dubai creek", and was told the same thing again. Both
 * answers were true and neither was any use — one was a spelling slip, the other
 * was the wrong emirate, and the customer was being asked to know a district name
 * and its spelling before they could rent a box.
 *
 * The spelling and cross-emirate handling are fixed in code. This changes the ASK:
 * the map comes first, and typing is the fallback rather than the only route.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/nxn-address-capture-2026-09-01.ts [--env <file>]
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
const MARKER = "TAKING AN ADDRESS (2026-09-01)";

const NOTE = `

${MARKER}: never open by asking a customer to name their district. They do not think of their home as a district, they misspell it, and they name a place in a different emirate — and being told "that is not a delivery area" twice in a row is where this journey has been losing people.
ASK WITH THE MAP FIRST. Whenever you need a delivery address — the MyHome home address, or a key courier address — emit a fenced block of three backticks, then the word locate, then a line "label: Pin your address on the map", then a closing line of three backticks. It opens a map with a draggable pin.
When the customer sends back a pinned location, read the latitude and longitude out of it and call nxn_address_from_pin. It returns the emirate, area, street and building as Emirates Post records them, plus the area code. Show that address back, ask them to confirm it and to add their villa or apartment number, which no pin can know.
TYPING IS THE FALLBACK, not the first move: offer it in the same message ("or just type it if you prefer"), and use nxn_delivery_areas for whatever they type. If that tool says the place is in a different emirate, say so directly — "Al Barsha is in Dubai, not Ajman" — and ask whether they want the box in that emirate instead. Never answer a second attempt with the same "not a delivery area" line you gave the first time.
NEVER offer example districts from your own knowledge. The tools return real ones; use those or none.`;

const GUIDE =
  " Delivery addresses: lead with the map. Emit a ```locate block (a line `locate`, then `label: Pin your address on the map`) and let the customer drop a pin, then call nxn_address_from_pin with the coordinates they send back and confirm the address it returns. Typing is offered alongside it, never instead of it.";

interface Journey { key: string; guidance?: string; submission?: { apiFlow?: { notes?: string } }; [k: string]: unknown }

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`${SLUG} not found`);
  const def = row.definition as unknown as { journeys: Journey[] };
  let changed = 0;

  for (const j of def.journeys) {
    if (!JOURNEYS.includes(j.key)) continue;
    let touched = false;
    const f = j.submission?.apiFlow;
    if (f && !String(f.notes ?? "").includes(MARKER)) {
      f.notes = String(f.notes ?? "") + NOTE;
      touched = true;
      console.log(`  + ${j.key} apiFlow notes`);
    }
    if (typeof j.guidance === "string" && !j.guidance.includes("nxn_address_from_pin")) {
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
