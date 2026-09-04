/**
 * Why is a CORPORATE Rental/Select refused with an empty error object?
 *
 * 4 Sep: `{"bundleId":"LI", ...}` → `400 {"errorDetails":{},"payload":null}`,
 * with no code and no message, while the identical shape with `bundleId=IN`
 * succeeds on a box from the same branch listing. The chat had nothing to tell
 * the customer, so it invented "this branch has no boxes".
 *
 * `Rental/ExpiryDates` answers `type: 0` for LI and `type: 1` for every personal
 * bundle, and the only other flag in the payload is `physicalBoxRequired` — so
 * this sends the same reservation both ways and prints what comes back.
 *
 * STAGING ONLY, and it RESERVES: a successful Select puts a 30-minute hold on
 * the box it names. It creates no order and takes no payment. Refuses to run
 * against a production integration.
 *
 * Run from apps/web:
 *   npx tsx scripts/nxn-corporate-select-probe-2026-09-04.ts --env <file> --token <jwt> [--bundle LI] [--office 244]
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
import { listIntegrations } from "../lib/integrations";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const TOKEN = arg("--token");
const BUNDLE = arg("--bundle") ?? "LI";
const OFFICE = arg("--office") ?? "244";
if (!TOKEN) throw new Error("--token <the customer's Emirates Post session jwt> is required");

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, "nxn-dialog")).limit(1);
  if (!row) throw new Error("nxn-dialog not found");
  const def = row.definition as unknown as { activeEnvironment?: "staging" | "production" };
  const env = def.activeEnvironment ?? "production";
  if (env !== "staging") throw new Error(`REFUSING: the agent is pointed at ${env}. This script reserves boxes.`);
  const intg = (await listIntegrations(row.id)).find((i) => i.enabled && i.environments[env]);
  if (!intg) throw new Error("no enabled staging integration");
  const spec = intg.environments[env]!;
  const base = String(spec.baseUrl).replace(/\/$/, "");
  const h: Record<string, string> = { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` };
  if (spec.apiKey) h[spec.apiKeyHeader || "X-API-KEY"] = String(spec.apiKey);

  const dates = await (await fetch(`${base}/api/Rental/ExpiryDates?BundleId=${BUNDLE}`, { headers: h })).json();
  const expiry = dates?.payload?.dates?.[0];
  const kind = dates?.payload?.type;
  console.log(`\n${BUNDLE}: ExpiryDates type=${JSON.stringify(kind)}, first date ${expiry}`);

  const free = await (await fetch(`${base}/api/Rental/FreeBoxes?BundleId=${BUNDLE}&LocationId=${OFFICE}`, { headers: h })).json();
  const boxes = (free?.payload ?? []) as { uniqueBoxId: string; boxId: string }[];
  console.log(`office ${OFFICE}: ${boxes.length} free box(es)${boxes.length ? ` — trying ${boxes[0]!.boxId}` : ""}`);
  if (!boxes.length) return;

  // Both flags, and a few boxes: 108 BOX_NOT_FREE is about one box, so a single
  // refusal cannot tell "corporate is broken" from "that box is taken". The
  // first success stops the loop, so at most one box is left on hold.
  const TRIES = Number(arg("--tries") ?? 4);
  const attempts: { box: string; physicalBoxRequired: boolean }[] = [];
  for (const physicalBoxRequired of [true, false])
    for (const b of boxes.slice(0, TRIES)) attempts.push({ box: b.uniqueBoxId, physicalBoxRequired });
  for (const { box, physicalBoxRequired } of attempts) {
    const body = { bundleId: BUNDLE, uniqueBoxID: box, poBoxExpiryDate: expiry, physicalBoxRequired };
    const r = await fetch(`${base}/api/Rental/Select`, { method: "POST", headers: h, body: JSON.stringify(body) });
    const text = await r.text();
    console.log(`\nbox ${box}, physicalBoxRequired=${physicalBoxRequired} → HTTP ${r.status}`);
    try {
      const j = JSON.parse(text);
      const p = j?.payload;
      if (p?.subscriptionReferenceNumber) {
        console.log(`  RESERVED ${p.subscriptionReferenceNumber}, minimumAmount ${p.minimumAmount}`);
        for (const d of p.priceDetails ?? [])
          console.log(`   ${String(d.serviceType).padEnd(10)} ${String(d.serviceCriteria).padEnd(2)} ${d.displayNameEn} = ${d.totalAmount}`);
        return; // stop the moment one works; do not hold a second box
      }
      console.log(`  ${JSON.stringify(j).slice(0, 400)}`);
    } catch {
      console.log(`  ${text.slice(0, 400)}`);
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
