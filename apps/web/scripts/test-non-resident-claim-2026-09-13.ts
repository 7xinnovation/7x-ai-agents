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

/**
 * One `case` arm of the tool dispatcher, bounded by the next one.
 *
 * It used to be a fixed slice of N characters, and adding six hundred to
 * collect_field pushed the lines being tested out of the window — the third time
 * a fixed slice has failed that way (test-branch-location, 10 September).
 */
function caseBlock(src: string, name: string): string {
  const from = src.indexOf(`case "${name}"`);
  const next = src.indexOf('\n    case "', from + 10);
  return src.slice(from, next === -1 ? src.length : next);
}

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
  const g = caseBlock(src, "collect_field");
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

console.log("\nOr the registry said so, which is better evidence than asking");
{
  const { sameHuman } = await import("@dialog/core");
  check("the same name, spelled the same", sameHuman("Salah Salem Omair Alshamsi", "Salah Salem Omair Alshamsi"));
  check("...with punctuation and case moved about", sameHuman("SALAH SALEM OMAIR AL-SHAMSI", "salah salem omair alshamsi"));
  check("a shorter form of the same name", sameHuman("Salah Salem Omair Alshamsi", "Salah Salem Omair"));
  check("an Arabic name matches itself", sameHuman("صلاح سالم عمير", "صلاح سالم عمير"));
  check("a different person does not", !sameHuman("Salah Salem Omair Alshamsi", "Valentina Mintah"));
  check("initials are not a name", !sameHuman("A B", "Abdelaziz Mohamed Obaid"));

  const src = readFileSync(new URL("../../../packages/core/src/ai/tools.ts", import.meta.url), "utf8");
  const g = caseBlock(src, "collect_field");
  check("the guard consults the registry", /ctx\.registryNonResidents\?\.\(\)/.test(g));
  check("...matched against the name held for THAT partner", /partner_\$\{slot\}_name/.test(g));
  check("...and a partner with no name on file cannot be claimed", /partnerName\s*\?/.test(g));
  check("the customer's own words still work", /saysNonResident\(ctx\.userMessage\)/.test(g));

  const route = readFileSync(new URL("../app/api/chat/route.ts", import.meta.url), "utf8");
  const peopleBlock = route.slice(route.indexOf('...(holder === "match"'), route.indexOf('...(holder === "match"') + 1400);
  check("only licences the registry names them on contribute", /isUaeResident\?: boolean \}\)\.isUaeResident === false/.test(peopleBlock), peopleBlock.slice(0, 120));
  check("...and it is request-scoped, not written to the case", /writing to it from a tool handler would race/.test(route));
  check("the getter reaches the turn", /registryNonResidents: \(\) => \[\.\.\.registryNonResidents\]/.test(route));
}

console.log("\nThe activities and the people reach the model at all");
{
  const route = readFileSync(new URL("../app/api/chat/route.ts", import.meta.url), "utf8");
  check("activities are returned with their codes", /activities: l\.activities\.length/.test(route));
  check("...in both languages", /nameEn: x\.nameEn, nameAr: x\.nameAr/.test(route));
  check("owners and managers both count as people", /\[\.\.\.l\.owners, \.\.\.l\.managers\]/.test(route));
  check("...with the registry's residency statement", /isUaeResident: \(pp as \{ isUaeResident\?: boolean \}\)\.isUaeResident/.test(route));
  check("the model is told not to ask for the activities", /do NOT ask which postal services they provide/.test(route));
  check("...nor to read an identity number back in full", /NEVER read an Emirates ID or passport number back to the customer in full/.test(route));
  check("...and that an unnamed partner is still collected normally", /Anyone the registry does not name is still collected from the customer as usual/.test(route));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
