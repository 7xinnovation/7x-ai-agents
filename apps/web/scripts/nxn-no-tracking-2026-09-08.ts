/**
 * We do not track shipments (2026-09-08).
 *
 * 42 of the intents classified on production in thirty days were
 * shipment_tracking — the second most common thing anyone asks — and there is no
 * shipment journey, no tracking tool, and nothing behind it. The persona
 * introduced the agent as being for "PO Box and shipment tracking", so the
 * conversation invited a question it cannot answer, and the customer then spent
 * their time finding that out.
 *
 * The honest version: say plainly that this assistant handles PO Boxes, point
 * them at where tracking actually lives, and do not make them ask twice.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/nxn-no-tracking-2026-09-08.ts [--env <file>] [--dry-run]
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
const DRY = process.argv.includes("--dry-run");
const MARKER = "SHIPMENT TRACKING IS NOT ONE OF OUR SERVICES";

const TEXT =
  `${MARKER}. This assistant handles PO Boxes: renting one, renewing one, and managing one. It cannot track a ` +
  "shipment, find a parcel, tell anyone where a delivery has got to, or look up an AWB or tracking number — there " +
  "is no tool behind any of that and there is nothing to check.\n\n" +
  "So say so at once, in one line, the first time they ask. Do not ask for a tracking number, do not offer to " +
  "look, do not say you are checking, and never invent a status. Point them to Emirates Post's own tracking:\n" +
  "- English: [Track a shipment](https://www.emiratespost.ae/track) · 600 599 999\n" +
  "- Arabic: [تتبع شحنة](https://www.emiratespost.ae/ar/track) · 600 599 999\n\n" +
  "Then offer what you CAN do, once, as a short choice — rent a PO Box, renew one, manage one — and leave it there. " +
  "A customer who came for a parcel and is told plainly where to go has been helped; one who is asked for a " +
  "tracking number and then told it cannot be checked has been kept.";

interface Journey { key: string; guidance?: string }

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`${SLUG} not found`);
  const def = row.definition as unknown as Record<string, any>;
  const changes: string[] = [];

  // The persona said it was for "PO Box and shipment tracking".
  if (typeof def.persona === "string" && /shipment tracking/i.test(def.persona)) {
    def.persona = def.persona.replace(/\(PO Box and shipment tracking\)/gi, "(PO Box rental, renewal and management)");
    changes.push("persona: no longer offers shipment tracking");
  }

  // The guardrails are read on every turn, whatever journey is running — which is
  // where a question nobody has a journey for has to be answered.
  const g = String(def.guardrails ?? "");
  if (!g.includes(MARKER)) {
    def.guardrails = `${g.split(/\n{2,}/).filter((p: string) => !p.includes(MARKER)).join("\n\n").trim()}\n\n${TEXT}`.trim();
    changes.push(`guardrails: ${MARKER} added`);
  }

  // The intent stays: knowing how often it is asked is worth more than hiding it,
  // and the classifier still needs somewhere to put the question.
  const ship = (def.intents ?? []).find((i: any) => i?.key === "shipment_tracking");
  if (ship && !/not offered/i.test(String(ship.description?.en ?? ""))) {
    ship.description = {
      en: "Track a shipment — NOT offered by this assistant; answered by pointing to Emirates Post's tracking page",
      ar: "تتبع شحنة — غير متاح عبر هذا المساعد؛ يُحال إلى صفحة التتبع",
    };
    changes.push("intent shipment_tracking: described as not offered");
  }

  if (!changes.length) { console.log("nothing to do."); return; }
  for (const c of changes) console.log(`  ~ ${c}`);
  if (!DRY) {
    await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
    console.log(`\n${changes.length} written.`);
  } else console.log(`\n--dry-run: ${changes.length} not written.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
