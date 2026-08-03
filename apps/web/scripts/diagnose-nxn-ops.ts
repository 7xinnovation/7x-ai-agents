/**
 * Diagnostic: call the live Emirates Post staging operations the NXN journeys
 * depend on, through the app's own integration layer, and print the raw upstream
 * response. Use this to tell an upstream failure apart from a prompt/agent
 * problem — it bypasses the model entirely.
 *
 * Run from apps/web:
 *   DATABASE_URL="<env>" npx tsx scripts/diagnose-nxn-ops.ts [boxNumber] [emirate]
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";
import { buildApiTools } from "../lib/integrations";

const BOX = process.argv[2] ?? "50500";
const EMIRATE = process.argv[3] ?? "DXB";

const show = (label: string, r: { result: string; isError?: boolean }) => {
  const head = r.result.split("\n")[0] ?? "";
  const body = r.result.slice(r.result.indexOf("\n") + 1).replace(/\s+/g, " ").slice(0, 400);
  console.log(`\n── ${label}`);
  console.log(`   ${r.isError ? "ERROR" : "ok   "}  ${head}`);
  console.log(`   ${body}`);
};

async function main() {
  const db = getDb();
  const [agent] = await db.select().from(agents).where(eq(agents.slug, "nxn-dialog")).limit(1);
  if (!agent) throw new Error("nxn-dialog not found");

  // Guest, no UAE PASS token and no mock — exactly what a visitor gets.
  const { tools, exec } = await buildApiTools(agent.id, "staging", { authenticated: false });
  const name = (needle: string) => {
    const t = tools.find((x) => x.name.toLowerCase().includes(needle.toLowerCase()));
    if (!t) throw new Error(`tool not found: ${needle} (have: ${tools.map((x) => x.name).join(", ")})`);
    return t.name;
  };
  console.log(`${tools.length} enabled operations for nxn-dialog / staging`);

  // 1) Bundles — the read that BLOCKERS says works key-only.
  const bundles = await exec(name("Rental_Bundle"), { request: "P" });
  show("Rental/Bundle (request=P)", bundles);
  let bundleId = "MYHOME3";
  try {
    const j = JSON.parse(bundles.result.slice(bundles.result.indexOf("\n") + 1));
    const list = j.payload ?? j;
    const first = Array.isArray(list) ? list[0] : Array.isArray(list?.bundles) ? list.bundles[0] : null;
    if (first?.bundle_Id) bundleId = first.bundle_Id;
  } catch { /* keep default */ }
  console.log(`   → using bundleId ${bundleId}`);

  // 2) Branch locations for that bundle + emirate.
  const locs = await exec(name("Rental_BoxLocations"), { BundleId: bundleId, EmirateCode: EMIRATE });
  show(`Rental/BoxLocations (${bundleId}, ${EMIRATE})`, locs);
  // Regex, not JSON.parse: long bodies are truncated by executeOperation.
  const officeId = locs.result.match(/"officeId"\s*:\s*"?(\d+)"?/i)?.[1];
  console.log(`   → using officeId ${officeId ?? "(none found)"}`);

  // 3) FreeBoxes — the one reported as returning no boxes.
  if (officeId) {
    show(
      `Rental/FreeBoxes (${bundleId}, ${officeId})`,
      await exec(name("Rental_FreeBoxes"), { BundleId: bundleId, LocationId: officeId })
    );
  }

  // 4) Guest renewal details for a known box.
  const details = await exec(name("Guest_Renewal_Details"), { boxNumber: BOX, BoxNumber: BOX, EmirateCode: EMIRATE, emirateCode: EMIRATE });
  show(`Guest/Renewal/Details (box ${BOX}, ${EMIRATE})`, details);
  let currentExpiry: string | undefined;
  let currentBundle: string | undefined;
  try {
    const j = JSON.parse(details.result.slice(details.result.indexOf("\n") + 1));
    const d = j.payload?.poBoxRenewalDetails ?? j.payload ?? j;
    currentExpiry = d?.currentExpiryDate ?? d?.CurrentExpiryDate;
    currentBundle = d?.bundleId ?? d?.bundle_Id ?? d?.BundleId;
  } catch { /* ignore */ }
  console.log(`   → currentExpiryDate ${currentExpiry ?? "?"}, bundle ${currentBundle ?? "?"}`);

  // 5) Guest renewal pricing — with a CORRECTLY formatted target expiry, so a
  //    failure here is upstream and not the agent formatting the date wrongly.
  const baseYear = Math.max(
    new Date().getUTCFullYear(),
    currentExpiry ? Number(String(currentExpiry).slice(0, 4)) : 0
  );
  const target = `${baseYear + 1}-12-31T00:00:00`;
  console.log(`   → pricing target expiryDate ${target}`);
  show(
    "Guest/Renewal/Pricing (1 year, correct ISO target)",
    await exec(name("Guest_Renewal_Pricing"), {
      body: {
        boxNumber: BOX,
        emirateCode: EMIRATE,
        expiryDate: target,
        newBundleId: currentBundle ?? bundleId,
        isBundleChanged: false,
      },
    })
  );

  // 6) The same call with a DD-MM-YYYY date, to show what happens if the agent
  //    applies the customer-facing date format to a tool parameter.
  show(
    "Guest/Renewal/Pricing (same call, DD-MM-YYYY date — must not be used)",
    await exec(name("Guest_Renewal_Pricing"), {
      body: {
        boxNumber: BOX,
        emirateCode: EMIRATE,
        expiryDate: `31-12-${baseYear + 1}T00:00:00`,
        newBundleId: currentBundle ?? bundleId,
        isBundleChanged: false,
      },
    })
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
