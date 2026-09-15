/**
 * A replacement is an upload, and the conversation has to notice.
 *
 * Reported 15 September: the agent asked for the current MOA, the customer
 * replaced the stale one with it, the card showed the new file — and the agent
 * never spoke again.
 *
 * The widget fires one turn when a document lands. It decided that by COUNTING
 * documents, and a Replace changes no count: the slot reads "uploaded" before
 * and after. Every Replace of every document was silent.
 *
 * Run from apps/web:  npx tsx scripts/test-document-replaced-2026-09-15.ts
 */
import { readFileSync } from "node:fs";
import { docSignature, type SignableDocument } from "../lib/caseDocs";

let failed = 0;
const check = (what: string, ok: boolean, got?: unknown) => {
  console.log(`${ok ? "  ok  " : "FAIL  "}${what}${ok || got === undefined ? "" : `\n        ${JSON.stringify(got)}`}`);
  if (!ok) failed++;
};
const changed = (a: SignableDocument[], b: SignableDocument[]) => docSignature(a) !== docSignature(b);

const TL: SignableDocument = { key: "trade_license", status: "uploaded", fileName: "Trade License Main 697670.pdf" };
const OLD_MOA: SignableDocument = { key: "moa", status: "uploaded", fileName: "Yi Fang MOA 2020 (old).pdf" };
const NEW_MOA: SignableDocument = { key: "moa", status: "uploaded", fileName: "Yi Fang MOA Amendment 2022.pdf" };

console.log("\nThe reported bug");
check(
  "replacing a file is a change, though the counts are identical",
  changed([TL, OLD_MOA], [TL, NEW_MOA])
);
check(
  "...and the old count test could not have seen it",
  [TL, OLD_MOA].filter((d) => d.status === "uploaded").length ===
    [TL, NEW_MOA].filter((d) => d.status === "uploaded").length
);

console.log("\nEverything else that must still fire");
check("a first upload", changed([TL], [TL, NEW_MOA]));
check("a rejection", changed([TL], [{ ...TL, status: "rejected", rejectionReason: "expired" }]));
check("a rejection cleared by a better copy", changed(
  [{ ...TL, status: "rejected", rejectionReason: "expired" }],
  [{ ...TL, status: "uploaded" }]
));
check("a different rejection reason on the same file", changed(
  [{ ...TL, status: "rejected", rejectionReason: "wrong company" }],
  [{ ...TL, status: "rejected", rejectionReason: "expired" }]
));
check("accepted after uploaded", changed([TL], [{ ...TL, status: "accepted" }]));

console.log("\nAnd what must NOT fire");
check("nothing changed", !changed([TL, NEW_MOA], [TL, NEW_MOA]));
check("the same documents in a different order", !changed([TL, NEW_MOA], [NEW_MOA, TL]));
check("an empty case is stable", !changed([], []));

console.log("\nThe one it cannot see — which is why the widget also says so itself");
check(
  "a file replacing itself, same name and outcome, is indistinguishable",
  !changed([OLD_MOA], [{ ...OLD_MOA }])
);
{
  const src = readFileSync(new URL("../app/embed/[agent]/Experience.tsx", import.meta.url), "utf8");
  check("so a locally-performed upload reports itself", /justUploaded\.current = true;/.test(src));
  check("...and the effect honours it", /sig !== uploadedBaseline\.current \|\| justUploaded\.current/.test(src));
  check("...and it is consumed once", /justUploaded\.current = false;/.test(src));
  check("the count comparison is gone", !/const grew = up > uploadedBaseline/.test(src));
}

console.log(failed ? `\n${failed} failing` : "\nall good");
process.exit(failed ? 1 : 0);
