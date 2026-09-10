/**
 * The branch a progress line names must be the branch the customer picked.
 *
 * Reported 10 September, from an Arabic conversation on production. The
 * customer pressed "NXN - Al Barsha Branch"; the reply opened
 *
 *   سأجلب الأرقام المتاحة في فرع الرشيدية.
 *   إليك الأرقام المتاحة في NXN - Al Barsha Branch (3 أرقام متبقية فقط):
 *
 * The branch names below are the real ones, read off Emirates Post's
 * Rental/BoxLocations on staging today, spelling and spacing untouched — the
 * whole point of the fix is that their spelling is the only correct one.
 *
 * Run from apps/web:  npx tsx scripts/test-branch-name-2026-09-10.ts
 */
import { branchIndex, branchNamedIn, branchNarrationGuard, normaliseWord, isAnnouncingLookup } from "../lib/branchName";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : `\n         ${JSON.stringify(got)}`}`); }
};

/** Emirates Post's own Dubai list, both names, as returned today. */
const DUBAI: { officeId: string; name: string }[] = [
  { officeId: "201", name: "Dubai Central Post Office" },
  { officeId: "201", name: "مكتب بريد دبي المركزي" },
  { officeId: "214", name: "Naif Post Office" },
  { officeId: "214", name: "مكتب بريد نايف" },
  { officeId: "216", name: "Al Rashidiyah Post Office" },
  { officeId: "216", name: "مكتب بريد الراشدية" },
  { officeId: "217", name: "Al Qusais Post Office" },
  { officeId: "217", name: "مكتب بريد القصيص" },
  { officeId: "244", name: "Al Barsha Post Office" },
  { officeId: "244", name: "مكتب بريد البرشاء" },
  { officeId: "250", name: "Al Quoz Fourth Post Office" },
  { officeId: "250", name: "مكتب بريد القوز الرابعة" },
];
const IDX = branchIndex(DUBAI);

function run(text: string, selected: string | null, chunk = 6): string {
  const g = branchNarrationGuard({ branches: () => DUBAI, selected: () => selected });
  let out = "";
  for (let i = 0; i < text.length; i += chunk) out += g.push(text.slice(i, i + chunk));
  return out + g.flush();
}

console.log("\nThe spelling the model invented still resolves to the branch it meant");
check("«الراشدية» and «الرشيدية» share a skeleton", normaliseWord("الراشدية") === normaliseWord("الرشيدية"), [normaliseWord("الراشدية"), normaliseWord("الرشيدية")]);
check("...and they are not the skeleton of البرشاء", normaliseWord("الراشدية") !== normaliseWord("البرشاء"));
check("the misspelling names branch 216", branchNamedIn("سأجلب الأرقام المتاحة في فرع الرشيدية.", IDX) === "216", branchNamedIn("سأجلب الأرقام المتاحة في فرع الرشيدية.", IDX));
check("the correct spelling names it too", branchNamedIn("مكتب بريد الراشدية", IDX) === "216");
check("Al Barsha, in English, names 244", branchNamedIn("NXN - Al Barsha Branch", IDX) === "244");
check("Al Barsha, in Arabic, names 244", branchNamedIn("فرع البرشاء", IDX) === "244");

console.log("\nWords every branch shares identify nothing");
for (const w of ["مكتب", "بريد", "post", "office", "branch", "al"]) {
  check(`"${w}" is not discriminating`, !IDX.has(normaliseWord(w)), w);
}
check("a sentence with only shared words names nobody", branchNamedIn("سأجلب الأرقام من مكتب البريد.", IDX) === null);
check("two branches in one sentence names neither", branchNamedIn("Is Al Barsha the same as Al Rashidiyah?", IDX) === null);

console.log("\nAdjacent pairs separate the branches no single word can");
{
  const ain = branchIndex([
    { officeId: "104", name: "Al Ain Central Post Office" },
    { officeId: "105", name: "Al Ain Industrial Area Post Office" },
  ]);
  check("neither is named by 'Ain' alone", branchNamedIn("Al Ain", ain) === null);
  check("'Ain Central' is 104", branchNamedIn("Al Ain Central Post Office", ain) === "104");
  check("'Ain Industrial' is 105", branchNamedIn("Al Ain Industrial Area Post Office", ain) === "105");
}

console.log("\nThe reported reply");
{
  const REPORTED =
    "سأجلب الأرقام المتاحة في فرع الرشيدية.\n" +
    "إليك الأرقام المتاحة في مكتب بريد البرشاء (3 أرقام متبقية فقط):\n" +
    "```cards\ntitle: 452538\n```\n";
  const out = run(REPORTED, "244");
  check("the wrong announcement goes", !/الرشيدية/.test(out), out);
  check("the correct line stays", /إليك الأرقام المتاحة في مكتب بريد البرشاء/.test(out), out);
  check("the cards are untouched", /```cards\ntitle: 452538\n```/.test(out), out);
}
{
  const en = "Let me pull up the free boxes at Al Rashidiyah Post Office. Here are the numbers at Al Barsha Post Office:";
  const out = run(en, "244");
  check("the English form goes too", !/Rashidiyah/.test(out), out);
  check("...and the answer beside it stays", /Here are the numbers at Al Barsha/.test(out), out);
}

console.log("\nWhat must NOT be touched");
{
  const right = "سأجلب الأرقام المتاحة في مكتب بريد البرشاء.";
  check("an announcement naming the RIGHT branch survives", run(right, "244").includes("البرشاء"), run(right, "244"));
}
{
  // From the same conversation: the customer asked, and this answer was correct.
  const compare =
    "لا، هما فرعان مختلفان: مكتب بريد البرشاء يقع في منطقة البرشاء، ومكتب بريد الراشدية يقع في منطقة الراشدية.";
  check("a comparison of two branches survives", run(compare, "244") === compare, run(compare, "244"));
}
{
  // Our own branch-list note REQUIRES this when the chosen branch is closed.
  const alt = "Al Barsha Post Office is closed now and opens at 08:00. Al Qusais Post Office is open now and has boxes.";
  check("an alternative offered for a closed branch survives", run(alt, "244") === alt, run(alt, "244"));
}
{
  const apology = "You're right, and I'm sorry. I mentioned Al Rashidiyah in error; you chose Al Barsha.";
  check("an apology naming the wrong branch survives", run(apology, "244") === apology, run(apology, "244"));
}
{
  const t = "سأجلب الأرقام المتاحة في فرع الرشيدية.";
  check("nothing is dropped when no branch is selected", run(t, null) === t, run(t, null));
  const g = branchNarrationGuard({ branches: () => [], selected: () => "244" });
  check("nothing is dropped when no branches were shown", g.push(t) + g.flush() === t);
}

console.log("\nAnnouncement detection");
for (const s of ["Let me fetch the boxes", "I'll get the numbers", "Checking availability now", "سأجلب الأرقام", "دعني أتحقق من الأرقام", "جارٍ جلب الأرقام"]) {
  check(`announcing: "${s}"`, isAnnouncingLookup(s), s);
}
for (const s of ["Here are the numbers", "لا، هما فرعان مختلفان", "You chose Al Barsha", "إليك الأرقام المتاحة"]) {
  check(`not announcing: "${s}"`, !isAnnouncingLookup(s), s);
}

console.log("\nStreaming");
{
  const REPORTED = "سأجلب الأرقام المتاحة في فرع الرشيدية. إليك الأرقام في مكتب بريد البرشاء:";
  for (const chunk of [1, 3, 11, 400]) {
    const out = run(REPORTED, "244", chunk);
    check(`chunk size ${chunk} gives the same answer`, !/الرشيدية/.test(out) && /البرشاء/.test(out), out);
  }
  // Held bytes must never be dropped on the floor.
  const g = branchNarrationGuard({ branches: () => DUBAI, selected: () => "244" });
  const partial = g.push("Here are the boxes at Al Barsha");
  check("an unfinished sentence is held, not lost", partial + g.flush() === "Here are the boxes at Al Barsha", [partial, g.flush()]);
}

console.log("\nThe branch names reach the model in the customer's language");
{
  const src = readFileSync(new URL("../lib/integrations.ts", import.meta.url), "utf8");
  const rule = src.slice(src.indexOf("function branchNameRule"), src.indexOf("const branchDirectory"));
  check("the note is locale-aware", /locale === "ar"/.test(rule), rule.length);
  check("...and asks for nameAr in Arabic", /NAME EVERY BRANCH BY ITS nameAr/.test(rule));
  check("...and still asks for nameEn in English", /USE EACH BRANCH'S nameEn EXACTLY/.test(rule));
  check("...and forbids inventing one", /NEVER TRANSLATE, TRANSLITERATE OR SHORTEN/.test(rule));
  check("the Sharjah rule from item 5 is still there", /Sharjah Industrial Zone Branch/.test(rule));
  check("the note is actually emitted", /branchNameRule\(opts\.locale\)/.test(src));
  check("branch names are exposed for the guard", /getBranchNames: \(\) => branchNamesShown\(opts\.conversationId\)/.test(src));
  check("...from an index that holds both languages", /Object\.entries\(hit\.byName\)\.map/.test(src.replace(/\s+/g, " ")));

  const route = readFileSync(new URL("../app/api/chat/route.ts", import.meta.url), "utf8");
  check("the guard is in the streaming chain", /branchNarration\.push\(narration\.push/.test(route));
  check("...and is flushed at the end of the turn", /branchNarration\.flush\(\)/.test(route));
  check("the selection is read from the customer's message first", /branchNamedIn\(body\.userMessage, idx\)/.test(route));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
