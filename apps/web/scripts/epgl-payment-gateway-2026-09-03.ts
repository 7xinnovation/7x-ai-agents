/**
 * EPGL takes payment on the Emirates Post gateway, with 1% on top (2026-09-03).
 *
 * Two changes, both from Emre's instruction and the client's process map:
 *
 * 1. The licensing journeys become chargeable through the same Network
 *    International gateway NXN uses. Temporary, until EPGL has its own.
 *
 * 2. They declare a 1% "Admin processing fees", charged ON TOP: a 100,000
 *    licence fee is taken as 101,000. Confirmed by the client in those words.
 *
 * WHY THE FEE IS UNCONDITIONAL HERE. Their process map has two payment routes,
 * and only the gateway one carries the fee -- the VIBAN route, where Finance
 * requests a virtual IBAN from the bank by hand, is at face value. That is not a
 * condition we need to evaluate: a VIBAN payment never passes through us at all.
 * Every payment this agent takes IS a gateway payment. If the VIBAN route is ever
 * brought into the conversation, add a `when` to the fee at the same time.
 *
 * OUTLET REFERENCES. Two of them, and they must not be swapped.
 *
 *   production  b2bf0418-4bef-430c-8afc-c04154408f80   EPGL's own, LIVE
 *   staging     b78ef8c7-ce2a-41d6-84c9-e6219557a991   the N-Genius sandbox
 *
 * Emirates Post said to use "anything random" on staging. An invented UUID would
 * not work: N-Genius rejects an outlet it does not know, so the payment would
 * fail at order creation rather than harmlessly going nowhere. The sandbox outlet
 * NXN already tests against does work, and no money exists in it.
 *
 * The guard below refuses to put the PRODUCTION outlet on the sandbox host, or a
 * sandbox outlet on the live one. Both are the kind of mistake that looks fine
 * until a real card is charged in a test, or a real customer's payment vanishes.
 *
 * The merchant id 200200012694 is also production, and the client confirmed it is
 * fine on staging. Nothing sends it -- the adapter keys everything on outletRef --
 * so it is recorded for reference only.
 *
 * PAYMENT IS NOT SWITCHED ON HERE. Binding the gateway and declaring the fee is
 * safe; flipping requiresPayment makes every licence journey demand a payment
 * before it will submit, which is squarely in the way of the document testing
 * going on right now -- the same reason the sign-in gate was taken off. It needs
 * --require-payment, and the fee is inert until then because nothing charges.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/epgl-payment-gateway-2026-09-03.ts --outlet-ref <uuid> [--env <file>] [--dry-run]
 *   ...and, when the journeys should actually charge: --require-payment
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

const SLUG = "epgl-dialog";
const DRY = process.argv.includes("--dry-run");
const MERCHANT_ID = "200200012694";
/** EPGL's live outlet. Belongs on the production host and nowhere else. */
const PROD_OUTLET = "b2bf0418-4bef-430c-8afc-c04154408f80";
/** The N-Genius sandbox outlet NXN tests against. Real, and holds no money. */
const SANDBOX_OUTLET = "b78ef8c7-ce2a-41d6-84c9-e6219557a991";
const JOURNEYS = ["new_license", "renewal"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUIRE_PAYMENT = process.argv.includes("--require-payment");

const PROCESSING_FEE = {
  key: "admin_processing_fee",
  label: { en: "Admin processing fees", ar: "رسوم المعالجة الإدارية" },
  percent: 1,
};

function outletRef(sandbox: boolean): string {
  const i = process.argv.indexOf("--outlet-ref");
  const given = i !== -1 ? process.argv[i + 1] ?? "" : process.env.EPGL_NGENIUS_OUTLET_REF ?? "";
  const v = given || (sandbox ? SANDBOX_OUTLET : PROD_OUTLET);
  if (!UUID.test(v)) {
    throw new Error(
      `--outlet-ref must be the N-Genius outlet UUID. Got "${given}".\n` +
        `The merchant id ${MERCHANT_ID} is NOT the outlet reference: orders are posted to\n` +
        `/transactions/outlets/{outletRef}, and binding the wrong one sends EPGL's licence\n` +
        `fees to another merchant's outlet.`
    );
  }
  // The two mistakes worth making impossible.
  if (sandbox && v === PROD_OUTLET) {
    throw new Error(
      `refusing to bind EPGL's PRODUCTION outlet to the sandbox gateway.\n` +
        `It would fail at order creation, and a live outlet has no business on a test host.\n` +
        `Omit --outlet-ref on staging and the sandbox outlet ${SANDBOX_OUTLET} is used.`
    );
  }
  if (!sandbox && v === SANDBOX_OUTLET) {
    throw new Error(`refusing to bind the SANDBOX outlet to the LIVE gateway: real payments would go nowhere.`);
  }
  return v;
}

interface Journey { key: string; submission?: Record<string, unknown> }

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`${SLUG} not found`);
  const def = row.definition as unknown as {
    journeys: Journey[];
    integrations: Record<string, unknown>;
    activeEnvironment?: string;
  };

  const sandbox = /sandbox/i.test(process.env.NGENIUS_BASE_URL ?? "") || def.activeEnvironment === "staging";
  const baseUrl = sandbox
    ? "https://api-gateway.sandbox.ngenius-payments.com"
    : "https://api-gateway.ngenius-payments.com";
  // The same guard NXN's binding carries: a sandbox outlet on a production agent
  // takes real money nowhere.
  if (!sandbox && def.activeEnvironment !== "production") {
    throw new Error(`refusing to bind the LIVE gateway: activeEnvironment is "${def.activeEnvironment}"`);
  }
  const ref = outletRef(sandbox);

  def.integrations.payment = {
    provider: "ngenius",
    settings: {
      baseUrl,
      outletRef: ref,
      // Recorded because the client gave it and someone will ask. Nothing sends
      // it: the adapter keys everything on outletRef.
      merchantId: MERCHANT_ID,
      redirectUrl: `${process.env.PUBLIC_APP_URL ?? "https://agent.7x.ae"}/api/payments/return`,
    },
    secretRefs: ["NGENIUS_API_KEY"],
  };

  let changed = 0;
  for (const j of def.journeys) {
    if (!JOURNEYS.includes(j.key)) continue;
    const sub = { ...(j.submission ?? {}), currency: "AED", processingFee: PROCESSING_FEE } as Record<string, unknown>;
    if (REQUIRE_PAYMENT) sub.requiresPayment = true;
    // Compare before counting it. A script that reports "written" on a re-run
    // that changed nothing teaches you to stop reading its output.
    const same = JSON.stringify(j.submission ?? {}) === JSON.stringify(sub);
    j.submission = sub;
    if (same) { console.log(`  (already) ${j.key}: 1% ${PROCESSING_FEE.label.en}`); continue; }
    changed++;
    console.log(
      `  + ${j.key}: 1% ${PROCESSING_FEE.label.en}` +
        (REQUIRE_PAYMENT ? ", requiresPayment true" : `, requiresPayment left as ${String(sub.requiresPayment)} — pass --require-payment to charge`)
    );
  }
  if (!changed) throw new Error(`none of ${JOURNEYS.join(", ")} found on ${SLUG}`);

  console.log(`\ngateway: ${baseUrl}\noutlet:  ${ref}\nmerchant: ${MERCHANT_ID} (reference only)`);
  if (DRY) { console.log("\n--dry-run: nothing written."); return; }
  await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
  console.log("\nwritten.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
