/**
 * The entity's own answers, beside the measurement rather than instead of it.
 *
 * The product owner went through the checklist line by line on 16 September
 * (round "Readiness checklist - Mohamed Ali", FB-1737 to FB-1743). Recording
 * those answers is right; letting one of them raise a score is not — "تأكيد
 * وصفي", descriptive assurance, is the thing the guide rules out and the reason
 * the page computes everything from the deployed system in the first place.
 *
 * So this test holds the line: every position is attached to a real criterion
 * and, where it names one, a real check — and no position anywhere is allowed
 * to be the reason a check passes.
 *
 * Run from apps/web:  npx tsx scripts/test-entity-positions-2026-09-16.ts
 */
import { CRITERIA, ENTITY_POSITIONS, assessReadiness } from "../lib/readiness";
import { databaseUrlFrom } from "./lib/envFile";
const i = process.argv.indexOf("--env");
if (i !== -1) process.env.DATABASE_URL = databaseUrlFrom(process.argv[i + 1] ?? "");

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : `\n         ${JSON.stringify(got)}`}`); }
};

console.log("\nEvery answer is attached to something real");
{
  const ids = new Set(CRITERIA.map((c) => c.id));
  check("all seven feedback items are recorded", new Set(ENTITY_POSITIONS.map((p) => p.ref)).size === 7, [...new Set(ENTITY_POSITIONS.map((p) => p.ref))]);
  check("every position names a criterion that exists", ENTITY_POSITIONS.every((p) => ids.has(p.criterionId)), ENTITY_POSITIONS.filter((p) => !ids.has(p.criterionId)));
  check("every position is dated and attributed", ENTITY_POSITIONS.every((p) => p.by && /^\d{4}-\d{2}-\d{2}$/.test(p.on) && /^FB-\d+$/.test(p.ref)));
  check("every position quotes what was asked as well as the answer", ENTITY_POSITIONS.every((p) => p.asked.length > 20 && p.stated.length > 5));
  check("the three kinds are all used", new Set(ENTITY_POSITIONS.map((p) => p.kind)).size === 3);
  // A question asked back is not an answer, and must never read as one. Two of
  // the three still stand: FB-1742's was answered on 16 September — the entity
  // decided the case reference IS the appeal route — and the check honours that
  // decision only where the route it describes actually exists.
  const questions = ENTITY_POSITIONS.filter((p) => p.kind === "question");
  check("the questions asked back are kept as questions", questions.length === 2, questions.map((q) => q.ref));
  check("...and the one they answered is not still listed as a question", !questions.some((q) => q.ref === "FB-1742"));
}

if (!process.env.DATABASE_URL) {
  console.log("\n(no database — skipping the live assessment checks)");
} else {
  console.log("\nA statement does not move a score");
  const r = await assessReadiness();
  check("the report carries the positions", r.positions.length === ENTITY_POSITIONS.length);
  const labels = new Set<string>();
  const failing = new Set<string>();
  for (const s of r.services) for (const c of s.criteria) for (const ch of c.checks) {
    labels.add(ch.label);
    if (!ch.ok && !ch.na) failing.add(ch.label);
  }
  for (const p of ENTITY_POSITIONS) {
    if (!p.check) continue;
    check(`${p.ref}: "${p.check}" is a check that exists`, labels.has(p.check), p.check);
  }

  // THE LINE. Four requirements were answered "this already exists". Two of them
  // are measurable and now measure true — the callback context, verified by
  // executing the tool, and the live charge, read from the entity's own
  // corrections in the audit log. The other two are not true of the deployed
  // system yet, and stay failing however firmly they were stated.
  // A statement alone still closes nothing: this one was stated on 16 September
  // and is still open, because no consent yet names the data it shares.
  check(
    "a stated position never silently closes a gap",
    failing.has("Consent names the data shared and its recipient")
  );
  // What WAS closed was closed by code. Each of these says "Verified by
  // execution" in its own evidence, which is the probe having run, not a claim.
  const evidenceFor = (criterionId: string, label: string) =>
    r.services[0]?.criteria.find((c) => c.criterionId === criterionId)?.checks.find((c) => c.label === label)?.detail ?? "";
  for (const [criterionId, label] of [
    ["human-handover", "The callback record itself carries the journey context"],
    ["transparency", "That log is readable BY THE CUSTOMER"],
  ] as const) {
    check(`closed by code, not by a claim: ${label}`, !failing.has(label));
    check("...and it says so in its own evidence", /Verified by execution/.test(evidenceFor(criterionId, label)), evidenceFor(criterionId, label));
  }
  // The appeal route is the one place an entity DECISION is honoured — and only
  // because the route it describes exists and was checked for.
  const appeal = evidenceFor("outcome-appeal", "A named route to appeal a decision");
  check("the appeal position is honoured only alongside the route itself", /raises a case on the entity's own queue/.test(appeal), appeal);
  check("...and the service level it still owes is stated", /service level for it is still owed/.test(appeal));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
