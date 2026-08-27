import type Anthropic from "@anthropic-ai/sdk";
import type { AgentDefinition, CaseState, Journey, LocalizedString } from "@dialog/config";
import type { AdapterBundle } from "../adapters/types";
import { adapterContext } from "../adapters/registry";
import { setField, setDocument, setJourney, setPayment, findJourney, evalCondition } from "../case/engine";

/** Tool schemas exposed to Claude. Generic across every agent/journey. */
export const TOOL_DEFS: Anthropic.Tool[] = [
  {
    name: "search_knowledge",
    description:
      "Search the approved knowledge base for grounded passages. Use BEFORE answering any licensing/compliance/policy question.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "set_journey",
    description: "Start or switch the active journey (e.g. new_license, renewal) once intent is clear.",
    input_schema: {
      type: "object",
      properties: { journey_key: { type: "string" } },
      required: ["journey_key"],
    },
  },
  {
    name: "collect_field",
    description:
      "Record one collected field value into the case. The value is validated; if invalid you receive a corrective message to relay.",
    input_schema: {
      type: "object",
      properties: {
        key: { type: "string" },
        value: { description: "string, number, boolean, or array for group fields" },
      },
      required: ["key", "value"],
    },
  },
  {
    name: "record_document",
    description:
      "Record the status of a required document (pending/uploaded/accepted/rejected). Actual file bytes are handled by the upload UI.",
    input_schema: {
      type: "object",
      properties: {
        key: { type: "string" },
        status: { type: "string", enum: ["pending", "uploaded", "accepted", "rejected"] },
        file_name: { type: "string" },
        rejection_reason: { type: "string" },
      },
      required: ["key", "status"],
    },
  },
  {
    name: "request_payment",
    description:
      "Initiate payment for a chargeable journey through the payment gateway. Call after the customer confirms the summary and before submit_case. A secure in-chat payment card is shown to the customer automatically — never paste payment links; await confirmation before submitting. Pass amount to charge the authoritative price you obtained from a backend pricing tool (otherwise the journey's configured amount is used).",
    input_schema: {
      type: "object",
      properties: {
        description: { type: "string", description: "What the payment is for" },
        amount: { type: "number", description: "Authoritative amount to charge (e.g. the figure returned by a pricing tool). Overrides the journey's configured amount." },
      },
    },
  },
  {
    name: "lookup",
    description:
      "Read-only lookup into a backend system (e.g. shipment tracking). Use for status/history/ETA inquiries. Never invent results.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", description: "e.g. 'shipment'" },
        identifier: { type: "string", description: "e.g. tracking/AWB number" },
      },
      required: ["kind", "identifier"],
    },
  },
  {
    name: "get_status",
    description:
      "Retrieve the status of the authenticated user's existing application/renewal/request from the system of record (PRD: status & progress tracking). Requires sign-in. Returns status, missing items, and next steps. Never invent status.",
    input_schema: {
      type: "object",
      properties: { reference: { type: "string", description: "Optional case/application reference if the user has one" } },
    },
  },
  {
    name: "submit_case",
    description: "Submit the completed case to the system of record. Only call when readiness is complete, payment (if required) is confirmed, and the user confirms.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "request_escalation",
    description: "File a human callback request in the system of record.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        phone: { type: "string" },
        email: { type: "string" },
        reason: { type: "string" },
      },
      required: ["reason"],
    },
  },
  {
    name: "request_authentication",
    description: "Signal that the user must sign in before a transactional action can proceed.",
    input_schema: {
      type: "object",
      properties: { reason: { type: "string" } },
      required: ["reason"],
    },
  },
];

export type ToolEvent =
  | { type: "case"; state: CaseState }
  | { type: "citation"; source: string }
  | { type: "escalation"; reference: string }
  | { type: "auth_required"; reason: string }
  | { type: "payment_initiated"; reference: string; link?: string; amount: number; currency: string }
  | { type: "lookup"; kind: string }
  | { type: "submitted"; reference: string };

export interface DispatchInput {
  agent: AgentDefinition;
  state: CaseState;
  adapters: AdapterBundle;
  authenticated: boolean;
  userRef?: string;
  locale: string;
  agentId: string;
  caseId: string;
  // Pre-turn intent classification, for confidence gating (PRD AI-governance).
  intent?: { intent: string; confidence: number };
  /**
   * A total the BACKEND has committed to for this transaction — the minimumAmount
   * on an Emirates Post hold. It outranks both the definition's price and the
   * model's, because it is the figure the backend will reconcile the payment
   * against, and it is read from a response rather than remembered.
   */
  authoritativeAmount?: number | null;
}

export interface DispatchResult {
  result: string; // tool_result content returned to the model
  state: CaseState;
  events: ToolEvent[];
  isError?: boolean;
}

/**
 * The customer's email address from the collected case data, for a payment
 * receipt. Returns undefined rather than a guess: a gateway that is handed a
 * non-address rejects the whole order.
 */
function customerEmail(state: CaseState): string | undefined {
  const data = (state.data ?? {}) as Record<string, unknown>;
  const preferred = ["contact_email", "email", "accountant_email", "owner_email"];
  for (const key of [...preferred, ...Object.keys(data)]) {
    const v = data[key];
    if (typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim())) return v.trim();
  }
  return undefined;
}

/** The add-on fees whose condition currently holds. */
export function applicableSurcharges(
  sub: NonNullable<Journey["submission"]>,
  data: Record<string, unknown>
): { key: string; label: LocalizedString; amount: number; when: string }[] {
  return (sub.surcharges ?? []).filter((s) => evalCondition(s.when, data));
}

/**
 * What to charge: the journey's price plus any add-on fee whose condition holds
 * (FB-1430 — the courier fee must be IN the charged total, not a figure the model
 * has to remember).
 *
 * The subtlety that bit us: `override` is whatever the model passed. That is the
 * authoritative figure when a backend pricing tool produced it — but as soon as
 * the model has quoted a total ONCE, the figure it passes next time already
 * contains the fee. Adding to it again charged 300 -> 325 -> 350 across repeated
 * payment links for the same unchanged selection. So whenever a fee applies, the base
 * comes from the journey definition and the override is ignored; the result is
 * then the same no matter how many times a link is reissued.
 */
export function chargeableAmount(
  sub: NonNullable<Journey["submission"]>,
  data: Record<string, unknown>,
  override?: number
): number {
  const surchargeTotal = applicableSurcharges(sub, data).reduce((sum, s) => sum + s.amount, 0);
  // A journey that declares fees AND carries its own price is computed entirely
  // from the definition. The override is ignored even when no fee currently
  // applies: it is whatever the model last quoted, so on a switch BACK to the
  // free option it still carries the old fee and the customer keeps paying it.
  if ((sub.surcharges ?? []).length > 0 && sub.amount !== undefined) {
    return sub.amount + surchargeTotal;
  }
  // Otherwise the price genuinely comes from a backend pricing tool.
  return (override ?? sub.amount ?? 0) + surchargeTotal;
}

export async function dispatchTool(
  name: string,
  input: Record<string, unknown>,
  ctx: DispatchInput
): Promise<DispatchResult> {
  const { agent, adapters } = ctx;
  let state = ctx.state;
  const events: ToolEvent[] = [];

  switch (name) {
    case "search_knowledge": {
      if (!adapters.knowledge) return { result: "No knowledge base configured.", state, events };
      const actx = adapterContext(agent, agent.integrations.knowledge);
      const hits = await adapters.knowledge.search(actx, {
        agentId: ctx.agentId,
        query: String(input.query ?? ""),
        locale: ctx.locale,
      });
      for (const h of hits) events.push({ type: "citation", source: h.source });
      if (!hits.length) return { result: "No relevant passages found in the approved knowledge base.", state, events };
      return {
        result: hits.map((h, i) => `[${i + 1}] (${h.source})\n${h.content}`).join("\n\n"),
        state,
        events,
      };
    }

    case "set_journey": {
      const key = String(input.journey_key ?? "");
      const journey = findJourney(agent, key);
      if (!journey) return { result: `Unknown journey "${key}".`, state, events, isError: true };
      // PRD AI-governance: a TRANSACTIONAL journey (auth or payment required) may
      // only be initiated when goal-resolution confidence ≥ proceed band. Between
      // clarify..proceed the model must ask a clarifying question; below clarify it
      // must not initiate. This is deterministic, not left to model discretion.
      const transactional = journey.requiresAuth || Boolean(journey.submission);
      const conf = ctx.intent?.confidence;
      // The gate asks ONCE. It scores each turn on its own, and the turn where the
      // customer answers is "Yes, rent a new PO Box" — an affirmation with no
      // intent signal in it, which scores lower than the message that raised the
      // gate in the first place. Re-running the same test on that turn refuses
      // again, and the customer confirms forever. So a journey already asked about
      // proceeds on the next call, which is exactly what the refusal below tells
      // the model to do.
      const alreadyAsked = state.confirmedJourneys?.includes(key) ?? false;
      if (transactional && conf !== undefined && !alreadyAsked) {
        const g = agent.guardrails.goalThresholds;
        const remember = { ...state, confirmedJourneys: [...(state.confirmedJourneys ?? []), key] };
        // Emitted as a case event, not just returned: the route rebuilds the state
        // it persists from these events, so a marker that is only returned is lost
        // at the end of the turn and the gate asks all over again.
        if (conf < g.proceed) events.push({ type: "case", state: remember });
        if (conf < g.clarify) {
          return {
            result: `Goal confidence ${conf.toFixed(2)} is below ${g.clarify}. Do NOT initiate this transactional journey yet. Ask the customer ONE clarifying question to confirm what they want, then call set_journey("${key}") again — that call will proceed. Do NOT ask twice, and do NOT offer a callback over this: it is a confirmation step, not a failure.`,
            state: remember,
            events,
            isError: true,
          };
        }
        if (conf < g.proceed) {
          return {
            result: `Goal confidence ${conf.toFixed(2)} is between ${g.clarify} and ${g.proceed}. Briefly confirm the customer's intent with ONE question before starting "${key}", then call set_journey("${key}") again — that call will proceed. Do NOT ask twice, and do NOT offer a callback over this.`,
            state: remember,
            events,
            isError: true,
          };
        }
      }
      if (journey.requiresAuth && !ctx.authenticated) {
        events.push({ type: "auth_required", reason: `Starting ${journey.key} requires sign-in.` });
        return { result: "This journey requires an authenticated user. Ask them to sign in.", state, events };
      }
      state = setJourney(agent, state, key);
      // Prefill fields held by the system of record (PRD: do not re-ask for data
      // already held — renewals). Resolves field.prefillFrom via crm.getRecord.
      if (ctx.authenticated && adapters.crm?.getRecord) {
        const prefillFields = journey.steps.flatMap((s) => s.fields).filter((f) => f.prefillFrom);
        if (prefillFields.length) {
          const actx = adapterContext(agent, agent.integrations.crm);
          const record = await adapters.crm.getRecord(actx, { journeyKey: key, userRef: ctx.userRef ?? "" });
          if (record) {
            let data = { ...state.data };
            const filled: string[] = [];
            for (const f of prefillFields) {
              const src = f.prefillFrom!.split(".").pop()!; // e.g. "crm.license" -> "license"
              const val = record[src] ?? record[f.key];
              if (val !== undefined && data[f.key] === undefined) { data[f.key] = val; filled.push(f.key); }
            }
            if (filled.length) {
              state = setJourney(agent, { ...state, data }, key);
              events.push({ type: "case", state });
              return { result: `Journey set to ${key}. Prefilled from records: ${filled.join(", ")} (do not re-ask these). First step: ${state.currentStep}.`, state, events };
            }
          }
        }
      }
      events.push({ type: "case", state });
      return { result: `Journey set to ${key}. First step: ${state.currentStep}.`, state, events };
    }

    case "collect_field": {
      const fieldKey = String(input.key);
      const { state: next, error } = setField(agent, state, fieldKey, input.value);
      if (error) return { result: `Validation failed: ${error.message}`, state, events, isError: true };
      state = next;
      // Consent/acknowledgment fields (e.g. the EPGL Declaration & Undertaking
      // checkbox) are legal acceptances: stamp the server date+time alongside the
      // value so the acceptance is recorded with when it happened, not just that
      // it happened.
      const truthy = input.value === true || /^(true|yes|نعم|1)$/i.test(String(input.value));
      if (truthy && /(_accepted|_consent|_acknowledged)$/.test(fieldKey) && !fieldKey.endsWith("_at")) {
        const stampedAt = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";
        state = setField(agent, state, `${fieldKey}_at`, stampedAt).state;
        events.push({ type: "case", state });
        return { result: `Saved ${fieldKey} and recorded the acceptance timestamp ${fieldKey}_at = "${stampedAt}". Readiness: ${state.readiness.complete ? "complete" : `missing ${state.readiness.missing.map((m) => m.key).join(", ")}`}.`, state, events };
      }
      events.push({ type: "case", state });
      return { result: `Saved ${fieldKey}. Readiness: ${state.readiness.complete ? "complete" : `missing ${state.readiness.missing.map((m) => m.key).join(", ")}`}.`, state, events };
    }

    case "record_document": {
      state = setDocument(agent, state, {
        key: String(input.key),
        status: input.status as CaseState["documents"][number]["status"],
        fileName: input.file_name as string | undefined,
        rejectionReason: input.rejection_reason as string | undefined,
      });
      events.push({ type: "case", state });
      return { result: `Document ${input.key} -> ${input.status}.`, state, events };
    }

    case "request_authentication": {
      // FB-1485: an already-authenticated customer must never be sent back through
      // sign-in. Enforced here so a model slip (or a backend authorisation error it
      // misreads as a session problem) cannot surface a sign-in prompt mid-journey.
      if (ctx.authenticated) {
        return {
          result:
            "IGNORE THIS CALL: the customer is already signed in and verified. Do not ask them to sign in, do not tell them their session expired, and do not surface a sign-in prompt. If a backend call failed, say that detail is unavailable right now and continue.",
          state,
          events,
          isError: true,
        };
      }
      events.push({ type: "auth_required", reason: String(input.reason ?? "") });
      return { result: "Authentication prompt surfaced to the user.", state, events };
    }

    case "request_escalation": {
      if (!adapters.crm) return { result: "No CRM configured for escalation.", state, events, isError: true };
      const actx = adapterContext(agent, agent.integrations.crm);
      const { reference } = await adapters.crm.createCallback(actx, {
        name: String(input.name ?? "Unknown"),
        phone: String(input.phone ?? ""),
        email: input.email as string | undefined,
        reason: String(input.reason ?? ""),
        userRef: ctx.userRef,
      });
      state = { ...state, status: "escalated" };
      events.push({ type: "escalation", reference });
      events.push({ type: "case", state });
      return { result: `Callback created with reference ${reference}.`, state, events };
    }

    case "lookup": {
      if (!adapters.lookup) return { result: "No lookup system configured.", state, events, isError: true };
      const actx = adapterContext(agent, agent.integrations.lookup);
      const rec = await adapters.lookup.lookup(actx, {
        kind: String(input.kind ?? ""),
        identifier: String(input.identifier ?? ""),
        locale: ctx.locale,
      });
      events.push({ type: "lookup", kind: String(input.kind ?? "") });
      if (!rec) return { result: "No record found for that identifier. Ask the customer to verify it, or offer support.", state, events };
      return { result: JSON.stringify(rec), state, events };
    }

    case "get_status": {
      // PRD: status & progress tracking for an authenticated user's request.
      if (!ctx.authenticated) {
        events.push({ type: "auth_required", reason: "Checking your application status requires sign-in." });
        return { result: "User must authenticate before status can be retrieved.", state, events };
      }
      if (!adapters.crm?.getStatus) return { result: "No system of record configured for status lookups.", state, events, isError: true };
      const actx = adapterContext(agent, agent.integrations.crm);
      const status = await adapters.crm.getStatus(actx, {
        reference: (input.reference as string | undefined) ?? state.reference ?? undefined,
        userRef: ctx.userRef ?? "",
      });
      if (!status) return { result: "No matching application/request was found for this customer. Offer to start a new one or a callback.", state, events };
      return {
        result: `Status: ${status.status}. Missing: ${status.missing.length ? status.missing.join(", ") : "none"}. Next steps: ${status.nextSteps.join("; ") || "—"}. Explain this to the customer in plain language; do not invent details.`,
        state,
        events,
      };
    }

    case "request_payment": {
      const journey = findJourney(agent, state.journeyKey);
      const sub = journey?.submission;
      if (!sub?.requiresPayment) return { result: "This journey does not require payment.", state, events };
      // Compliance gate: a journey that declares a terms_accepted field requires
      // an explicit Terms & Conditions acceptance BEFORE any payment. Enforced
      // server-side so the model cannot skip the checkbox.
      const declaresTerms = journey?.steps.some((s) => s.fields.some((f) => f.key === "terms_accepted"));
      const termsVal = state.data["terms_accepted"];
      const termsAccepted = termsVal === true || /^(true|yes|نعم|1)$/i.test(String(termsVal ?? ""));
      if (declaresTerms && !termsAccepted) {
        return {
          result:
            "PAYMENT BLOCKED: the customer has not accepted the Terms and Conditions yet. Before payment, present the mandatory acknowledgment as a ```toggles block with `style: checkbox`, a single item `- terms_accepted: <label linking to the Terms and Conditions>`, and a confirm button. When the customer confirms, record it with collect_field(terms_accepted, true) — the acceptance timestamp is stamped automatically — then call request_payment again.",
          state,
          events,
          isError: true,
        };
      }
      // Only auth-required journeys (e.g. new rentals) gate payment on sign-in.
      // Guest-allowed journeys (e.g. renewals) may pay after ownership validation.
      if (journey?.requiresAuth && !ctx.authenticated) {
        events.push({ type: "auth_required", reason: "Payment requires sign-in." });
        return { result: "User must authenticate before payment.", state, events };
      }
      if (!adapters.payment) return { result: "No payment gateway configured.", state, events, isError: true };
      const overrideAmount = typeof input.amount === "number" && input.amount > 0 ? input.amount : undefined;
      const currency = sub.currency ?? "AED";
      // A price the backend has quoted wins outright. The definition's figure is
      // the advertised annual rental (300 for MyBox) and misses the mandatory
      // registration fee, so the customer was charged 300 against a 370 hold —
      // the summary said 370, the card said 300, and the two never met.
      const backendAmount =
        typeof ctx.authoritativeAmount === "number" && ctx.authoritativeAmount > 0
          ? ctx.authoritativeAmount
          : undefined;
      const amount = backendAmount ?? chargeableAmount(sub, state.data, overrideAmount);
      const applicable = applicableSurcharges(sub, state.data);
      const actx = adapterContext(agent, agent.integrations.payment);
      const res = await adapters.payment.initiate(actx, {
        caseId: ctx.caseId,
        amount,
        currency,
        description: String(input.description ?? journey?.key ?? "service"),
        userRef: ctx.userRef,
        email: customerEmail(state),
        locale: ctx.locale,
      });
      state = setPayment(state, {
        status: res.status,
        reference: res.reference,
        link: res.link ?? null,
        amount,
        currency,
      });
      events.push({ type: "payment_initiated", reference: res.reference, link: res.link, amount, currency });
      events.push({ type: "case", state });
      const breakdown = applicable.length
        ? ` The total includes ${applicable
            .map((s) => `${s.label.en} ${s.amount} ${currency}`)
            .join(" + ")} on top of ${amount - applicable.reduce((sum, s) => sum + s.amount, 0)} ${currency} — state this breakdown to the customer so no fee is a surprise.`
        : "";
      return {
        result: `Payment ${res.reference} initiated for ${amount} ${currency}.${breakdown} A secure "Pay now" card is now displayed to the customer inside the chat — do NOT paste any payment link or URL. Briefly tell them to complete the payment using the secure payment card shown below your message, then wait for payment confirmation before calling submit_case.`,
        state,
        events,
      };
    }

    case "submit_case": {
      const subJourney = findJourney(agent, state.journeyKey);
      // Auth-required journeys gate submission on sign-in; guest-allowed journeys
      // (renewals) submit after ownership validation, no account needed.
      if (subJourney?.requiresAuth && !ctx.authenticated) {
        events.push({ type: "auth_required", reason: "Submission requires sign-in." });
        return { result: "User must authenticate before submission.", state, events };
      }
      if (subJourney?.submission?.requiresPayment && state.payment.status !== "paid") {
        return {
          result: `Cannot submit — payment is ${state.payment.status}. Only a confirmed (paid) payment may trigger submission.`,
          state,
          events,
          isError: true,
        };
      }
      if (!state.readiness.complete) {
        return {
          result: `Cannot submit — missing: ${state.readiness.missing.map((m) => `${m.key} (${m.kind})`).join(", ")}.`,
          state,
          events,
          isError: true,
        };
      }
      if (!adapters.crm) return { result: "No CRM configured.", state, events, isError: true };
      const actx = adapterContext(agent, agent.integrations.crm);
      // Duplicate guard (PRD: surface existing reference instead of creating a duplicate).
      const dup = await adapters.crm.findDuplicate?.(actx, {
        journeyKey: state.journeyKey!,
        data: state.data,
      });
      if (dup) {
        return { result: `An active request already exists: ${dup.reference}. Surface it instead of creating a duplicate.`, state, events };
      }
      // Uploaded documents travel WITH the submission (feedback FB-1401: customer
      // documents, e.g. the trade license, are saved to the PO Box record like the
      // website flow — not left behind in chat storage).
      const attachedDocs = state.documents
        .filter((d) => d.status === "uploaded" || d.status === "accepted")
        .map((d) => ({ key: d.key, fileName: d.fileName ?? "", status: d.status }));
      const { reference } = await adapters.crm.createCase(actx, {
        journeyKey: state.journeyKey!,
        data: attachedDocs.length ? { ...state.data, _documents: attachedDocs } : state.data,
        userRef: ctx.userRef,
      });
      state = { ...state, status: "submitted", reference };
      events.push({ type: "submitted", reference });
      events.push({ type: "case", state });
      return { result: `Submitted. Reference: ${reference}.`, state, events };
    }

    default:
      return { result: `Unknown tool ${name}.`, state, events, isError: true };
  }
}
