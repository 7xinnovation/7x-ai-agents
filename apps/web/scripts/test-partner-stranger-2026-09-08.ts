/**
 * A stranger's Emirates ID under a partner's name.
 *
 * Reported 8 September: partner 3 is Valentina Mintah, EID_Nida.jpg was uploaded
 * against her slot to see whether it would be caught, and it was accepted with a
 * green tick. The slot's check reported "confirm" -- keep it, ask about it --
 * on the reasoning that transliteration makes the same person's name look
 * different on different documents. True, but not of Nida and Valentina.
 *
 * Run from apps/web:  npx tsx scripts/test-partner-stranger-2026-09-08.ts
 */
import { partnerDocumentCheck, couldBeSamePerson } from "../lib/docIdentity";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, got?: unknown) {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`); }
}

/** The application from the report: three partners on YI FANG's licence. */
const CASE = {
  partner_1_name: "Faisal Eissa Lutfi Ali Hussain",
  partner_2_name: "Abdelaziz Mohamed Obaid",
  partner_3_name: "Valentina Mintah",
};
const on = (key: string, name: string, data: Record<string, unknown> = CASE) =>
  partnerDocumentCheck(key, data, { full_name: name });

console.log("\nThe reported case");
{
  const r = on("partner_3_emirates_id", "Nida Fatima");
  check("a stranger's card is REFUSED, not queried", r.conflict?.severity === "block", r.conflict);
  check("the reason names who it actually belongs to", /Nida Fatima/.test(r.conflict?.reason ?? ""), r.conflict?.reason);
  check("and says who partner 3 is", /Valentina Mintah/.test(r.conflict?.reason ?? ""), r.conflict?.reason);
  check("and asks for the right document", /partner 3's own document/.test(r.conflict?.reason ?? ""), r.conflict?.reason);
}

console.log("\nThe partner's own document still passes");
check("exact name", on("partner_3_emirates_id", "Valentina Mintah").conflict === null);
check("reversed order", on("partner_3_emirates_id", "Mintah Valentina").conflict === null);
check("with a middle name the licence omits", on("partner_1_emirates_id", "Faisal Eissa Lutfi Ali Hussain").conflict === null);

console.log("\nA spelling difference is still a QUESTION, never a refusal");
for (const [was, now] of [
  ["Valentina Mintah", "Valentyna Minta"],
  ["Abdelaziz Mohamed Obaid", "Abdel Aziz Mohammed Obeid"],
  ["Mohammed Al Nuaimi", "Muhammad Alnuaimi"],
]) {
  const r = partnerDocumentCheck("partner_3_emirates_id", { partner_3_name: was }, { full_name: now });
  check(`"${was}" vs "${now}" is not refused`, r.conflict?.severity !== "block", r.conflict?.severity);
}

console.log("\nMisfiling still names the right slot");
{
  const r = on("partner_3_emirates_id", "Faisal Eissa Lutfi Ali Hussain");
  check("another partner's card is blocked", r.conflict?.severity === "block", r.conflict);
  check("and says whose slot it belongs in", /partner 1/.test(r.conflict?.reason ?? ""), r.conflict?.reason);
}

console.log("\nNothing to judge on is never a refusal");
check("no name on the document", on("partner_3_emirates_id", "").conflict === null);
check("no name on file for that partner", partnerDocumentCheck("partner_4_emirates_id", CASE, { full_name: "Someone New" }).conflict === null);
check("not a partner slot at all", partnerDocumentCheck("trade_license", CASE, { full_name: "Nida" }).conflict === null);

console.log("\ncouldBeSamePerson");
check("shares a family name", couldBeSamePerson("Valentina Mintah", "V Mintah"));
check("a transliterated first name", couldBeSamePerson("Mohammed Ali", "Muhammad Ali"));
check("spaced vs joined", couldBeSamePerson("Abdelaziz Obaid", "Abdel Aziz Obaid"));
check("two different people share nothing", !couldBeSamePerson("Valentina Mintah", "Nida Fatima"));
check("an empty side is not judged", couldBeSamePerson("", "Nida Fatima"));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
