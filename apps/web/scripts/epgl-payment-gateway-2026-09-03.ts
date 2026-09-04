/**
 * EPGL takes payment on the Emirates Post gateway, with 1% on top (2026-09-03).
 *
 * Two changes, both from Emre's instruction and the client's process map:
 *
 * 1. The licensing journeys become chargeable through the same Network
 *    International gateway NXN uses. Temporary, until EPGL has its own.
 *
 * 2. THE 1% IS OFF. It was declared on 3 Sep -- "Admin processing fees", charged
 *    on top, 100,000 taken as 101,000 -- and removed on 4 Sep at the client's
 *    instruction: the fee is 150,000 flat, with nothing added. Pass --fee-percent
 *    to put it back rather than editing this file, since the reasoning that
 *    produced it (their own payment process map) has not changed.
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
/**
 * Bind the LIVE gateway on an agent that is not yet running in production mode.
 *
 * EPGL's production agent has activeEnvironment "staging", because there is no
 * Salesforce production org yet -- so it writes to the sandbox. Left to itself
 * the script therefore picks the sandbox gateway even against the production
 * database, which is not what "put the production credentials on prod" means.
 *
 * This says: configure the live gateway anyway. It is safe on its own, because
 * a bound gateway charges nobody -- only requiresPayment does that, and the
 * guard below refuses to set it while the agent is still writing to a sandbox.
 * Configuring and ARMING are separated deliberately: the dangerous combination
 * is real money against a record that does not exist.
 */
const LIVE_GATEWAY = process.argv.includes("--live-gateway");

/**
 * A fee to charge, because EPGL has not given us one.
 *
 * There is no pricing tool on these journeys and no amount in the definition, so
 * requiresPayment alone would charge ZERO -- or, worse, leave the model to supply
 * a licence fee it has no source for and would therefore invent. Neither is
 * acceptable, so the amount is explicit and has to be passed.
 */
function amount(): number | null {
  const i = process.argv.indexOf("--amount");
  if (i === -1) return null;
  const v = Number(process.argv[i + 1]);
  if (!Number.isFinite(v) || v <= 0) throw new Error(`--amount must be a positive number, got "${process.argv[i + 1]}"`);
  return v;
}

/** Off unless --fee-percent says otherwise. */
function feePercent(): number | null {
  const i = process.argv.indexOf("--fee-percent");
  if (i === -1) return null;
  const v = Number(process.argv[i + 1]);
  if (!Number.isFinite(v) || v <= 0) throw new Error(`--fee-percent must be a positive number, got "${process.argv[i + 1]}"`);
  return v;
}

const PROCESSING_FEE = (percent: number) => ({
  key: "admin_processing_fee",
  label: { en: "Admin processing fees", ar: "رسوم المعالجة الإدارية" },
  percent,
});

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

  const sandbox = LIVE_GATEWAY
    ? false
    : /sandbox/i.test(process.env.NGENIUS_BASE_URL ?? "") || def.activeEnvironment === "staging";
  const baseUrl = sandbox
    ? "https://api-gateway.sandbox.ngenius-payments.com"
    : "https://api-gateway.ngenius-payments.com";
  // The same guard NXN's binding carries: a sandbox outlet on a production agent
  // takes real money nowhere.
  if (!sandbox && def.activeEnvironment !== "production" && !LIVE_GATEWAY) {
    throw new Error(`refusing to bind the LIVE gateway: activeEnvironment is "${def.activeEnvironment}"`);
  }
  // The combination that must never exist: real money taken against a backend
  // that is still a sandbox. The customer is charged 150,000 and the licence
  // request they paid for lands in a Salesforce org EPGL does not look at.
  if (!sandbox && REQUIRE_PAYMENT && def.activeEnvironment !== "production") {
    throw new Error(
      `refusing to ARM the live gateway while activeEnvironment is "${def.activeEnvironment}".\n` +
        `A payment taken here is real money against a Salesforce SANDBOX record.\n` +
        `Bind the gateway now (drop --require-payment) and arm it once EPGL's\n` +
        `production org exists and activeEnvironment is "production".`
    );
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
      // Derived from the ENVIRONMENT, not from PUBLIC_APP_URL. Run from a laptop
      // that variable is usually unset, and the fallback sent a customer paying
      // on staging back to the production host -- a return URL that looks right
      // in the config and strands the payment.
      redirectUrl: `${sandbox ? "https://7xagents.7x-lab.com" : "https://agent.7x.ae"}/api/payments/return`,
    },
    secretRefs: ["NGENIUS_API_KEY"],
  };

  let changed = 0;
  for (const j of def.journeys) {
    if (!JOURNEYS.includes(j.key)) continue;
    const sub = { ...(j.submission ?? {}), currency: "AED" } as Record<string, unknown>;
    const pct = feePercent();
    // Removed rather than left behind: a stale processingFee on the journey would
    // keep charging a percentage nobody asked for, silently.
    if (pct === null) delete sub.processingFee;
    else sub.processingFee = PROCESSING_FEE(pct);
    if (REQUIRE_PAYMENT) sub.requiresPayment = true;
    const fee = amount();
    if (fee !== null) sub.amount = fee;
    if (REQUIRE_PAYMENT && sub.amount === undefined && !(sub.apiFlow as { pricingTool?: string } | undefined)?.pricingTool) {
      throw new Error(
        `${j.key} would charge with no amount and no pricing tool: the payment would be AED 0, or the model would ` +
          `invent a licence fee. Pass --amount <n>, or wait for EPGL's fee schedule.`
      );
    }
    // Compare before counting it. A script that reports "written" on a re-run
    // that changed nothing teaches you to stop reading its output.
    const same = JSON.stringify(j.submission ?? {}) === JSON.stringify(sub);
    j.submission = sub;
    if (same) { console.log(`  (already) ${j.key}: amount ${sub.amount ?? "—"} ${sub.currency}, ${pct === null ? "no fee" : `${pct}% fee`}`); continue; }
    changed++;
    console.log(
      `  + ${j.key}: amount ${sub.amount ?? "—"} ${sub.currency}, ` +
        (pct === null ? "no processing fee" : `${pct}% processing fee`) +
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
