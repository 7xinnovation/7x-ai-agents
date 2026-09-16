/**
 * The names on the licence that hold no shares.
 *
 * A UAE trade licence carries two tables: "Partners / الشركاء", the
 * shareholders, and "License Members / الاطراف" — a manager, a signatory, a
 * service agent — with a role and usually no share at all. We read the first and
 * ignored the second.
 *
 * JNT's licence names ZHAO ZHAO as Manager, his Emirates ID and passport were in
 * the pack, and the identity check treated him as a stranger: an upload in his
 * name would have been refused as "not named on this application", which is the
 * opposite of true.
 *
 * Run from apps/web:  npx tsx scripts/test-licence-members-2026-09-16.ts
 */
import { namedPeople, ownerDocumentCheck, partnerDocumentCheck } from "../lib/docIdentity";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : `\n         ${JSON.stringify(got)}`}`); }
};

/** JNT's licence as it reads: one corporate partner, one person, one manager. */
const JNT: Record<string, unknown> = {
  partner_count: "2",
  partner_1_name: "GLOBAL JET EXPRESS AE FZCO",
  partner_2_name: "Khalifa Thani Ali Khalifa Bin Ghalita",
  member_count: "1",
  member_1_name: "ZHAO ZHAO",
  member_1_name_ar: "زهاو زهاو",
  member_1_nationality: "China",
  member_1_role: "Manager",
};

console.log("\nEveryone the licence names");
{
  const people = namedPeople(JNT);
  const names = people.map((p) => p.name);
  check("the partners are named", names.includes("Khalifa Thani Ali Khalifa Bin Ghalita"), names);
  check("the manager is named too", names.includes("ZHAO ZHAO"), names);
  check("...with the role he actually holds", people.find((p) => p.name === "ZHAO ZHAO")?.label === "manager on the licence", people);
  check("a member is not promoted to a partner", !people.some((p) => p.name === "ZHAO ZHAO" && /partner/.test(p.label)));
  check("nobody is listed twice", new Set(names).size === names.length, names);
}

console.log("\nHis documents belong to this licence");
{
  // Before this, the manager's Emirates ID was refused as belonging to nobody on
  // the application — with his name printed on the licence it came from.
  const asOwner = ownerDocumentCheck(JNT, {}, "Emirates ID", { holderName: "ZHAO ZHAO" });
  check("a manager's Emirates ID is not refused", asOwner.reject === null, asOwner);
  check("...and it is recognised as the manager's, not accepted blindly", asOwner.matched === "manager on the licence", asOwner);
  const stranger = ownerDocumentCheck(JNT, {}, "Emirates ID", { holderName: "Nida Zafar Awan" });
  check("...and a real stranger still is refused", stranger.reject !== null, stranger);
}

console.log("\nBut he is still not partner 2");
{
  // The partner slots are the shareholders'. A manager's card in partner 2's slot
  // is the wrong document however legitimately he appears on the licence.
  const wrongSlot = partnerDocumentCheck("partner_2_emirates_id", JNT, {}, { holderName: "ZHAO ZHAO" });
  check("a manager cannot fill a partner's slot", Boolean(wrongSlot.conflict), wrongSlot);
  const right = partnerDocumentCheck("partner_2_emirates_id", JNT, {}, { holderName: "Khalifa Thani Ali Khalifa Bin Ghalita" });
  check("...and the shareholder still fills his own", !right.conflict, right);
}

console.log("\nA licence with no members table");
{
  const plain: Record<string, unknown> = { partner_count: "1", partner_1_name: "Valentina Mintah" };
  check("nothing is invented", namedPeople(plain).length === 1, namedPeople(plain));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
