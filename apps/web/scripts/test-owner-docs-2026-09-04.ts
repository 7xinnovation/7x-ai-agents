/**
 * The owner's identity documents (2026-09-04), from the EPGL team's review.
 *
 * 1. A stranger's Emirates ID was ACCEPTED into the owner's slot, with a remark
 *    afterwards that the name did not seem to appear on the trade licence. A
 *    remark is not a rejection: the card stayed on the case, its number filled
 *    the owner's field, and the application carried somebody else's identity
 *    into Salesforce. Partner slots already refuse this properly; the owner slot
 *    now does too.
 *
 * 2. The owner is often also partner 1, and their Emirates ID is ONE card --
 *    asked for twice, once per slot. Whichever arrives first now fills both.
 *
 * Run from apps/web:
 *   npx tsx scripts/test-owner-docs-2026-09-04.ts
 */
import { ownerDocumentCheck, namedPeople, partnerIndexByName } from "@/lib/docIdentity";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => {
  console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : extra ?? "");
  ok ? pass++ : fail++;
};

const LICENCE = {
  owner_name: "Faisal Eissa Lutfi Ali Hussain",
  partner_1_name: "Faisal Eissa Lutfi Ali Hussain",
  partner_2_name: "Abdelaziz Mohamed Obaid",
  partner_3_name: "Valentina Mintah",
};
const card = (name: string) => ({ owner_name: name });

// 1. THE REPORTED CASE: a card belonging to nobody on the licence is refused.
{
  const r = ownerDocumentCheck(LICENCE, card("SOMEONE ENTIRELY UNRELATED"));
  check("a stranger's Emirates ID is REJECTED", r.reject !== null, r);
  check("...naming who it belongs to", !!r.reject && r.reject.includes("SOMEONE ENTIRELY UNRELATED"), r.reject);
  check("...and who it should be", !!r.reject && r.reject.includes("Faisal Eissa Lutfi Ali Hussain"), r.reject);
  check("...listing every named person", !!r.reject && r.reject.includes("Valentina Mintah"), r.reject);
}

// 2. The owner's own card passes, however it is transliterated.
{
  check("the owner's card is accepted", ownerDocumentCheck(LICENCE, card("Faisal Eissa Lutfi Ali Hussain")).reject === null);
  check("a transliteration variant is accepted",
    ownerDocumentCheck(LICENCE, card("Faisal Eissa Lutfi Ali-Hussain")).reject === null);
  check("...and is reported as the owner", ownerDocumentCheck(LICENCE, card("Faisal Eissa Lutfi")).matched === "the owner");
}

// 3. Any PARTNER's card is accepted too. On a multi-partner licence the person
//    whose card is on file may legitimately be any of them -- refusing those
//    would block a perfectly ordinary application.
{
  const r = ownerDocumentCheck(LICENCE, card("Mohamed Abdelaziz Mohamed Balhaif Alnuaimi"));
  check("partner 2's card is accepted", r.reject === null, r);
  check("...and reported as partner 2", r.matched === "partner 2", r);
  check("partner 3's card is accepted", ownerDocumentCheck(LICENCE, card("Valentina Mintah")).reject === null);
}

// 4. Nothing to check against: accept. The first document of an application has
//    nothing to contradict, and refusing it would stall every journey at step 1.
{
  check("no names on file yet", ownerDocumentCheck({}, card("ANYONE")).reject === null);
  check("no name on the document", ownerDocumentCheck(LICENCE, {}).reject === null);
  check("neither", ownerDocumentCheck({}, {}).reject === null);
}

// 5. The wording is a passport's when it is a passport.
{
  const r = ownerDocumentCheck(LICENCE, card("A STRANGER"), "passport");
  check("passport wording", !!r.reject && r.reject.includes("passport") && !r.reject.includes("Emirates ID"), r.reject);
}

// 6. namedPeople underpins the message: everyone, labelled.
{
  const people = namedPeople(LICENCE);
  check("owner and three partners", people.length === 4, people);
  check("owner first", people[0]?.label === "the owner", people[0]);
  check("partners numbered", people[2]?.label === "partner 2", people[2]);
  check("an empty case names nobody", namedPeople({}).length === 0);
}

// 7. The mirror's matcher: the owner IS partner 1 here, so one card covers both.
{
  check("the owner is recognised as partner 1", partnerIndexByName(LICENCE, "Faisal Eissa Lutfi Ali Hussain") === 1);
  check("partner 2 is recognised as partner 2", partnerIndexByName(LICENCE, "Mohamed Abdelaziz Mohamed Balhaif Alnuaimi") === 2);
  check("a stranger matches no partner", partnerIndexByName(LICENCE, "NOBODY AT ALL") === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
