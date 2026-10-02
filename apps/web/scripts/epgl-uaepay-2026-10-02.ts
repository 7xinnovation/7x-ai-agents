/**
 * UAEPay as EPGL's third way to pay (2026-10-02).
 *
 * The licence fee is AED 100,000. Today there are two routes and they cost
 * different amounts:
 *
 *   Card (gateway)        100,000 + 1,000 online payment fee = 101,000
 *   Virtual IBAN (viban)  100,000, raised by Finance with the bank
 *
 * UAEPay joins them at 100,000 — **no online payment fee**, by Emre's decision
 * on 2 October. That needs no change to the surcharge at all: its condition is
 * literally `payment_method == 'gateway'`, so a third value simply does not
 * match it. The fee stays on card, where it was.
 *
 * What this script does, and nothing more:
 *   1. binds `paymentMethods.uaepay` to the uaepay adapter, so a payment whose
 *      method is "uaepay" goes to UAEPay while card keeps going to N-Genius;
 *   2. adds the third option to the journey's payment_method field;
 *   3. states the three prices in the guidance, because a model that has to
 *      infer which of three options carries a fee will eventually infer wrong.
 *
 * NOT RUN ON STAGING OR PRODUCTION. This lives on the `uae-pay` branch with the
 * rest of it. When it is time:
 *   npx tsx scripts/epgl-uaepay-2026-10-02.ts --env <file> [--dry-run]
 *
 * It needs UAEPAY_CLIENT_ID and UAEPAY_CLIENT_SECRET in the app settings of
 * whichever environment it is run against. The UAT credentials work only
 * against uat-api.uaepay.ae — production returns INVALID_CLIENT_CREDENTIALS, so
 * a production run needs its own onboarding first.
 */
import { databaseUrlFrom } from "./lib/envFile";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { agents } from "@dialog/db";
import { eq } from "drizzle-orm";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const ENV = arg("--env");
if (!ENV) throw new Error("--env <envfile> is required");
const DRY = process.argv.includes("--dry-run");
const BASE_URL = arg("--base-url") ?? "https://uat-api.uaepay.ae";
const MERCHANT = arg("--merchant") ?? "MR123093";
const SLUG = "epgl-dialog";
const METHOD = "uaepay";

const BINDING = {
  provider: "uaepay",
  settings: { baseUrl: BASE_URL, merchantCode: MERCHANT, returnUrl: "" as string },
  secretRefs: ["UAEPAY_CLIENT_ID", "UAEPAY_CLIENT_SECRET"],
};

/** The option as the customer sees it, in both languages. */
const OPTION = { value: METHOD, label: { en: "UAEPay", ar: "يوإي باي" } };

const GUIDANCE =
  " UAEPAY IS THE THIRD WAY TO PAY, and it costs LESS than the card: the licence fee is AED 100,000 and UAEPay adds no online payment fee, so a UAEPay payment is AED 100,000 while a card payment is AED 101,000." +
  " State all three prices when you present the choice — card AED 101,000, UAEPay AED 100,000, Virtual IBAN AED 100,000 — rather than mentioning the fee only after they have chosen." +
  " UAEPay is for SIGNED-IN applicants only: it requires the payer's Emirates ID, which comes from their UAE PASS sign-in and is never something to ask them for. If the applicant is not signed in, offer card and Virtual IBAN only and do not mention UAEPay.";

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrlFrom(ENV!) });
  const db = drizzle(pool, { schema: { agents } });
  try {
    const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG));
    if (!row) throw new Error(`No agent ${SLUG} in this database`);
    const def = JSON.parse(JSON.stringify(row.definition)) as Record<string, any>;
    let changes = 0;

    // 1. The binding.
    def.integrations ??= {};
    def.integrations.paymentMethods ??= {};
    const binding = { ...BINDING, settings: { ...BINDING.settings } };
    /**
     * Where UAEPay sends the customer back to. Taken from the agent's own
     * public host rather than typed, so staging never returns a customer to
     * production: the two environments' returns must not cross.
     */
    const host = String(def.publicHost ?? process.env.PUBLIC_APP_URL ?? "").replace(/\/$/, "");
    binding.settings.returnUrl = host ? `${host}/api/payments/return` : "";
    if (!binding.settings.returnUrl) {
      throw new Error("No public host on the agent and no PUBLIC_APP_URL — a payment with no return URL strands the customer on UAEPay's page");
    }
    const before = JSON.stringify(def.integrations.paymentMethods[METHOD] ?? null);
    if (before !== JSON.stringify(binding)) {
      console.log(`  ${def.integrations.paymentMethods[METHOD] ? "~" : "+"} integrations.paymentMethods.${METHOD} -> ${binding.provider} (${MERCHANT} at ${BASE_URL})`);
      def.integrations.paymentMethods[METHOD] = binding;
      changes++;
    } else {
      console.log(`  (already) integrations.paymentMethods.${METHOD}`);
    }

    // 2. The option on the field the journey already has, and 3. the wording.
    let seenField = 0;
    for (const j of def.journeys ?? []) {
      if (!/renew|new_license/i.test(String(j.key ?? ""))) continue;
      for (const step of j.steps ?? []) {
        for (const f of step.fields ?? []) {
          if (f.key !== "payment_method") continue;
          seenField++;
          const options = Array.isArray(f.options) ? f.options : [];
          if (options.some((o: any) => (typeof o === "string" ? o : o?.value) === METHOD)) {
            console.log(`  (already) ${j.key}: payment_method has ${METHOD}`);
          } else {
            // Match whatever shape the existing options use rather than
            // imposing one: a field whose options are plain strings gets a
            // string, and the model reads the label from the guidance.
            f.options = [...options, typeof options[0] === "string" ? METHOD : OPTION];
            console.log(`  ~ ${j.key}: payment_method += ${METHOD}`);
            changes++;
          }
        }
      }
      const g = String(j.guidance ?? "");
      if (g && !g.includes("UAEPAY IS THE THIRD WAY TO PAY")) {
        j.guidance = g + GUIDANCE;
        console.log(`  ~ ${j.key}: guidance states all three prices`);
        changes++;
      }
    }
    if (!seenField) throw new Error("No payment_method field found on a renewal or new-licence journey — nothing would select UAEPay");

    if (!changes) { console.log("\nAlready applied — nothing to change."); return; }
    if (DRY) { console.log(`\n--dry-run: ${changes} change(s) NOT written.`); return; }
    await db.update(agents).set({ definition: def as unknown as typeof row.definition }).where(eq(agents.id, row.id));
    console.log(`\n${changes} change(s) written.`);
  } finally {
    await pool.end();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
