/**
 * Somebody else's Emirates ID, into partner 3's slot, accepted.
 *
 * Reported 15 September. Nida Zafar Awan's card went into partner 3's slot —
 * partner 3 is Valentina Mintah — and came back with a green tick. The audit:
 *
 *   11:09:38  document_rejected_wrong_partner  partner_1_emirates_id  EID_Nida.jpg
 *   11:10:57  document_uploaded                partner_3_emirates_id  EID_Nida.jpg
 *                                              extracted: [partner_3_emirates_id]
 *
 * The SAME card, refused from one slot and accepted into another, ninety
 * seconds apart. partnerDocumentCheck would have refused a stranger either way;
 * it never got the chance, because it had no name to check. The extraction had
 * one — the model named Nida in the very next sentence — and nowhere to put it:
 * the only fields a person's name could land in are the OWNER's, partner 1 is
 * the owner and partner 3 is not, so for partner 3 the name was read and
 * dropped.
 *
 * `__document_holder_name` now asks for it in its own right. These cases are
 * about what happens once the check can see whose card it is.
 *
 * Run from apps/web:  npx tsx scripts/test-partner-identity-2026-09-15.ts
 */
import { partnerDocumentCheck, ownerDocumentCheck } from "../lib/docIdentity";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : `\n         ${JSON.stringify(got)}`}`); }
};

/** The application as it stood when the card went in. */
const CASE = {
  company_name: "YI FANG TAIWAN FRUIT TEA L.L.C",
  partner_count: 3,
  partner_1_name: "Faisal Eissa Lutfi Ali Hussain",
  partner_2_name: "Abdelaziz Mohamed Obaid",
  partner_3_name: "Valentina Mintah",
};
/** What the Nida card actually yielded: the number, and nothing else. */
const NIDA_VALUES = { partner_3_emirates_id: "784-1973-4862505-0" };

console.log("\nThe reported bug");
{
  // As it was: no name anywhere in the extracted values.
  const blind = partnerDocumentCheck("partner_3_emirates_id", CASE, NIDA_VALUES);
  check("without a name the card is no longer waved through", blind.conflict !== null, blind);
  check("...but it is queried, not refused — a bad photo is ordinary", blind.conflict?.severity === "confirm");
  check("...and the model may not call it verified", /do not say it was verified/.test(blind.conflict?.reason ?? ""));
  check("...and it names who it should have been", /Valentina Mintah/.test(blind.conflict?.reason ?? ""));

  // As it is: the holder's name comes back whoever they are.
  const seen = partnerDocumentCheck("partner_3_emirates_id", CASE, NIDA_VALUES, { holderName: "Nida Zafar Awan" });
  check("a stranger's card is REFUSED", seen.conflict?.severity === "block", seen.conflict);
  check("...and the reason names them", /Nida Zafar Awan/.test(seen.conflict?.reason ?? ""));
  check("...and says whose slot it is", /Partner 3 is Valentina Mintah/.test(seen.conflict?.reason ?? ""), seen.conflict?.reason);
}

console.log("\nThe right card still goes in");
{
  const ok = partnerDocumentCheck("partner_3_emirates_id", CASE, {}, { holderName: "Valentina Mintah" });
  check("no complaint", ok.conflict === null, ok.conflict);
  check("...and the name is recorded against the slot", ok.observedName === "Valentina Mintah");
  // Transliteration is still a question, not a refusal.
  const spelt = partnerDocumentCheck("partner_3_emirates_id", CASE, {}, { holderName: "Valentyna Mintah" });
  check("a spelling difference is asked about", spelt.conflict?.severity === "confirm", spelt.conflict);
}

console.log("\nAnd a misfile still says where it belongs");
{
  const wrong = partnerDocumentCheck("partner_3_emirates_id", CASE, {}, {
    holderName: "Faisal Eissa Lutfi Ali Hussain",
  });
  check("partner 1's card in partner 3's slot is refused", wrong.conflict?.severity === "block");
  check("...and named as partner 1's", /partner 1/i.test(wrong.conflict?.reason ?? ""), wrong.conflict?.reason);
}

console.log("\nDocuments that are not about one person are untouched");
{
  for (const key of ["moa", "partner_1_passport_scan_of_moa", "lease_contract"])
    check(`${key} is not interrogated for a holder name`, partnerDocumentCheck(key, CASE, {}).conflict === null, key);
  // A partner slot with no name ON FILE has nothing to check against either.
  check(
    "an unnamed partner slot is left alone",
    partnerDocumentCheck("partner_7_emirates_id", CASE, {}).conflict === null
  );
}

console.log("\nThe owner's own slot reads it the same way");
{
  const stranger = ownerDocumentCheck(CASE, {}, "Emirates ID", { holderName: "Nida Zafar Awan" });
  check("a stranger's card is refused", Boolean(stranger.reject), stranger);
  const known = ownerDocumentCheck(CASE, {}, "Emirates ID", { holderName: "Abdelaziz Mohamed Obaid" });
  check("a partner's card is accepted", known.reject === null, known);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
