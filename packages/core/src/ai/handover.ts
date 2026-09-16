import type { AgentDefinition, CaseState } from "@dialog/config";

/**
 * What the officer needs to know before they pick up the phone.
 *
 * The context-transfer artefact asks that the request, its context and the
 * actions already taken move to the human with the case — "ينتقل الطلب والسياق
 * والإجراءات السابقة إلى الموظف". What actually moved was a name, a phone
 * number and the customer's own sentence: everything else was in our admin
 * console, which the person taking the callback does not open.
 *
 * The cost of that is paid by the customer. They explain it again, and the first
 * thing a re-explained journey loses is the part they already consented to — so
 * the do-not-re-ask list is not a convenience, it is what stops the officer
 * asking for an Emirates ID that was verified twenty minutes ago.
 *
 * Read from the case, never from the conversation: the case is what survived.
 */
export interface HandoverContext {
  /** What the customer is trying to do, in one line. */
  summary: string;
  /** The last step that completed, so the officer can resume rather than restart. */
  lastStep: string;
  /** Fields and documents already held — ask for none of these again. */
  doNotReAsk: string[];
  /** Consents given, with the moment each was given where it was stamped. */
  consents: string[];
  /** Where the money got to. */
  payment: string;
  /** The reference the system of record knows this by, once there is one. */
  caseReference?: string;
}

const val = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
const label = (l: unknown, key: string): string => {
  if (typeof l === "string" && l.trim()) return l.trim();
  if (l && typeof l === "object") {
    const en = (l as Record<string, unknown>).en;
    if (typeof en === "string" && en.trim()) return en.trim();
  }
  return key.replace(/[_-]+/g, " ");
};

export function handoverContext(agent: AgentDefinition, state: CaseState): HandoverContext {
  const journey = agent.journeys?.find((j) => j.key === state.journeyKey);
  const steps = journey?.steps ?? [];
  const data = (state.data ?? {}) as Record<string, unknown>;

  // The last step whose fields are all present — where the officer should pick
  // it up rather than where the conversation happened to stop.
  let lastStep = "";
  for (const s of steps) {
    const required = (s.fields ?? []).filter((f) => f.validation?.required);
    const done = required.length > 0 && required.every((f) => val(data[f.key]));
    if (done) lastStep = label(s.title, s.key);
  }

  const held: string[] = [];
  for (const s of steps) {
    for (const f of s.fields ?? []) {
      // Internal bookkeeping is not something anyone would re-ask for.
      if (f.key.startsWith("__") || !val(data[f.key])) continue;
      if (/_accepted$|_consent$|_acknowledged$|_at$/.test(f.key)) continue;
      held.push(label(f.label, f.key));
    }
  }
  for (const d of state.documents ?? []) {
    if (d.status === "uploaded" || d.status === "accepted") {
      held.push(`${d.key.replace(/[_-]+/g, " ")}${d.fileName ? ` (${d.fileName})` : ""}`);
    }
  }

  const consents: string[] = [];
  for (const [key, v] of Object.entries(data)) {
    if (!/_accepted$|_consent$|_acknowledged$/.test(key) || !val(v)) continue;
    const when = val(data[`${key}_at`]);
    consents.push(`${key.replace(/[_-]+/g, " ")}: ${val(v)}${when ? ` (${when})` : ""}`);
  }

  const pay = state.payment;
  const payment =
    pay?.status === "paid"
      ? `Paid${typeof pay.amount === "number" ? ` ${pay.currency ?? "AED"} ${pay.amount}` : ""}${pay.reference ? `, reference ${pay.reference}` : ""}`
      : pay?.status === "initiated"
        ? "Payment started but not settled — do not take it again without checking"
        : pay?.status === "failed"
          ? "A payment attempt failed"
          : "Nothing paid";

  return {
    summary: journey ? label(journey.title, journey.key) : "No journey started",
    lastStep: lastStep || "Nothing completed yet",
    doNotReAsk: [...new Set(held)],
    consents,
    payment,
    caseReference: val(state.referenceLabel) || val(state.reference) || undefined,
  };
}

/** The same context as a block of text, for a case note or an email body. */
export function renderHandover(c: HandoverContext): string {
  return [
    `Request: ${c.summary}`,
    c.caseReference ? `Case reference: ${c.caseReference}` : "",
    `Last completed step: ${c.lastStep}`,
    `Payment: ${c.payment}`,
    c.consents.length ? `Consents given: ${c.consents.join("; ")}` : "Consents given: none",
    c.doNotReAsk.length
      ? `ALREADY PROVIDED — do not ask for these again: ${c.doNotReAsk.join(", ")}`
      : "ALREADY PROVIDED — nothing yet",
  ]
    .filter(Boolean)
    .join("\n");
}
