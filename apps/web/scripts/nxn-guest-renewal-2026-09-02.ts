/**
 * Map the guest renewal onto the endpoints that exist (2026-09-02).
 *
 * Guest/Renewal/Save answered 500 on 2 Sep with a body carrying only the box,
 * the date and the amount. Their own guest flow asks for more before it will
 * take a payment: who is renewing (GetRenewedByOptions), the subscriber's name,
 * mobile and email, and a billing address — customerKYC and
 * paymentProperties.billingDetail. The journey collected almost none of it.
 *
 * Also fixed here:
 *  - saveTool was "post_api_Guest_Renewal_Save" with no integration prefix, so it
 *    never matched a real tool name and the submission was never recorded.
 *  - Guest/Renewal/ConfirmPayment exists and was disabled, so a guest renewal had
 *    no way to confirm the payment on Emirates Post's own gateway — the same gap
 *    that left rental orders unpaid until 31 Aug.
 *  - a guest has no account, so "save my card" and "auto-renewal" are not offered.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/nxn-guest-renewal-2026-09-02.ts [--env <file>]
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

import { getDb, agents, agentIntegrations } from "@dialog/db";
import { eq } from "drizzle-orm";

const SLUG = "nxn-dialog";
const JOURNEYS = ["personal_po_box_renewal", "corporate_po_box_renewal"];
const MARKER = "GUEST RENEWAL, MAPPED (2026-09-02)";

const SAVE = "nxnstaging__post_api_Guest_Renewal_Save";
const CONFIRM = "nxnstaging__post_api_Guest_Renewal_ConfirmPayment";
const RETURN_URL = "https://7xagents.7x-lab.com/api/payments/ext-return";

/** Fields the guest flow needs and the journey did not collect. */
const FIELDS = [
  { key: "emirate", type: "enum", en: "Emirate of the PO Box", ar: "إمارة صندوق البريد",
    options: [["AUH","Abu Dhabi","أبوظبي"],["DXB","Dubai","دبي"],["SHJ","Sharjah","الشارقة"],["AJM","Ajman","عجمان"],["UAQ","Umm Al Quwain","أم القيوين"],["RAK","Ras Al Khaimah","رأس الخيمة"],["FUJ","Fujairah","الفجيرة"]] },
  { key: "renewed_by", type: "text", en: "Who is renewing this box", ar: "من يقوم بالتجديد" },
  { key: "subscriber_first_name", type: "text", en: "First name", ar: "الاسم الأول" },
  { key: "subscriber_last_name", type: "text", en: "Last name", ar: "اسم العائلة" },
  { key: "subscriber_mobile", type: "phone", en: "Mobile number", ar: "رقم الهاتف المتحرك" },
  { key: "subscriber_email", type: "email", en: "Email address", ar: "البريد الإلكتروني" },
  { key: "billing_area", type: "text", en: "Billing address — area", ar: "عنوان الفوترة — المنطقة" },
  { key: "billing_street", type: "text", en: "Billing address — street", ar: "عنوان الفوترة — الشارع" },
];

const GUEST_ONLY_REMOVE = ["save_card_consent", "auto_renew_consent"];

const NOTE = `

${MARKER}: this journey runs for a customer who is NOT signed in, so it uses the Guest endpoints and only those.
THE ORDER, which mirrors their own quick-renewal flow: 1) ask the EMIRATE and the BOX NUMBER, then call the details tool with both. 2) Show what comes back for confirmation — box number, subscriber, expiry, emirate, current bundle. 3) If poBoxSubscriptionDetails.listPossibleBundles has entries, OFFER the upgrade as cards (current bundle first, marked as theirs) and let them keep the current one; set isBundleChanged and newBundleId from what they pick. 4) Ask how long, from the permitted expiry dates, and price it with the pricing tool. 5) Take the SUBSCRIBER details: who is renewing (from the renewed-by options tool — send its numeric key, not the label), first name, last name, mobile, email, and a billing area and street. 6) Only then save.
SEND ON THE SAVE: boxNumber, emirateCode, expiryDate, newBundleId, isBundleChanged, totalAmount, requestSource, renewedBy (the key), and customerKYC { firstName, lastName, email, mobileNumber, renewalUserCapacity, area, address1 }. paymentProperties is completed for you. A save without customerKYC is refused before it is sent — Emirates Post answers 500 to it and the 500 names nothing.
NEVER offer to save a card or to enable auto-renewal here. A guest has no Emirates Post account to save either against, and the toggles are not shown for this journey.
PAYMENT: the save returns a payment URL on Emirates Post's own gateway. Give the customer that URL, then confirm with the confirm tool once they say they have paid, exactly as the rental does. Do not use the internal checkout.`;

interface Journey {
  key: string;
  requiresAuth?: boolean;
  steps?: { key: string; fields?: Record<string, unknown>[] }[];
  submission?: { apiFlow?: Record<string, unknown> };
  [k: string]: unknown;
}

async function main() {
  const db = getDb();

  // 1. The confirm endpoint has to exist as a tool before it can be named.
  const rows = await db.select().from(agentIntegrations);
  for (const row of rows) {
    if (!/nxn/i.test(row.name)) continue;
    const envs = row.environments as Record<string, { operations?: Record<string, unknown>[] }>;
    let touched = false;
    for (const [envName, spec] of Object.entries(envs)) {
      for (const op of spec.operations ?? []) {
        if (!/Guest\/Renewal\/ConfirmPayment/i.test(String(op.path))) continue;
        if (op.enabled === true) continue;
        op.enabled = true;
        touched = true;
        console.log(`  + ${row.name}/${envName}: enabled ${op.path}`);
      }
    }
    if (touched) await db.update(agentIntegrations).set({ environments: envs as never }).where(eq(agentIntegrations.id, row.id));
  }

  const [agent] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!agent) throw new Error(`${SLUG} not found`);
  const def = agent.definition as unknown as { journeys: Journey[] };
  let changed = 0;

  for (const j of def.journeys) {
    if (!JOURNEYS.includes(j.key)) continue;
    let touched = false;
    const step = (j.steps ?? [])[0];
    if (!step) { console.log(`  ! ${j.key} has no steps`); continue; }
    step.fields = step.fields ?? [];

    // A guest has no account: nothing to save a card to, nothing to auto-renew.
    const before = step.fields.length;
    step.fields = step.fields.filter((f) => !GUEST_ONLY_REMOVE.includes(String(f.key)));
    if (step.fields.length !== before) {
      touched = true;
      console.log(`  + ${j.key}: removed the account-only toggles`);
    }

    for (const f of FIELDS) {
      if (step.fields.some((x) => x.key === f.key)) continue;
      step.fields.push({
        key: f.key,
        type: f.type,
        label: { en: f.en, ar: f.ar },
        ...(f.options
          ? { options: f.options.map(([value, en, ar]) => ({ value, label: { en, ar } })) }
          : {}),
        validation: { required: false },
      });
      touched = true;
      console.log(`  + ${j.key}.${step.key}.${f.key}`);
    }

    const flow = j.submission?.apiFlow;
    if (flow) {
      if (flow.saveTool !== SAVE) {
        console.log(`  + ${j.key}: saveTool ${String(flow.saveTool)} -> ${SAVE}`);
        flow.saveTool = SAVE;
        touched = true;
      }
      if (flow.confirmTool !== CONFIRM) {
        flow.confirmTool = CONFIRM;
        flow.paymentReturnUrl = RETURN_URL;
        touched = true;
        console.log(`  + ${j.key}: confirmTool set — payment moves to their gateway`);
      }
      if (!String(flow.notes ?? "").includes(MARKER)) {
        flow.notes = String(flow.notes ?? "") + NOTE;
        touched = true;
        console.log(`  + ${j.key}: apiFlow notes`);
      }
    }
    if (touched) changed++;
  }

  if (!changed) { console.log("no journey changes"); return; }
  await db.update(agents).set({ definition: def as never }).where(eq(agents.id, agent.id));
  console.log(`\n${changed} journey(s) updated.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
