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
 * OUTLET REFERENCE -- NOT YET KNOWN. The client gave a merchant id,
 * 200200012694. N-Genius orders are posted to /transactions/outlets/{outletRef},
 * and an outletRef is a UUID (NXN staging is b78ef8c7-…). So the merchant id is
 * not it, and guessing would post EPGL's licence fees to whatever outlet the
 * guess happened to name. It is recorded in the binding for reference and the
 * script REFUSES to bind a gateway without a real outletRef.
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
const JOURNEYS = ["new_license", "renewal"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUIRE_PAYMENT = process.argv.includes("--require-payment");

const PROCESSING_FEE = {
  key: "admin_processing_fee",
  label: { en: "Admin processing fees", ar: "رسوم المعالجة الإدارية" },
  percent: 1,
};

function outletRef(): string {
  const i = process.argv.indexOf("--outlet-ref");
  const v = i !== -1 ? process.argv[i + 1] ?? "" : process.env.EPGL_NGENIUS_OUTLET_REF ?? "";
  if (!UUID.test(v)) {
    throw new Error(
      `--outlet-ref must be the N-Genius outlet UUID. Got ${v ? `"${v}"` : "nothing"}.\n` +
        `The merchant id ${MERCHANT_ID} is NOT the outlet reference: orders are posted to\n` +
        `/transactions/outlets/{outletRef}, and binding the wrong one sends EPGL's licence\n` +
        `fees to another merchant's outlet. Ask Emirates Post for EPGL's outlet reference.`
    );
  }
  return v;
}

interface Journey { key: string; submission?: Record<string, unknown> }

async function main() {
  const ref = outletRef();
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
