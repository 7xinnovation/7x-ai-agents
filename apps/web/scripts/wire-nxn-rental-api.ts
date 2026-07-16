/**
 * Wire the NXN "New PO Box" (rental) journeys to the LIVE Emirates Post staging
 * API instead of letting the model invent bundles / branches / box numbers.
 *
 * The agent already has the tools (integration "NXN Staging", box-stg.emiratespost.ae).
 * These are the real, verified rental-discovery endpoints:
 *   GET /api/Rental/Bundle?request=P|C          → bundles (bundle_Id, name_En, bundle_Price)
 *   GET /api/Rental/BoxLocations?BundleId&EmirateCode → offices (officeId, nameEn)
 *   GET /api/Rental/FreeBoxes?BundleId&LocationId     → AVAILABLE box numbers (needs a signed-in session)
 *   GET /api/Rental/ExpiryDates?bundleId              → real expiry/duration options
 * This appends an explicit API playbook to each rental journey's guidance so the
 * model calls those tools in order and never fabricates. Idempotent (guarded by a
 * marker). Run: npx tsx scripts/wire-nxn-rental-api.ts   (from apps/web)
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";

const MARKER = "LIVE EMIRATES POST RENTAL API";

const EMIRATE_CODES =
  "Abu Dhabi=AUH, Dubai=DXB, Sharjah=SHJ, Ajman=AJM, Umm Al Quwain=UAQ, Ras Al Khaimah=RAK, Fujairah=FUJ";

const flow = (customerType: "personal" | "corporate") => {
  const req = customerType === "personal" ? "P" : "C";
  return [
    `${MARKER} — you have live Emirates Post tools; NEVER invent bundles, branches, box numbers, prices or dates. Always read them from the tools, in this order:`,
    `1) Bundles: call the Rental/Bundle tool with request='${req}'. Present the returned bundles as CARDS using name_En and bundle_Price (AED). Remember each bundle's bundle_Id.`,
    `2) Emirate: ask which emirate and map it to a code (${EMIRATE_CODES}).`,
    `3) Branches: call the Rental/BoxLocations tool with BundleId=<chosen bundle_Id> and EmirateCode=<code>. Present the returned offices as CARDS (nameEn, workingTime); remember each office's officeId. Right AFTER the branch cards, ALWAYS also offer the map: emit a fenced block with three backticks then the word map, then a line 'emirate: <code>' and a line 'bundle: <chosen bundle_Id>', then a closing line of three backticks. This renders a "Browse nearby branches on a map" option that finds the closest branches by the customer's location; the customer can use it or pick a branch card manually.`,
    `4) Available boxes: call the Rental/FreeBoxes tool with BundleId=<bundle_Id> and LocationId=<officeId>. Present the returned available box numbers as CARDS, 10 at a time; a "Refresh" calls it again for the next set. If FreeBoxes returns an auth/sign-in error, the free-box list needs an authenticated Emirates Post session — ask the customer to complete UAE PASS sign-in and retry. NEVER make up box numbers; if you cannot get them from FreeBoxes, say so and offer to continue once signed in.`,
    `5) Duration: call the Rental/ExpiryDates tool with bundleId=<bundle_Id> to get the real expiry-date options and present them as the rental durations.`,
    `Only after the customer selects a real box number returned by FreeBoxes may you proceed to review and payment.`,
  ].join("\n");
};

async function main() {
  const db = getDb();
  const [agent] = await db.select().from(agents).where(eq(agents.slug, "nxn-dialog")).limit(1);
  if (!agent) throw new Error("nxn-dialog not found");
  const def = agent.definition as Record<string, any>;

  const targets: { key: string; type: "personal" | "corporate" }[] = [
    { key: "personal_po_box_rental", type: "personal" },
    { key: "corporate_po_box_rental", type: "corporate" },
  ];
  for (const { key, type } of targets) {
    const j = def.journeys.find((x: any) => x.key === key);
    if (!j) { console.log(`  (skip) ${key} not found`); continue; }
    const base = (j.guidance ?? "").split(`\n\n${MARKER}`)[0]; // drop any prior append
    j.guidance = `${base}\n\n${flow(type)}`;
    console.log(`  ${key}: guidance now ${j.guidance.length} chars`);
  }

  await db.update(agents).set({ definition: def as typeof agent.definition }).where(eq(agents.id, agent.id));
  console.log("NXN rental journeys wired to the live Emirates Post API.");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
