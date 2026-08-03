/**
 * Verification for the 2026-07-31 feedback round: asserts that every item is
 * really in place — in the stored agent definitions, in the rendered system
 * prompt, and in the code paths the fixes touch. Run after
 * apply-feedback-2026-07-31.ts, against whichever DATABASE_URL you want to check.
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";
import { AgentDefinition, emptyCase, type CaseState } from "@dialog/config";
import { buildSystemPrompt, evalCondition } from "@dialog/core";
import { maskName } from "../lib/pii";
import { displayValue } from "../app/embed/[agent]/Experience";

const checks: [string, boolean][] = [];
const check = (name: string, ok: boolean) => checks.push([name, ok]);

async function load(slug: string) {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, slug)).limit(1);
  if (!row) throw new Error(`${slug} not found`);
  return AgentDefinition.parse(row.definition);
}

async function main() {
  const nxn = await load("nxn-dialog");
  const epgl = await load("epgl-dialog");
  console.log("both definitions parse against the schema OK\n");

  // ── FB-1439 date format (code: platform prompt + panel + receipt) ──
  const p = buildSystemPrompt(nxn, emptyCase(), "en", true, true, undefined, undefined);
  check("FB-1439 prompt requires DD-MM-YYYY", p.stable.includes('"14-02-2027"'));
  check("FB-1439 prompt forbids month names", p.stable.includes('a month name ("14 Feb 2027")'));
  check("FB-1439 panel renders ISO as DD-MM-YYYY", displayValue("2027-02-14") === "14-02-2027");
  check("FB-1439 panel handles ISO timestamps", displayValue("2027-02-14T00:00:00") === "14-02-2027");
  check("FB-1439 panel leaves non-dates alone", displayValue("50500") === "50500");
  check(
    "FB-1439 no month-name examples left in guidance",
    !nxn.journeys.concat(epgl.journeys).some((j) => /\b\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4}\b/.test(j.guidance ?? ""))
  );

  // ── FB-1485 never re-prompt an authenticated customer ──
  const pAuth = buildSystemPrompt(nxn, emptyCase(), "en", true, true, undefined, undefined);
  const pGuest = buildSystemPrompt(nxn, emptyCase(), "en", false, true, undefined, undefined);
  check("FB-1485 authenticated prompt forbids re-sign-in", pAuth.stable.includes("Never ask them to sign in again"));
  check("FB-1485 guest prompt does not carry that rule", !pGuest.stable.includes("Never ask them to sign in again"));

  // ── FB-1430 key-delivery fee: on the option, and charged ──
  for (const jk of ["personal_po_box_rental", "corporate_po_box_rental"]) {
    const j = nxn.journeys.find((x) => x.key === jk)!;
    const opts = j.steps.flatMap((s) => s.fields).find((f) => f.key === "key_delivery")?.options ?? [];
    const deliver = opts.find((o) => o.value === "deliver");
    check(`FB-1430 ${jk}: fee shown on the option`, /25/.test(deliver?.label.en ?? "") && /25/.test(deliver?.label.ar ?? ""));
    const sur = j.submission?.surcharges ?? [];
    const fee = sur.find((s) => s.key === "key_delivery_fee");
    check(`FB-1430 ${jk}: surcharge declared`, fee?.amount === 25);
    check(`FB-1430 ${jk}: surcharge condition fires on delivery`, evalCondition(fee?.when, { key_delivery: "deliver" }));
    check(`FB-1430 ${jk}: surcharge dormant on pickup`, !evalCondition(fee?.when, { key_delivery: "branch_pickup" }));
    // The prompt must disclose it up front, and flag it once chosen.
    const state: CaseState = { ...emptyCase(), journeyKey: jk, data: { key_delivery: "deliver" } };
    const pj = buildSystemPrompt(nxn, state, "en", true, true, undefined, undefined);
    check(`FB-1430 ${jk}: prompt discloses the fee up front`, pj.volatile.includes("ADD-ON FEES you must disclose UP FRONT"));
    check(`FB-1430 ${jk}: prompt marks it applicable once chosen`, pj.volatile.includes("Currently applicable"));
    // The fee also has to reach the model ON the option it is choosing between —
    // the journey block lists enum choices with their labels for exactly this.
    check(`FB-1430 ${jk}: fee-bearing option reaches the model`, pj.volatile.includes("deliver (Deliver to address (AED 25 courier fee))"));
    check(`FB-1430 ${jk}: free option is labelled free`, pj.volatile.includes("branch_pickup (Collect from branch (free))"));
  }

  // ── FB-1445 Arabic parity: no English-only customer-facing label anywhere ──
  const missingAr: string[] = [];
  for (const def of [nxn, epgl]) {
    for (const i of def.intents) if (!i.description.ar) missingAr.push(`${def.slug} intent ${i.key}`);
    if (!def.greeting.ar) missingAr.push(`${def.slug} greeting`);
    for (const j of def.journeys) {
      if (!j.title.ar) missingAr.push(`${def.slug} journey ${j.key} title`);
      for (const s of j.steps) {
        if (!s.title.ar) missingAr.push(`${def.slug} ${j.key}/${s.key} title`);
        for (const f of s.fields) {
          if (!f.label.ar) missingAr.push(`${def.slug} field ${f.key}`);
          for (const o of f.options ?? []) if (!o.label.ar) missingAr.push(`${def.slug} option ${f.key}=${o.value}`);
        }
        for (const d of s.documents) if (!d.label.ar) missingAr.push(`${def.slug} document ${d.key}`);
      }
      for (const sc of j.submission?.surcharges ?? []) if (!sc.label.ar) missingAr.push(`${def.slug} surcharge ${sc.key}`);
    }
  }
  check(`FB-1445 every label is bilingual${missingAr.length ? ` (missing: ${missingAr.join(", ")})` : ""}`, missingAr.length === 0);

  // ── FB-1323 masked holder name in the requested shape ──
  check("FB-1323 mask keeps first + last letter", maskName("Mohammed Ali Alhabib") === "M******* A** ******b");
  check("FB-1323 mask preserves word count", maskName("Mohammed Ali Alhabib").split(" ").length === 3);
  check("FB-1323 single name keeps only its initial", maskName("Mohammed") === "M*******");
  check("FB-1323 renewal guidance uses the masked name", (nxn.journeys.find((j) => j.key === "personal_po_box_renewal")?.guidance ?? "").includes("masked"));

  // ── FB-1405 GSB is not claimed / FB-1404 auto-renew honesty / FB-1403 features ──
  const corp = nxn.journeys.find((j) => j.key === "corporate_po_box_rental")?.guidance ?? "";
  check("FB-1405 no GSB ownership check claimed", !/GSB-check/i.test(corp) && corp.includes("GSB ownership check is NOT integrated"));
  const anyNxnGuidance = nxn.journeys.map((j) => j.guidance ?? "").join("\n");
  check("FB-1404 auto-renew activation is not overclaimed", anyNxnGuidance.includes("Do NOT tell the customer auto-renewal is now active"));
  check("FB-1403 bundle features must come from the KB", anyNxnGuidance.includes("BUNDLE FEATURES"));

  // ── FB-1408/1409 proactive + predicted next step ──
  check("FB-1408/1409 proactive rules present", anyNxnGuidance.includes("PROACTIVE, NOT PUSHY"));

  // ── FB-1486 short one-line service buttons ──
  const labels = [...(epgl.greeting.en.matchAll(/^- (.+)$/gm))].map((m) => m[1]!.trim());
  check("FB-1486 greeting still offers three services", labels.length === 3);
  check("FB-1486 each button label is short", labels.every((l) => l.length <= 16));

  // ── FB-1447 application wording + postal license number ──
  const renewalFields = epgl.journeys.find((j) => j.key === "renewal")?.steps.flatMap((s) => s.fields) ?? [];
  const postal = renewalFields.find((f) => f.key === "postal_license_number");
  check("FB-1447 postal license number is required on renewal", postal?.validation.required === true);

  // ── FB-1327 issued license surfaced, payment not promised in chat ──
  const epglGuidance = epgl.journeys.map((j) => j.guidance ?? "").join("\n");
  check("FB-1327 issued license number surfaced from status", epglGuidance.includes("ISSUED LICENSE IN CHAT"));
  check("FB-1327 chat does not promise to take payment", epglGuidance.includes("PAYMENT IS NOT TAKEN IN THIS CHAT"));

  let fail = 0;
  for (const [name, ok] of checks) {
    console.log(` ${ok ? "PASS" : "FAIL"}  ${name}`);
    if (!ok) fail++;
  }
  console.log(`\n${checks.length - fail}/${checks.length} checks passed.`);
  if (fail) throw new Error(`${fail} check(s) failed`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
