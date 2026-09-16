/**
 * The customer's own account of what was done in their name.
 *
 * "يعرض سجلاً مفهوماً لما نفذه باسم المتعامل" — the pre-launch checklist asks
 * for an understandable log, and the action-log artefact fixes its schema: who
 * requested, who executed, whether consent was required and its status, what was
 * done, the result and the reference.
 *
 * The audit trail had all of it and showed none of it to the customer. The PO's
 * answer on 16 September was "all of that is mentioned as part of the journey"
 * (FB-1738) — half right: the assistant narrates each step as it happens, and
 * what nobody could do was come back a week later and read the whole account.
 *
 * Run from apps/web:  npx tsx scripts/test-customer-action-log-2026-09-16.ts
 */
import { renderActionLog, type AuditRow } from "../lib/customerActionLog";
import { runCodeProbe } from "../lib/readiness";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : `\n         ${JSON.stringify(got)}`}`); }
};

const ROWS: AuditRow[] = [
  { action: "integration_write", actor: "system", payload: { tool: "epglsalesforce__submitLicenseRequest" }, createdAt: "2026-09-16T08:00:02Z" },
  { action: "case_submitted", actor: "agent", payload: { reference: "LR-37385" }, createdAt: "2026-09-16T08:00:03Z" },
  { action: "sf_document_attached", actor: "system", payload: { key: "trade_license" }, createdAt: "2026-09-16T08:00:07Z" },
  { action: "sf_document_failed", actor: "system", payload: { key: "moa" }, createdAt: "2026-09-16T08:00:08Z" },
  { action: "payment_initiated", actor: "agent", payload: { reference: "cbcd55cd", amount: 1000 }, createdAt: "2026-09-16T08:01:00Z" },
  { action: "confirmation_email_sent", actor: "system", payload: { to: "emre.karayalcin@7x.ae" }, createdAt: "2026-09-16T08:02:00Z" },
  { action: "consent_declined", actor: "user", payload: { key: "auto_renew_consent" }, createdAt: "2026-09-16T08:03:00Z" },
  { action: "escalation_created", actor: "agent", payload: { reference: "CB-1234" }, createdAt: "2026-09-16T08:04:00Z" },
  // Ours, not theirs. None of these belong in a customer's log.
  { action: "payment_gate", actor: "system", payload: {}, createdAt: "2026-09-16T08:05:00Z" },
  { action: "integration_input_corrected", actor: "system", payload: {}, createdAt: "2026-09-16T08:05:01Z" },
  { action: "blocklist_replaced", actor: "system", payload: {}, createdAt: "2026-09-16T08:05:02Z" },
];

console.log("\nThe artefact's schema, on every line");
{
  const log = renderActionLog(ROWS, { entity: "Emirates Post Group Licensing", caseReference: "LR-37385" });
  check("every entry says who asked", log.every((e) => e.requestedBy));
  check("every entry says who carried it out", log.every((e) => e.executedBy));
  check("every entry says what the consent was", log.every((e) => e.consent));
  check("every entry has a result", log.every((e) => ["ok", "failed", "refused"].includes(e.result)));
  check("the submission carries the reference the customer quotes", log.some((e) => e.reference === "LR-37385"), log);
  check("a failed attachment says it failed", log.some((e) => e.result === "failed" && /moa/i.test(e.action)), log);
  check("a refusal is in the log, not missing from it", log.some((e) => e.result === "refused" && /auto renew/i.test(e.action)), log);
  check("the callback is there with its own reference", log.some((e) => e.reference === "CB-1234"));
  check("it reads forwards", log.every((e, i) => i === 0 || log[i - 1]!.at <= e.at));
}

console.log("\nAnd nothing of ours in it");
{
  const log = renderActionLog(ROWS, {});
  const text = JSON.stringify(log);
  for (const internal of ["payment_gate", "integration_input_corrected", "blocklist_replaced", "payment gate", "blocklist"]) {
    check(`no "${internal}"`, !text.includes(internal), text.slice(0, 200));
  }
  check("an empty trail is an empty log, not an error", renderActionLog([], {}).length === 0);
}

console.log("\nIn the customer's language");
{
  const ar = renderActionLog(ROWS, { locale: "ar", entity: "مجموعة بريد الإمارات للترخيص" });
  check("Arabic actions", ar.some((e) => /تم إرسال طلبك/.test(e.action)), ar[0]);
  check("Arabic consent labels", ar.some((e) => e.consent === "مُعطاة"));
  check("a refusal reads as a refusal", ar.some((e) => e.consent === "مرفوضة"));
  check("the entity is named as it names itself", ar.some((e) => e.action.includes("مجموعة بريد الإمارات للترخيص")));
}

console.log("\nWired where the customer can reach it");
{
  const route = readFileSync(new URL("../app/api/activity/[conversationId]/route.ts", import.meta.url), "utf8");
  check("an endpoint scoped to one conversation", /UUID_RE\.test\(conversationId\)/.test(route));
  check("...that returns the rendered lines and nothing else", /customerActionLog\(conversationId/.test(route) && !/case\.state/.test(route));
  const ui = readFileSync(new URL("../app/embed/[agent]/Experience.tsx", import.meta.url), "utf8");
  check("the panel has a section for it", /t\.activity/.test(ui) && /dlg-activity/.test(ui));
  check("...loaded when the customer asks, not on every turn", /activityOpen/.test(ui));
  check("...and it shows the consent beside each action", /t\.activityConsent/.test(ui));
}

console.log("\nMeasured by running it, not by asserting it");
{
  const probe = await runCodeProbe();
  check("the readiness probe renders the log itself", probe.customerReadableLog, probe);
  const readiness = readFileSync(new URL("../lib/readiness.ts", import.meta.url), "utf8");
  check("the criterion reads the probe, not a flag", /ok: c\.probe\.customerReadableLog/.test(readiness));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
