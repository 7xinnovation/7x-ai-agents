/**
 * A conditional document counts toward readiness (4 November 2026).
 *
 * LR-54115: the panel read 26/26 ready and the application was submitted and
 * paid with six of thirteen documents uploaded. EPGL hold one. Every slot their
 * catalogue contributes is `conditional` — the lease, the SME licence, the
 * initial name approval, the operational standards declaration — and readiness
 * counted `mandatory` alone, so none of them was ever in `readiness.missing`,
 * which is the list the model asks from.
 *
 * Run from apps/web:  npx tsx scripts/test-conditional-documents-2026-11-04.ts
 */
import { recomputeReadiness } from "@dialog/core";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : `\n       ${JSON.stringify(got)}`}`); }
};

/** The real CEP30 shape: our own slots mandatory, the catalogue's conditional. */
const doc = (key: string, requirement: string, condition?: string, validityRequired = false) =>
  ({ key, label: { en: key }, requirement, condition, acceptedFormats: ["pdf"], maxSizeMb: 10, validityRequired });

const AGENT = {
  name: "t", slug: "t", locales: ["en"], intents: [], guardrails: {}, integrations: {},
  journeys: [{
    key: "new_license", title: { en: "New licence" }, intent: "apply",
    steps: [{
      key: "documents", title: { en: "Documents" },
      fields: [],
      documents: [
        doc("trade_license", "mandatory"),
        doc("beneficial_ownership_declaration", "mandatory"),
        doc("lease_contract", "conditional", "product_family == 'CEP30'", true),
        doc("sme_licence_federal_or_local_government", "conditional", "product_is_sme", true),
        doc("trade_licence_initial_name_approval", "conditional", "product_family == 'CEP30'", true),
        doc("municipal_food_safety_clearance", "conditional", "product_family == 'FOODMED'"),
        doc("insurance_certificate_goods_in_transit", "optional", "product_family == 'CEP30'"),
        doc("operational_fleet_declaration", "optional", "product_family == 'CEP30'"),
        doc("legacy_slot", "conditional"), // conditional with NO condition
      ],
    }],
    submission: { amount: 1000, currency: "AED", requiresPayment: true, apiFlow: {} },
  }],
} as never;

const uploaded = (key: string, validTo?: string) =>
  ({ key, status: "uploaded", fileName: `${key}.pdf`, ...(validTo ? { validTo } : {}) });

const run = (data: Record<string, unknown>, docs: unknown[]) =>
  recomputeReadiness(AGENT, {
    caseId: "c1", journeyKey: "new_license", status: "draft",
    data, documents: docs,
    payment: { status: "none", reference: null, amount: null, currency: "AED", link: null, baseAmount: null },
    history: [],
  } as never);

const missingOf = (s: ReturnType<typeof run>) => s.readiness.missing.map((m) => m.key);

console.log("\nthe application that said 26/26 with six documents in");
const CEP30 = { product_family: "CEP30", product_is_sme: true };
const asFiled = run(CEP30, [uploaded("trade_license"), uploaded("beneficial_ownership_declaration")]);
check("it is NOT complete", !asFiled.readiness.complete, asFiled.readiness);
check("the lease is named", missingOf(asFiled).includes("lease_contract"), missingOf(asFiled));
check("the SME licence is named", missingOf(asFiled).includes("sme_licence_federal_or_local_government"));
check("the initial name approval is named", missingOf(asFiled).includes("trade_licence_initial_name_approval"));
check("the status is draft, not ready", asFiled.status === "draft", asFiled.status);

console.log("\nand what it still must not ask for");
check("a FOODMED document on a CEP30 application", !missingOf(asFiled).includes("municipal_food_safety_clearance"), missingOf(asFiled));
check("an optional one, condition or not", !missingOf(asFiled).includes("insurance_certificate_goods_in_transit"));
check("...nor the optional fleet declaration", !missingOf(asFiled).includes("operational_fleet_declaration"));
check("a conditional slot with NO condition stays inert",
  !missingOf(asFiled).includes("legacy_slot"), missingOf(asFiled));
check("the two already in are not asked for again",
  !missingOf(asFiled).includes("trade_license") && !missingOf(asFiled).includes("beneficial_ownership_declaration"));

console.log("\na different product asks for different documents");
const foodmed = run({ product_family: "FOODMED", product_is_sme: false },
  [uploaded("trade_license"), uploaded("beneficial_ownership_declaration")]);
check("FOODMED asks for the food safety clearance", missingOf(foodmed).includes("municipal_food_safety_clearance"), missingOf(foodmed));
check("...and not for the CEP30 lease", !missingOf(foodmed).includes("lease_contract"), missingOf(foodmed));
check("...nor the SME licence it does not need", !missingOf(foodmed).includes("sme_licence_federal_or_local_government"));

console.log("\nthe whole set in, which is the point");
const all = run(CEP30, [
  uploaded("trade_license"),
  uploaded("beneficial_ownership_declaration"),
  uploaded("lease_contract", "2034-01-01"),
  uploaded("sme_licence_federal_or_local_government", "2034-01-01"),
  uploaded("trade_licence_initial_name_approval", "2034-01-01"),
]);
check("now it is complete", all.readiness.complete, all.readiness.missing);
check("...and the status is ready", all.status === "ready", all.status);

console.log("\na file with no expiry is still not a document that is in");
const noDate = run(CEP30, [
  uploaded("trade_license"),
  uploaded("beneficial_ownership_declaration"),
  uploaded("lease_contract"), // validityRequired, no validTo
  uploaded("sme_licence_federal_or_local_government", "2034-01-01"),
  uploaded("trade_licence_initial_name_approval", "2034-01-01"),
]);
check("the lease is still outstanding", missingOf(noDate).includes("lease_contract"), missingOf(noDate));
check("...and nothing else is", missingOf(noDate).length === 1, missingOf(noDate));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
