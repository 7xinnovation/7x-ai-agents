/**
 * Does the payload we now send actually produce the right order?
 *
 * Everything up to the card can be checked without a human: reserve a box, build
 * the save exactly as the app now builds it — courier service AND its address,
 * the five-field savedCard, physicalBoxRequired, the amount covering the extras
 * — send it, and read back what Emirates Post told N-Genius the order is worth.
 * If that figure matches the summary, the payload is right and the only thing
 * left is the card itself.
 *
 * STAGING ONLY, and it RESERVES a box and CREATES an order. It takes no payment.
 * Pick a branch nobody is testing on: --office has no default.
 *
 * Run from apps/web:
 *   npx tsx scripts/nxn-verify-rental-chain-2026-09-04.ts --env <file> --token <jwt> --office 283 [--years 2] [--courier]
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
import { rentalTotal } from "../lib/rentalTotal";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const TOKEN = arg("--token");
const OFFICE = arg("--office");
const BUNDLE = arg("--bundle") ?? "IN";
const YEARS = Number(arg("--years") ?? 2);
const COURIER = process.argv.includes("--courier");
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

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, "nxn-dialog")).limit(1);
  if (!row) throw new Error("nxn-dialog not found");
  const def = row.definition as unknown as { activeEnvironment?: "staging" | "production" };
  const env = def.activeEnvironment ?? "production";
  if (env !== "staging") throw new Error(`REFUSING: the agent is pointed at ${env}. This creates an order.`);
  const intg = (await listIntegrations(row.id)).find((i) => i.enabled && i.environments[env]);
  if (!intg) throw new Error("no enabled staging integration");
  const spec = intg.environments[env]!;
  const base = String(spec.baseUrl).replace(/\/$/, "");
  const h: Record<string, string> = { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` };
  if (spec.apiKey) h[spec.apiKeyHeader || "X-API-KEY"] = String(spec.apiKey);
  const get = async (p: string) => (await (await fetch(base + p, { headers: h })).json())?.payload;

  const dates = (await get(`/api/Rental/ExpiryDates?BundleId=${BUNDLE}`)) as { dates?: string[] } | undefined;
  const now = Date.now();
  const expiry = (dates?.dates ?? []).find(
    (d) => Math.round((new Date(d).getTime() - now) / (365.2425 * 24 * 60 * 60 * 1000)) === YEARS
  );
  if (!expiry) throw new Error(`no ${YEARS}-year date offered for ${BUNDLE}`);

  const free = (await get(`/api/Rental/FreeBoxes?BundleId=${BUNDLE}&LocationId=${OFFICE}`)) as { uniqueBoxId: string; boxId: string }[] | undefined;
  if (!free?.length) throw new Error(`no free boxes at ${OFFICE} for ${BUNDLE}`);

  console.log(`\n${intg.name} · ${env} · ${BUNDLE} · ${YEARS} year(s) · courier ${COURIER ? "YES" : "no"}`);

  // 1. Reserve.
  let hold: Record<string, any> | null = null;
  for (const box of free.slice(0, 6)) {
    const r = await fetch(`${base}/api/Rental/Select`, {
      method: "POST",
      headers: h,
      body: JSON.stringify({ bundleId: BUNDLE, uniqueBoxID: box.uniqueBoxId, poBoxExpiryDate: expiry, physicalBoxRequired: true }),
    });
    const j = await r.json().catch(() => null);
    if (j?.payload?.subscriptionReferenceNumber) { hold = { ...j.payload, boxId: box.boxId, uniqueBoxId: box.uniqueBoxId }; break; }
  }
  if (!hold) throw new Error("no box could be reserved");
  const courierPrice = priceOf(hold.priceDetails, "KEY-DELIVERY");
  const owed = rentalTotal(
    { base: hold.minimumAmount, keyDeliveryPrice: courierPrice },
    { keyDelivery: COURIER && courierPrice !== null }
  ).total;
  console.log(`  reserved ${hold.boxId} · ${hold.subscriptionReferenceNumber} · minimumAmount ${hold.minimumAmount} · courier line ${courierPrice ?? "not offered"}`);
  console.log(`  the summary would say AED ${owed.toFixed(2)}`);

  // 2. Save, exactly as the app now builds it.
  const body: Record<string, unknown> = {
    subscriptionReferenceNumber: hold.subscriptionReferenceNumber,
    boxNumber: Number(hold.boxId),
    emirateCode: "DXB",
    newBundleId: BUNDLE,
    expiryDate: hold.poBoxExpiryDate,
    physicalBoxRequired: true,
    totalAmount: owed,
    requestSource: "PoBoxAIBot",
    userProfile: {
      email: "emre.karayalcin@7x.ae",
      idType: "EmiratesID",
      idNumber: "784199983926421",
      language: "English",
      mobileNumber: "0553708434",
      customerNameEN: "Emre Karayalcin",
    },
    paymentProperties: {
      billingDetail: {
        address: "Apt 2, 17d Street, Garhoud",
        cityName: "DXB",
        firstName: "Emre",
        lastName: "Karayalcin",
        countryName: "United Arab Emirates",
        emailAddress: "emre.karayalcin@7x.ae",
      },
      saveCreditCard: true,
      isAutomaticSubscriptionEnabled: true,
      paymentReturnUrl: "https://7xagents.7x-lab.com/api/payments/ext-return",
    },
  };
  if (COURIER && courierPrice !== null) {
    body.additionalServiceDetailList = [{ quantity: 1, serviceType: "KEY-DELIVERY" }];
    body.keyDeliveryAddress = {
      name: "Emre Karayalcin",
      mobileNo: "0553708434",
      emirateCode: "DXB",
      deliveryAddress: "Apt 2, 17d Street, Garhoud",
    };
  }

  const r = await fetch(`${base}/api/Rental/Save`, { method: "POST", headers: h, body: JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) { console.log(`\n  SAVE FAILED  HTTP ${r.status}\n  ${text.slice(0, 400)}`); return; }
  const saved = JSON.parse(text)?.payload;
  const minor = saved?.paymentGateWayResponse?.niOrderResult?.amount?.value;
  const charged = typeof minor === "number" ? minor / 100 : null;
  console.log(`  order ${saved?.orderNo} created`);
  console.log(`  the gateway will ask for AED ${charged === null ? "?" : charged.toFixed(2)}`);
  console.log(
    charged === owed
      ? `\n  MATCH — the summary and the payment page are the same number.`
      : `\n  MISMATCH — summary ${owed}, gateway ${charged}. The payload is still wrong.`
  );
  console.log(`  pay page: ${saved?.paymentGateWayResponse?.paymentUrl}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
