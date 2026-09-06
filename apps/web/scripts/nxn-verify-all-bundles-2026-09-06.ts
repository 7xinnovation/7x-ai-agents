/**
 * Every bundle, every term: does the price we would SHOW match the price
 * Emirates Post actually charges?
 *
 * The duration cards are computed by us — a bundle that publishes a price for a
 * term uses that price, one that does not is the annual rate times the years,
 * plus one registration fee. The reservation is the truth. This reserves a box
 * for each combination and compares the two, so a bundle whose pricing does not
 * work that way is found here rather than by a customer.
 *
 * Corporate is the point of it: LI, BR and GO publish 24/36/60/120-month prices
 * where the personal bundles publish only an annual one, and no corporate rental
 * had ever reached a reservation until 4 September.
 *
 * STAGING ONLY, and it RESERVES: each success holds a box for 30 minutes. It
 * creates no order and takes no payment. Pick a branch nobody is testing on.
 *
 * Run from apps/web:
 *   npx tsx scripts/nxn-verify-all-bundles-2026-09-06.ts --env <file> --token <jwt> --office 283
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

import { getDb, agents, auditLog } from "@dialog/db";
import { eq } from "drizzle-orm";
import { listIntegrations } from "../lib/integrations";
import { bundlePeriods, rentalTotal } from "../lib/rentalTotal";
import { feesInSelectResponse, rentInSelectResponse } from "../lib/registrationFees";

/** The same prefix buildApiTools gives a tool, so observations land in its scope. */
const integrationPrefix = (name: string) => name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 14).toLowerCase() || "api";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const TOKEN = arg("--token");
const OFFICE = arg("--office");
const ONLY = arg("--bundle")?.split(",");
if (!TOKEN) throw new Error("--token <the customer's Emirates Post session jwt> is required");
if (!OFFICE) throw new Error("--office <officeId> is required — never a branch someone is testing on.");

const priceOf = (details: unknown, type: string, criteria?: string) => {
  if (!Array.isArray(details)) return null;
  const r = details.find(
    (d: Record<string, unknown>) =>
      String(d?.serviceType ?? "").toUpperCase() === type &&
      (!criteria || String(d?.serviceCriteria ?? "").toUpperCase() === criteria)
  ) as Record<string, unknown> | undefined;
  return typeof r?.totalAmount === "number" ? r.totalAmount : null;
};
const yearsUntil = (d: string) =>
  Math.round((new Date(d).getTime() - Date.now()) / (365.2425 * 24 * 60 * 60 * 1000));

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, "nxn-dialog")).limit(1);
  if (!row) throw new Error("nxn-dialog not found");
  const def = row.definition as unknown as { activeEnvironment?: "staging" | "production" };
  const env = def.activeEnvironment ?? "production";
  if (env !== "staging") throw new Error(`REFUSING: the agent is pointed at ${env}. This reserves boxes.`);
  const intg = (await listIntegrations(row.id)).find((i) => i.enabled && i.environments[env]);
  if (!intg) throw new Error("no enabled staging integration");
  const spec = intg.environments[env]!;
  const base = String(spec.baseUrl).replace(/\/$/, "");
  const h: Record<string, string> = { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` };
  if (spec.apiKey) h[spec.apiKeyHeader || "X-API-KEY"] = String(spec.apiKey);
  const get = async (p: string) => (await (await fetch(base + p, { headers: h })).json())?.payload;

  const bundles: Record<string, unknown>[] = [];
  for (const request of ["P", "C"]) {
    const list = (await get(`/api/Rental/Bundle?request=${request}`)) as Record<string, unknown>[] | undefined;
    for (const b of list ?? []) bundles.push({ ...b, __kind: request === "P" ? "personal" : "corporate" });
  }

  let pass = 0, fail = 0;
  for (const b of bundles) {
    const id = String(b.bundle_Id);
    if (ONLY && !ONLY.includes(id)) continue;
    const name = String(b.name_En);
    const periods = bundlePeriods(b);
    const annual = periods.find((p) => p.years === 1)?.price ?? null;
    console.log(`\n${id.padEnd(8)} ${name} (${b.__kind})`);
    console.log(`  published: ${periods.map((p) => `${p.years}y ${p.price}`).join(", ") || "— none"}`);

    const dates = (await get(`/api/Rental/ExpiryDates?BundleId=${id}`)) as { dates?: string[]; type?: number } | undefined;
    const location = /^MYHOME/i.test(id) ? "DXB" : OFFICE;
    const free = (await get(`/api/Rental/FreeBoxes?BundleId=${id}&LocationId=${location}`)) as { uniqueBoxId: string }[] | undefined;
    if (!dates?.dates?.length || !free?.length) {
      console.log(`  SKIPPED — ${!dates?.dates?.length ? "no expiry dates" : `no free boxes at ${location}`}`);
      continue;
    }

    // Two terms per bundle: the shortest, and a longer one. Corporate publishes
    // its own 24/36/60/120-month prices where the personal bundles publish only
    // an annual rate, so a bundle that priced correctly for one year says
    // nothing about how it prices for three.
    // --terms all walks every duration Emirates Post offers (1, 2, 3, 5, 10),
    // which is the only way to know a bundle prices correctly at every length
    // rather than at the two we happened to look at.
    const wanted = arg("--terms") === "all" ? dates.dates : [dates.dates[0]!, dates.dates[2] ?? dates.dates[1]];
    const terms = wanted.filter(Boolean) as string[];
    let boxAt = 0;
    for (const expiry of terms) {
    let hold: Record<string, any> | null = null;
    for (const box of free.slice(boxAt, boxAt + 4)) {
      boxAt++;
      const r = await fetch(`${base}/api/Rental/Select`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({
          bundleId: id,
          uniqueBoxID: box.uniqueBoxId,
          poBoxExpiryDate: expiry,
          physicalBoxRequired: !/^MYHOME/i.test(id),
        }),
      });
      const text = await r.text();
      const j = (() => { try { return JSON.parse(text); } catch { return null; } })();
      if (j?.payload?.subscriptionReferenceNumber) {
        hold = j.payload;
        // RECORD IT. Reading these prices back is the only way the duration
        // cards can show a discounted term, and a reservation made by a script
        // teaches us exactly as much as one made by a customer — so long as it
        // is filed under its own action name and never mistaken for a rental.
        const response = `HTTP ${r.status} ${r.statusText}\n${text}`;
        await db.insert(auditLog).values({
          agentId: row.id,
          actor: "system",
          action: "registration_fee_observed",
          payload: {
            tool: `${integrationPrefix(intg.name)}__post_api_Rental_Select`,
            method: "POST",
            path: "/api/Rental/Select",
            input: { bundleId: id, poBoxExpiryDate: expiry },
            response: response.slice(0, 4000),
            fees: Object.fromEntries(feesInSelectResponse(response)),
            rents: Object.fromEntries(rentInSelectResponse(response, new Date())),
            note: "Reservation made by scripts/nxn-verify-all-bundles to price a term. Not a customer rental.",
          },
        });
        break;
      }
      if (r.status !== 400) console.log(`    (HTTP ${r.status})`);
    }
    if (!hold) { console.log("  SKIPPED — no box could be reserved"); continue; }

    const fee = priceOf(hold.priceDetails, "NEW-REG");
    const years = yearsUntil(expiry);
    const published = periods.find((p) => p.years === years)?.price ?? null;
    const rent = published ?? (annual !== null ? annual * years : null);
    const owed = rent !== null && fee !== null ? rentalTotal({ base: rent + fee }).total : null;
    const actual = hold.minimumAmount as number;
    const ok = owed !== null && Math.abs(owed - actual) < 0.01;
    console.log(
      `  ${years}y: we would show ${owed ?? "?"} · Emirates Post holds ${actual}` +
        `   (rent ${rent ?? "?"} + registration ${fee ?? "?"})   ${ok ? "MATCH" : "MISMATCH"}`
    );
    console.log(
      `  services priced: ${(hold.priceDetails ?? []).map((d: any) => `${d.serviceType}${d.serviceCriteria ? `/${d.serviceCriteria}` : ""}=${d.totalAmount}`).join(", ")}`
    );
    if (ok) pass++; else fail++;
    }
  }

  console.log(`\n${pass} bundle(s) priced correctly, ${fail} not`);
  process.exit(fail ? 1 : 0);
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
