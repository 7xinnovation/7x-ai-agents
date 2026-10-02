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
 *   1. binds `paymentGateways.uaepay` to the uaepay adapter, so a payment whose
 *      method is "uaepay" goes to UAEPay while card keeps going to N-Genius;
 *   2. adds the third option to the journey's payment_method field;
 *   3. states the three prices in the guidance, because a model that has to
 *      infer which of three options carries a fee will eventually infer wrong.
 *
 * NOT RUN ON STAGING OR PRODUCTION. This lives on the `uae-pay` branch with the
 * rest of it. When it is time:
 *   npx tsx scripts/epgl-uaepay-2026-10-02.ts --env <file> --host https://… [--dry-run]
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
/**
 * Where UAEPay sends the customer back to. Given rather than guessed: staging
 * returning a customer to production is the kind of mistake that is invisible
 * until somebody's payment lands in the wrong environment.
 */
const HOST = (arg("--host") ?? "").replace(/\/$/, "");
const SLUG = "epgl-dialog";
const METHOD = "uaepay";

const BINDING = {
  provider: "uaepay",
  settings: { baseUrl: BASE_URL, merchantCode: MERCHANT, returnUrl: "" as string },
  secretRefs: ["UAEPAY_CLIENT_ID", "UAEPAY_CLIENT_SECRET"],
};

/** The option as the customer sees it, in both languages. */
const OPTION = { value: METHOD, label: { en: "UAEPay", ar: "يوإي باي" } };

/**
 * THE PRICES ARE READ FROM THE JOURNEY, NOT TYPED IN.
 *
 * The first version wrote "AED 100,000" into the guidance. That is true on
 * production and false on staging, whose base is deliberately 1,000 so nobody
 * is shown a live fee — so the chat offered "UAEPay — AED 100,000" and opened a
 * checkout for AED 1,000. A model stating a figure the gateway then contradicts
 * is the exact failure the surcharge plumbing exists to prevent.
 *
 * So the three figures are computed from what this environment is configured to
 * charge: the journey's own amount, plus the online-payment surcharge for the
 * card route only.
 */
const money = (n: number) => `AED ${n.toLocaleString("en-US")}`;

function guidanceFor(base: number, onlineFee: number): string {
  const card = base + onlineFee;
  return (
    ` UAEPAY IS THE THIRD WAY TO PAY, and it costs LESS than the card: the licence fee is ${money(base)} and UAEPay adds no online payment fee, so a UAEPay payment is ${money(base)} while a card payment is ${money(card)}.` +
    ` State all three prices when you present the choice — card ${money(card)}, UAEPay ${money(base)}, Virtual IBAN ${money(base)} — rather than mentioning the fee only after they have chosen.` +
    ` UAEPay is for SIGNED-IN applicants only: it requires the payer's Emirates ID, which comes from their UAE PASS sign-in and is never something to ask them for. If the applicant is not signed in, offer card and Virtual IBAN only and do not mention UAEPay.`
  );
}

/** Any earlier run's wording, so a re-run replaces rather than stacks. */
const MARKER = "UAEPAY IS THE THIRD WAY TO PAY";

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
    def.integrations.paymentGateways ??= {};
    const binding = { ...BINDING, settings: { ...BINDING.settings } };
    /**
     * Where UAEPay sends the customer back to. Taken from the agent's own
     * public host rather than typed, so staging never returns a customer to
     * production: the two environments' returns must not cross.
     */
    const host = HOST || String(def.publicHost ?? process.env.PUBLIC_APP_URL ?? "").replace(/\/$/, "");
    binding.settings.returnUrl = host ? `${host}/api/payments/return` : "";
    if (!binding.settings.returnUrl) {
      throw new Error("Pass --host https://… — a payment with no return URL strands the customer on UAEPay's page");
    }
    /**
     * FIELD BY FIELD, because jsonb does not keep your key order.
     *
     * Postgres stores jsonb with its own ordering, so the binding comes back as
     * {provider, secretRefs, settings} however it went in, and comparing the
     * two as strings reports a change on every run for ever. The 23 September
     * fee script learned this and this one repeated it: the second run wrote
     * the identical binding again.
     */
    const had = (def.integrations.paymentGateways[METHOD] ?? {}) as Record<string, any>;
    const same =
      had.provider === binding.provider &&
      JSON.stringify([...(had.secretRefs ?? [])].sort()) === JSON.stringify([...binding.secretRefs].sort()) &&
      (["baseUrl", "merchantCode", "returnUrl"] as const).every((k) => (had.settings ?? {})[k] === binding.settings[k]);
    if (!same) {
      console.log(`  ${def.integrations.paymentGateways[METHOD] ? "~" : "+"} integrations.paymentGateways.${METHOD} -> ${binding.provider} (${MERCHANT} at ${BASE_URL})`);
      def.integrations.paymentGateways[METHOD] = binding;
      changes++;
    } else {
      console.log(`  (already) integrations.paymentGateways.${METHOD}`);
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
      /**
       * What this environment actually charges. `submission.amount` is the
       * licence fee; the online fee is the surcharge gated on the card route,
       * which is why UAEPay and Virtual IBAN do not carry it.
       */
      const sub = (j.submission ?? {}) as Record<string, any>;
      const base = Number(sub.amount);
      const fee = Number(
        (Array.isArray(sub.surcharges) ? sub.surcharges : []).find((x: any) => x?.key === "online_payment_fee")?.amount ?? 0
      );
      if (!Number.isFinite(base) || base <= 0) {
        throw new Error(`${j.key}: no chargeable amount on the journey — the guidance would state a price nothing charges`);
      }
      const wanted = guidanceFor(base, fee);
      const g = String(j.guidance ?? "");
      if (g && !g.includes(wanted)) {
        // Cut any earlier run's sentence before appending, so re-running with a
        // changed price corrects it instead of leaving two prices in one prompt.
        const at = g.indexOf(MARKER);
        const head = at === -1 ? g : g.slice(0, g.lastIndexOf(" ", at));
        j.guidance = head + wanted;
        console.log(`  ~ ${j.key}: guidance states ${money(base + fee)} card / ${money(base)} UAEPay / ${money(base)} VIBAN`);
        changes++;
      } else if (g) {
        console.log(`  (already) ${j.key}: guidance`);
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
