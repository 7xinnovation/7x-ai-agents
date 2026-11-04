/**
 * When the model asks for the wrong document, the reply ends with the right one
 * (4 November 2026).
 *
 * Pack 12: the lease was outstanding, the model asked six times for documents
 * already in, the upload guard stripped each control, every reply ended with
 * nothing to press, and the run finished by raising a callback case for an
 * application one document short.
 *
 * Run from apps/web:  npx tsx scripts/test-outstanding-document-2026-11-04.ts
 */
import { readFileSync } from "node:fs";
import { outstandingNudge, askFor } from "@/lib/outstandingDocument";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : `\n       ${JSON.stringify(got)}`}`); }
};

const LEASE = { key: "lease_contract", label: "Lease Contract" };
const nudge = (prose: string, over: Partial<Parameters<typeof outstandingNudge>[0]> = {}) =>
  outstandingNudge({ prose, outstanding: LEASE, locale: "en", suppressed: true, ...over });

console.log("\nthe loop from pack 12");
// What the guard leaves behind after rewriting the model's block for a file already in.
const REWRITTEN = "Thanks. Now please send Partner 1's Emirates ID.\n\nPartner 1's Emirates ID is already uploaded.";
const n = nudge(REWRITTEN);
check("a control for the missing document is added", Boolean(n) && /```upload\nkey: lease_contract\n```/.test(n!), n);
check("...with a sentence that names it", Boolean(n) && n!.includes("What I still need is the Lease Contract."), n);
check("the sentence comes before the control", Boolean(n) && n!.indexOf("Lease Contract.") < n!.indexOf("```upload"), n);

console.log("\nit fires only after a misfire");
check("nothing was stripped: left alone", nudge(REWRITTEN, { suppressed: false }) === null);
check("nothing outstanding: left alone", nudge(REWRITTEN, { outstanding: null }) === null);
check("no label to name it with: left alone (no unnamed box)", nudge(REWRITTEN, { outstanding: { key: "lease_contract", label: "" } }) === null);

console.log("\nand it does not argue with the reply");
check("the reply said it can wait", nudge("No problem, you can come back to it later on.") === null);
check("...in Arabic too", nudge("لا مشكلة، يمكنك العودة إليه لاحقاً.", { locale: "ar" }) === null);
check("a live control for the same slot is already there",
  nudge("Please upload the lease.\n\n```upload\nkey: lease_contract\n```\n") === null);

console.log("\nArabic");
const ar = nudge("تم استلام الوثيقة.", { locale: "ar", outstanding: { key: "lease_contract", label: "عقد الإيجار" } });
check("the sentence is Arabic", Boolean(ar) && ar!.includes(askFor("عقد الإيجار", "ar")), ar);

console.log("\nthe route wiring");
const route = readFileSync(new URL("../app/api/chat/route.ts", import.meta.url), "utf8");
const at = route.indexOf("AND THEN ASK FOR THE ONE THAT IS ACTUALLY MISSING");
check("it runs inside the suppression branch", at > route.indexOf("if (uploadGuard.suppressed()) {") && at > 0);
check("only a document with no file at all — not one waiting on a date",
  /readiness\.missing\.find\(\(m\) => m\.kind === "document" && !held\.has\(m\.key\)\)/.test(route));
check("never in a message that asked something else", /missingDoc && !asksSomethingElse\(finalText\)/.test(route));
check("it is audited, so a firing is visible", /action: "outstanding_document_asked"/.test(route));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
