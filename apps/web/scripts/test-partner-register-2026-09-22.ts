/**
 * The company's register is not the assistant's to edit.
 *
 * Reported 22 September, from a deliberate attempt to break it: a sole
 * establishment whose trade licence names OBAID SAEED OBAID KHALFAN BIN JARSH
 * as its only partner, and Valentina Mintah's Emirates ID uploaded against
 * partner 1. The card was accepted. The case panel then read
 *
 *   Partner 1 — full name            Valentina Mintah
 *   Partner 1 — full name in Arabic  فالنتينا مينتاه
 *   Partner 1 — nationality          United Kingdom (Uk)
 *   Owner Emirates ID                ...505-0
 *
 * and the assistant, having noticed the mismatch and said so, offered a button
 * reading "Valentina Mintah is the correct partner".
 *
 * Three separate holes, one incident, so three parts below.
 *
 *   1. The EXTRACTION was told to write the cardholder's name and nationality
 *      into the owner fields. Written for the ordinary case where the cardholder
 *      IS the owner, and blind to the case where they are not.
 *   2. The CHECK had nothing to compare against. A sole establishment's single
 *      partner is printed as the OWNER, so `partner_1_name` was empty, and an
 *      empty slot returned "clear" for anybody's card.
 *   3. Nothing stopped the swap being CONFIRMED. No rule forbade the offer, and
 *      collect_field would have written her in.
 *
 * Run from apps/web:  npx tsx scripts/test-partner-register-2026-09-22.ts
 */
import { readFileSync } from "node:fs";
import { partnerDocumentCheck } from "../lib/docIdentity";
import { RECORD_IDENTITY } from "../../../packages/core/src/ai/extract";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, got?: unknown) {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`); }
}

const extract = readFileSync(new URL("../../../packages/core/src/ai/extract.ts", import.meta.url), "utf8");
const tools = readFileSync(new URL("../../../packages/core/src/ai/tools.ts", import.meta.url), "utf8");
const prompt = readFileSync(new URL("../../../packages/core/src/ai/prompt.ts", import.meta.url), "utf8");
/** The words the vision model is actually sent, not the file's commentary on them. */
const instruction = extract.slice(extract.indexOf("const instruction ="), extract.indexOf("Respond with the JSON object only"));

/** The application as it stood: the licence names one man, as the owner. */
const SOLE = {
  company_name: "ECONOMIC ADVANTAGE INFORMATION TECHNOLOGY CONSULTANTS",
  owner_name: "OBAID SAEED OBAID KHALFAN BIN JARSH",
  member_1_name_ar: "عبيد سعيد عبيد خلفان بن جرش",
};

console.log("\n1. An identity document supplies a number, never an identity");
check("the Emirates ID rule no longer maps the holder into owner fields",
  !/holder's name\/nationality into the matching owner fields/.test(instruction));
check("...and says so in as many words", /Map NOTHING ELSE about the person/.test(instruction));
check("the register's fields are named in one place", /export const RECORD_IDENTITY/.test(extract));
for (const k of [
  "owner_name", "owner_name_ar", "owner_nationality",
  "partner_1_name", "partner_1_name_ar", "partner_1_nationality",
  "partner_12_name", "member_1_name", "member_2_nationality", "shareholder_3_name",
]) check(`  ${k} is part of the register`, RECORD_IDENTITY.test(k), k);
// The Emirates Post authorised agent is a person being ADDED by the
// application, not one the register already names. Their card is the only place
// their name comes from, and stripping it would break that journey outright.
for (const k of ["agent_full_name", "agent_emirates_id", "contact_name", "company_name", "owner_emirates_id", "partner_1_passport_no"])
  check(`  ${k} is NOT`, !RECORD_IDENTITY.test(k), k);
check("an identity document has those stripped before anything is applied",
  /const isIdentityDocument =/.test(extract) && /RECORD_IDENTITY\.test\(k\)\) delete values\[k\]/.test(extract));
check("...for a card, a passport, and an unclassified file in an identity slot",
  /docType === "emirates_id" \|\|\s*\n?\s*docType === "passport" \|\|/.test(extract) && /IDENTITY_SLOT_KEY\.test\(input\.expected\?\.key/.test(extract));
check("the holder's name still travels, for the checks to use", /and nowhere else/.test(instruction));

console.log("\n2. An empty partner slot is not permission to fill it with anybody");
{
  const r = partnerDocumentCheck("partner_1_emirates_id", SOLE, {}, { holderName: "Valentina Mintah" });
  check("the stranger's card is REFUSED", r.conflict?.severity === "block", r.conflict);
  check("the reason names her", /Valentina Mintah/.test(r.conflict?.reason ?? ""), r.conflict?.reason);
  check("...and names who the licence does give", /OBAID SAEED OBAID KHALFAN BIN JARSH/.test(r.conflict?.reason ?? ""));
  check("...and forbids the offer that was made", /do NOT offer to record/.test(r.conflict?.reason ?? ""), r.conflict?.reason);
}
{
  const r = partnerDocumentCheck("partner_1_passport", SOLE, {}, { holderName: "Valentina Mintah" });
  check("a passport is refused the same way, and called a passport", r.conflict?.severity === "block" && /passport/.test(r.conflict.reason));
}
check("the owner's OWN card in partner 1's slot still passes — a sole establishment's owner is its partner",
  partnerDocumentCheck("partner_1_emirates_id", SOLE, {}, { holderName: "Obaid Saeed Obaid Khalfan Bin Jarsh" }).conflict === null);
check("a licence member's card passes too",
  partnerDocumentCheck("partner_2_emirates_id", { ...SOLE, member_1_name: "Zhao Zhao" }, {}, { holderName: "Zhao Zhao" }).conflict === null);
// The first document of an application has nothing to contradict. Refusing here
// would stall every journey at step one.
check("an application that names nobody yet still accepts its first card",
  partnerDocumentCheck("partner_1_emirates_id", { company_name: "SOME CO" }, {}, { holderName: "Valentina Mintah" }).conflict === null);
check("a company document in a partner slot is untouched by this",
  partnerDocumentCheck("partner_1_moa", SOLE, {}, { holderName: "Valentina Mintah" }).conflict === null);
// Unchanged from 8 September: where the slot DOES have a name, a transliteration
// difference is still a question rather than a refusal.
check("a spelling difference is still only a question",
  partnerDocumentCheck("partner_1_emirates_id", { partner_1_name: "Mohammed Al Marzooqi" }, {}, { holderName: "Mohamad Almarzouqi" }).conflict?.severity === "confirm");

console.log("\n3. And the model cannot write the register either");
const guard = tools.slice(tools.indexOf("WHO THE COMPANY'S PEOPLE ARE IS NOT"), tools.indexOf("const contradicts = licenceContradiction"));
check("collect_field consults the same list", /RECORD_IDENTITY\.test\(fieldKey\)/.test(guard));
check("a partner or member name is refused outright — nothing requires one of the customer",
  /!ownerSlot && !onFile/.test(guard));
check("...and any CHANGE is refused, the owner's included", /wouldChange/.test(guard));
check("re-recording the same value is not a change", /String\(held\)\.trim\(\) !== String\(input\.value \?\? ""\)\.trim\(\)/.test(guard));
check("the refusal tells the model where the answer really lives", /trade licence, the Memorandum of/.test(guard));
check("...and forbids the button", /NEVER offer the customer an option that changes who a partner is/.test(guard));
check("...and gives the one real remedy", /licensing authority first/.test(guard));
check("the rule is in the prompt, not only in the guard",
  /WHO A COMPANY'S PEOPLE ARE IS A MATTER OF RECORD/.test(prompt));
check("...naming the exact offer that was made", /"X is the correct partner" is not a choice/.test(prompt));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
