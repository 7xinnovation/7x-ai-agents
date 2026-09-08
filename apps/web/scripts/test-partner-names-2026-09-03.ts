/**
 * Partner documents matched BY NAME (2026-09-03).
 *
 * Every partner's passport and Emirates ID must be the same person's, and which
 * partner a document belongs to is decided by the name printed on it -- not by
 * the slot the customer dropped it into. Uploading four partners' papers is
 * exactly the task people misfile, and a shuffled-but-complete set is worse than
 * a short one: every slot shows a tick and partner 3 has partner 1's passport
 * recorded against their name.
 *
 * Nothing here blocks. A passport and an Emirates ID transliterate the same
 * person differently, and the customer is the one who can settle it.
 *
 * Run from apps/web:
 *   npx tsx scripts/test-partner-names-2026-09-03.ts
 */
import { partnerDocumentCheck, partnerSlot, PARTNER_NAMES_KEY } from "@/lib/docIdentity";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => {
  console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : extra ?? "");
  ok ? pass++ : fail++;
};

const LICENCE = {
  partner_1_name: "MOHAMMED AL MANSOORI",
  partner_2_name: "AHMED KHALID SAEED",
  partner_3_name: "PRIYA RAMESH NAIR",
};
const doc = (name: string) => ({ owner_name: name });

// 1. Slot parsing.
{
  check("partner_2_passport parses", partnerSlot("partner_2_passport")?.index === 2);
  check("partner_10_emirates_id parses", partnerSlot("partner_10_emirates_id")?.index === 10);
  check("trade_license is not a partner slot", partnerSlot("trade_license") === null);
  check("partner_0 is not a slot", partnerSlot("partner_0_passport") === null);
  check("partnership_deed is not a slot", partnerSlot("partnership_deed") === null);
}

// 2. The right partner's document in the right slot.
{
  const r = partnerDocumentCheck("partner_2_passport", LICENCE, doc("AHMED KHALID SAEED"));
  check("the right name passes", r.conflict === null, r.conflict);
  check("...and the name is recorded", r.observedName === "AHMED KHALID SAEED", r.observedName);
  check("a spelling variant still passes",
    partnerDocumentCheck("partner_1_passport", LICENCE, doc("Mohammed Al-Mansoori")).conflict === null);
}

// 3. THE MISFILING CASE. Partner 1's passport dropped into partner 3's slot must
//    be named as such -- "wrong name" sends the customer hunting through the
//    document; "this is partner 1's" tells them what to do.
{
  const r = partnerDocumentCheck("partner_3_passport", LICENCE, doc("MOHAMMED AL MANSOORI"));
  check("a misfiled document is caught", r.conflict !== null, r.conflict);
  check("...and says which slot it belongs in", !!r.conflict && /partner 1/.test(r.conflict.reason), r.conflict?.reason);
  // BLOCKED, not asked. We know exactly whose document this is -- it matches
  // another person named on this same application -- so there is nothing to
  // confirm. Accepting it put a green tick against a slot holding the wrong
  // person's card, and a tick reads as done however the note beneath is worded.
  check("...and is REJECTED, not accepted with a note", r.conflict?.severity === "block", r.conflict);
  check("...telling them where each one goes", !!r.conflict && /upload partner 3's document here/i.test(r.conflict.reason), r.conflict?.reason);
}

// 4. A name belonging to nobody on the application.
//
// This used to be accepted with a note, on the reasoning that transliteration
// makes the same person look different on different documents. That reasoning
// was extended past where it holds: on 8 September a partner slot for Valentina
// Mintah took an Emirates ID in the name of Nida and showed a green tick. A name
// sharing nothing with this partner AND matching nobody else on the application
// is a stranger, and is refused -- see test-partner-stranger-2026-09-08.
{
  const r = partnerDocumentCheck("partner_2_passport", LICENCE, doc("SOMEONE ELSE ENTIRELY"));
  check("an unknown name is raised", r.conflict !== null, r.conflict);
  check("...naming who was expected", !!r.conflict && r.conflict.reason.includes("AHMED KHALID SAEED"), r.conflict?.reason);
  check("...and is REFUSED, not excused as a spelling", r.conflict?.severity === "block", r.conflict?.severity);
  check("...saying whose document it actually is", !!r.conflict && /SOMEONE ELSE ENTIRELY/.test(r.conflict.reason), r.conflict?.reason);
}

// 4b. A name that plausibly IS this partner, written differently, still only asks.
{
  const r = partnerDocumentCheck("partner_2_passport", LICENCE, doc("AHMAD KHALED SAEED"));
  check("a transliteration is a question, not a refusal", r.conflict?.severity !== "block", r.conflict?.severity);
}

// 5. THE PAIR. With no name from the licence, the Emirates ID is matched against
//    the passport already uploaded for that same partner.
{
  const afterPassport = { [PARTNER_NAMES_KEY]: { "2": "AHMED KHALID SAEED" } };
  check("the matching Emirates ID passes",
    partnerDocumentCheck("partner_2_emirates_id", afterPassport, doc("Ahmed Khalid Saeed")).conflict === null);
  const wrong = partnerDocumentCheck("partner_2_emirates_id", afterPassport, doc("PRIYA RAMESH NAIR"));
  check("a different person's Emirates ID is raised", wrong.conflict !== null, wrong.conflict);
}

// 6. Nothing known, nothing to say. The FIRST document of a partner with no name
//    on the licence has nothing to contradict, and refusing it would stall.
{
  const r = partnerDocumentCheck("partner_2_passport", {}, doc("ANYONE AT ALL"));
  check("the first document of an unnamed partner passes", r.conflict === null, r.conflict);
  check("...but its name is recorded for the next one", r.observedName === "ANYONE AT ALL", r.observedName);
  check("a document with no readable name passes", partnerDocumentCheck("partner_2_passport", LICENCE, {}).conflict === null);
  check("a non-partner slot is not checked", partnerDocumentCheck("trade_license", LICENCE, doc("ANYONE")).conflict === null);
}

// 7. Names read off a repeating group rather than numbered fields.
{
  const group = { partners: [{ name: "MOHAMMED AL MANSOORI" }, { name: "AHMED KHALID SAEED" }] };
  check("a group row matches", partnerDocumentCheck("partner_2_passport", group, doc("AHMED KHALID SAEED")).conflict === null);
  const r = partnerDocumentCheck("partner_1_passport", group, doc("AHMED KHALID SAEED"));
  check("a misfiled group row is caught", !!r.conflict && /partner 2/.test(r.conflict.reason), r.conflict?.reason);
}

// 8. Arabic names.
{
  const ar = { partner_1_name_ar: "محمد المنصوري", partner_2_name_ar: "أحمد خالد سعيد" };
  check("the right Arabic name passes",
    partnerDocumentCheck("partner_2_passport", ar, { owner_name_ar: "أحمد خالد سعيد" }).conflict === null);
  const r = partnerDocumentCheck("partner_2_passport", ar, { owner_name_ar: "محمد المنصوري" });
  check("a misfiled Arabic name is caught", !!r.conflict && /partner 1/.test(r.conflict.reason), r.conflict?.reason);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
