/**
 * "Non Resident" is the customer's word, not an inference from a passport.
 *
 * It is the one value in the EPGL journey that REMOVES a mandatory document, so
 * it is the one the model must not reach on its own. On the first full run after
 * the non-resident option was added, a British partner was marked Non Resident
 * and the application submitted without her Emirates ID — LR-37340, 13 September,
 * with partner_3_nationality "United Kingdom" and nobody having said she lives
 * abroad. The guidance said in capitals not to infer it from nationality.
 *
 * Run from apps/web:  npx tsx scripts/test-non-resident-claim-2026-09-13.ts
 */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : `\n         ${JSON.stringify(got)}`}`); }
};

const src = readFileSync(new URL("../../../packages/core/src/ai/tools.ts", import.meta.url), "utf8");
// The real predicate, not a copy of it.
const { saysNonResident } = await import("@dialog/core");

console.log("\nThings a customer says that DO mean it");
for (const m of [
  "This partner lives outside the UAE",
  "she is a non-resident",
  "He lives abroad",
  "Partner 3 is based overseas",
  "She doesn't have an Emirates ID",
  "he has no emirates id",
  "الشريك غير مقيم في الدولة",
  "تعيش خارج الدولة",
  "لا يملك هوية إماراتية",
]) check(`"${m}"`, saysNonResident(m), m);

console.log("\nThings that do NOT");
for (const m of [
  "Her passport is British",
  "Partner 3 is Valentina Mintah",
  "She is from the United Kingdom",
  "Nationality: Ghana",
  "yes",
  "carry on",
  "",
  undefined,
]) check(`${JSON.stringify(m)}`, !saysNonResident(m as string), m);

console.log("\nThe guard itself");
{
  const g = src.slice(src.indexOf('case "collect_field"'), src.indexOf('case "collect_field"') + 2600);
  check("it fires on the residence field", /\^partner_\\d\+_residence\$/.test(g));
  check("...only for the value that waives a document", /=== "non resident"/.test(g));
  check("...and refuses rather than recording", /NOT RECORDED/.test(g) && /isError: true/.test(g));
  check("re-recording an existing value is allowed", /const already = String\(state\.data\[fieldKey\]/.test(g));
  check("the refusal tells the model what to do instead", /this partner lives outside the UAE/.test(g));
  check("Citizen and Resident are untouched", !/=== "citizen"/.test(g) && !/=== "resident"/.test(g));

  const orch = readFileSync(new URL("../../../packages/core/src/ai/orchestrator.ts", import.meta.url), "utf8");
  check("the turn's message reaches the tool layer", /userMessage: input\.userMessage,/.test(orch));
  check("...and is declared on the input", /userMessage\?: string;/.test(src));
}

console.log("\nAnd a document is never asked for it either");
{
  const ex = readFileSync(new URL("../../../packages/core/src/ai/extract.ts", import.meta.url), "utf8");
  check("residence is not offered to the extractor", /if \(\/_residence\$\/\.test\(f\.key\)\) continue;/.test(ex));
  check("...nor is the payment method", /if \(f\.key === "payment_method"\) continue;/.test(ex));
  check("consent fields are still excluded as before", /f\.type === "boolean" \|\|/.test(ex));

  // The real selector, against a journey shaped like EPGL's.
  const { extractionFieldsFor } = await import("@dialog/core");
  const journey = {
    key: "new_license",
    steps: [{
      key: "company_details",
      fields: [
        { key: "company_name", label: { en: "Company name" }, type: "text", validation: { required: true } },
        { key: "partner_1_nationality", label: { en: "Partner 1 nationality" }, type: "text", validation: { required: false } },
        { key: "partner_1_residence", label: { en: "Partner 1 residence" }, type: "enum", options: [{ value: "Citizen", label: { en: "Citizen" } }], validation: { required: false } },
        { key: "payment_method", label: { en: "Payment method" }, type: "enum", options: [{ value: "viban", label: { en: "IBAN" } }], validation: { required: false } },
        { key: "declaration_accepted", label: { en: "Declaration" }, type: "boolean", validation: { required: true } },
      ],
      documents: [],
    }],
  };
  const keys = extractionFieldsFor({ journeys: [journey] } as never, { journeyKey: "new_license" } as never, "en").map((f: { key: string }) => f.key);
  check("the company name is still extracted", keys.includes("company_name"), keys);
  check("nationality is still extracted — it IS printed", keys.includes("partner_1_nationality"), keys);
  check("residence is not", !keys.includes("partner_1_residence"), keys);
  check("the payment method is not", !keys.includes("payment_method"), keys);
  check("the declaration is not", !keys.includes("declaration_accepted"), keys);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
