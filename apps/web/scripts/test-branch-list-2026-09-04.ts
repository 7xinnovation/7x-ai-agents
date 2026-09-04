/**
 * Branch list: hide the empty ones, warn about box halls (2026-09-04).
 *
 * Two rules from Emirates Post.
 *
 * A branch with no free boxes is REMOVED, not greyed out. Greying it out still
 * puts a dead end in front of the customer -- a card they can read and be
 * disappointed by.
 *
 * A location whose officeId differs from its mainOfficeId is a PO Box HALL:
 * boxes only, no counter, and the key is issued at the main office instead.
 * Their own site shows a notice before letting anyone proceed. The fixture below
 * is verbatim from a real BoxLocations response.
 *
 * Run from apps/web:
 *   npx tsx scripts/test-branch-list-2026-09-04.ts
 */
import { prepareBranches, isPoBoxHall, poBoxHallNotice, type BranchRow } from "@/lib/branchList";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => {
  console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : extra ?? "");
  ok ? pass++ : fail++;
};

/** Verbatim from BoxLocations?BundleId=LI&EmirateCode=DXB. */
const ROWS: BranchRow[] = [
  {
    officeId: "201", nameEn: "NXN - Dubai Central Branch", nameAr: "الشبكة الوطنية - فرع دبي المركزي",
    workingTime: " 08:00 AM- 20:00 PM", workingDays: " Monday - Friday  ",
    mainOfficeId: "201", mainOfficeNameEn: "NXN - Dubai Central Branch",
  },
  {
    // The reported case: a box hall, main office elsewhere.
    officeId: "202", nameEn: "Union Square Post Office", nameAr: "مكتب بريد ميدان الإتحاد",
    workingTime: " 08:00 AM - 18:30 PM", workingDays: " Monday - Friday  ",
    mainOfficeId: "209", mainOfficeNameEn: "NXN - Al Riqqa Branch", mainOfficeNameAr: "الشبكة الوطنية - فرع الرقة",
  },
  {
    officeId: "206", nameEn: "NXN - Al Musslah Branch",
    workingTime: " 08:00 AM - 15:30 PM", workingDays: " Monday - Friday  ",
    mainOfficeId: "206", mainOfficeNameEn: "NXN - Al Musslah Branch",
  },
];

// 1. Branches with no free boxes are GONE, not greyed out.
{
  const counts = new Map<string, number | null>([["201", 12], ["202", 0], ["206", 3]]);
  const { branches, hidden } = prepareBranches(ROWS, counts);
  check("the empty branch is removed", branches.length === 2, branches.map((b) => b.officeId));
  check("...and counted as hidden", hidden === 1, hidden);
  check("202 is not in the list at all", !branches.some((b) => b.officeId === "202"), branches.map((b) => b.officeId));
  check("the others keep their counts", branches.find((b) => b.officeId === "201")?.freeBoxCount === 12);
}

// 2. "Not counted" is not "none". A slow availability lookup must not hide a
//    real branch -- undefined and 0 mean different things.
{
  const counts = new Map<string, number | null>([["201", null], ["206", 3]]);
  const { branches, hidden } = prepareBranches(ROWS, counts);
  check("an uncounted branch is kept", branches.some((b) => b.officeId === "201"), branches.map((b) => b.officeId));
  check("...with no freeBoxCount", branches.find((b) => b.officeId === "201")?.freeBoxCount === undefined);
  check("a branch missing from the map is kept", branches.some((b) => b.officeId === "202"));
  check("nothing hidden", hidden === 0, hidden);
}

// 3. THE BOX HALL RULE: officeId !== mainOfficeId.
{
  check("202 is a box hall", isPoBoxHall(ROWS[1]!));
  check("201 is a real branch", !isPoBoxHall(ROWS[0]!));
  check("206 is a real branch", !isPoBoxHall(ROWS[2]!));
  const { branches } = prepareBranches(ROWS, new Map());
  const hall = branches.find((b) => b.officeId === "202")!;
  check("the hall is marked", hall.isPoBoxHall === true, hall);
  check("...and names where the key actually is", hall.alternativeBranchEn === "NXN - Al Riqqa Branch", hall);
  check("...in Arabic too", hall.alternativeBranchAr === "الشبكة الوطنية - فرع الرقة", hall);
  check("a real branch is not marked", branches.find((b) => b.officeId === "201")?.isPoBoxHall === undefined);
}

// 4. A row missing either id is an ORDINARY branch. Showing the notice on a real
//    post office is its own kind of wrong.
{
  check("no mainOfficeId is not a hall", !isPoBoxHall({ officeId: "201" }));
  check("no officeId is not a hall", !isPoBoxHall({ mainOfficeId: "209" }));
  check("neither is not a hall", !isPoBoxHall({}));
  check("empty strings are not a hall", !isPoBoxHall({ officeId: "", mainOfficeId: "" }));
  check("whitespace difference alone is not a hall", !isPoBoxHall({ officeId: " 201 ", mainOfficeId: "201" }));
}

// 5. Pooled MyHome bundles: one count answers for the whole emirate.
{
  const counts = new Map<string, number | null>([["DXB", 0]]);
  const { branches, hidden } = prepareBranches(ROWS, counts, { pooled: true, emirate: "DXB" });
  check("a pooled zero hides every branch", branches.length === 0, branches.length);
  check("...and counts them all", hidden === 3, hidden);
  const some = prepareBranches(ROWS, new Map<string, number | null>([["DXB", 5]]), { pooled: true, emirate: "DXB" });
  check("a pooled count is applied to all", some.branches.every((b) => b.freeBoxCount === 5), some.branches);
}

// 6. Opening hours still annotated, and a closed branch is NOT hidden -- it can
//    still be rented, the customer just has to be told.
{
  const { branches } = prepareBranches(ROWS, new Map());
  check("openNow is computed", branches.every((b) => typeof b.openNow === "boolean"), branches.map((b) => b.openNow));
  check("all three survive regardless of hours", branches.length === 3);
}

// 7. The notice carries the real branch name and the words they specified.
{
  const n = poBoxHallNotice("NXN - Al Riqqa Branch");
  check("names the alternative branch", n.includes("NXN - Al Riqqa Branch"), n.slice(0, 80));
  for (const phrase of [
    "Important Notice",
    "P.O. Box Hall/complex",
    "Counter services, large parcel handling, registered mail processing",
    "Keys are not issued at this P.O. Box Hall location",
    "By proceeding, you acknowledge and accept these service limitations",
  ]) {
    check(`says "${phrase.slice(0, 40)}…"`, n.includes(phrase), n);
  }
}

// 8. An empty list is an empty list, not a crash.
{
  const { branches, hidden } = prepareBranches([], new Map());
  check("no rows, no branches", branches.length === 0 && hidden === 0);
}

// 9. CLOSED BRANCHES AND BOX HALLS WITH BOXES ARE SHOWN, not hidden. Only an
//    EMPTY location is removed. A closed branch can still be rented from and a
//    hall still has boxes — hiding either would take a real option away.
{
  const counts = new Map<string, number | null>([["201", 5], ["202", 8], ["206", 2]]);
  const { branches } = prepareBranches(ROWS, counts);
  check("the box hall with boxes is SHOWN", branches.some((b) => b.officeId === "202"), branches.map((b) => b.officeId));
  check("...still flagged as a hall", branches.find((b) => b.officeId === "202")?.isPoBoxHall === true);
  check("...still naming its alternative branch",
    branches.find((b) => b.officeId === "202")?.alternativeBranchEn === "NXN - Al Riqqa Branch");
  check("...and keeping its count", branches.find((b) => b.officeId === "202")?.freeBoxCount === 8);
  check("every branch survives when all have boxes", branches.length === 3, branches.length);

  // A branch closed right now keeps its place; only openNow marks it.
  const closed = prepareBranches(
    [{ ...ROWS[0]!, workingTime: " 08:00 AM- 09:00 AM", workingDays: " Monday - Friday  " }],
    new Map<string, number | null>([["201", 4]])
  );
  check("a branch closed right now is still listed", closed.branches.length === 1, closed.branches);
  check("...and keeps its boxes", closed.branches[0]?.freeBoxCount === 4);

  // An EMPTY hall is the one case that goes: there is nothing to rent in it.
  const emptyHall = prepareBranches(ROWS, new Map<string, number | null>([["202", 0]]));
  check("an empty hall is removed like any other empty location",
    !emptyHall.branches.some((b) => b.officeId === "202"), emptyHall.branches.map((b) => b.officeId));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
