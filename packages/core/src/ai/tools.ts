import type Anthropic from "@anthropic-ai/sdk";
import { tr, type AgentDefinition, type CaseState, type Journey, type LocalizedString, type Locale } from "@dialog/config";
import type { AdapterBundle } from "../adapters/types";
import { handoverContext } from "./handover";
import { adapterContext } from "../adapters/registry";
import { setField, setDocument, setJourney, setPayment, findJourney, evalCondition } from "../case/engine";
import { RECORD_IDENTITY } from "./extract";

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
  /**
   * A consent refused or withdrawn, with the action it stopped.
   *
   * The consent log filed with the entity carries مرفوضة and مسحوبة rows
   * alongside the granted ones. Without this the negative path left nothing
   * behind: a refusal looked exactly like never having been asked.
   */
  | { type: "consent_declined"; field: string; outcome: "refused" | "withdrawn"; at: string; halted: string }
  | { type: "lookup"; kind: string }
  | { type: "submitted"; reference: string };

/**
 * Did the customer say a partner is outside the UAE?
 *
 * Deliberately generous about HOW they say it and strict about whether they did.
 * The button we offer sends its own label, so that case is exact; the rest is
 * for someone typing it themselves, in either language.
 */
/**
 * An acceptance, and the companion field that records WHEN.
 *
 * Emirates Post, 15 September: "stamp the server time alongside each acceptance
 * so the moment of consent is auditable."
 *
 * There were timestamps already — `declaration_accepted_at` on EPGL has been
 * filling in for weeks — and the guidance says "the system automatically records
 * the acceptance DATE AND TIME". Nothing did. The model was writing them, in its
 * own format ("2026-09-13 17:39:27 UTC"), from whatever it believed the time to
 * be. That is a record of what the model thought, not of when somebody agreed,
 * and it is exactly what "server time" is asking for.
 *
 * NXN had none at all: terms_accepted, save_card_consent and auto_renew_consent
 * across four journeys, every one of them a bare true with no moment attached.
 */
const CONSENT_FIELD = /(_accepted|_consent|_acknowledged)$/;
const CONSENT_STAMP = /(_accepted|_consent|_acknowledged)_at$/;

/** Was this value an agreement, as opposed to a correction or a refusal? */
function isAgreement(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  const v = String(value ?? "").trim().toLowerCase();
  return v === "true" || v === "yes" || v === "1" || v === "نعم";
}

/**
 * One person's name written two ways, loosely enough for a registry and a
 * licence to agree.
 *
 * Deliberately containment rather than the careful part-matching used for
 * identity documents: this decides whether to TRUST a registry statement about
 * somebody, and the registry is the stricter of the two sources. A name that
 * does not clearly correspond simply falls back to asking the customer.
 */
export function sameHuman(a: string, b: string): boolean {
  const n = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const x = n(a);
  const y = n(b);
  if (x.length < 4 || y.length < 4) return false;
  return x === y || x.includes(y) || y.includes(x);
}

export function saysNonResident(message: string | undefined): boolean {
  const m = String(message ?? "").toLowerCase();
  if (!m) return false;
  return (
    /\bnon[- ]?resident\b/.test(m) ||
    /\b(lives?|living|based|resides?|residing)\s+(outside|abroad|overseas)/.test(m) ||
    /\boutside\s+(the\s+)?(uae|country|emirates)\b/.test(m) ||
    /\b(abroad|overseas)\b/.test(m) ||
    /\b(does\s*n[o']?t|doesn't|has\s+no|no)\s+(have\s+)?(an?\s+)?emirates\s*id\b/.test(m) ||
    /غير\s*مقيم/.test(m) ||
    /خارج\s*(الدولة|الإمارات|البلاد)/.test(m) ||
    /لا\s*(يملك|يوجد|توجد|تملك)\s*(لديه\s*)?هوية/.test(m)
  );
}

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
   * What the customer actually said this turn.
   *
   * Used by exactly one guard, and only to answer "did they say this, or did we
   * decide it for them". Never for routing, never for content.
   */
  userMessage?: string;
  /**
   * People the Ministry of Economy's registry marks as NOT resident in the UAE,
   * by name, for licences it names this customer on.
   *
   * The guard below exists because the model inferred non-residence from a
   * passport. The registry stating `isManagerResidentofUAE: false` about a named
   * person is not an inference — it is the better evidence, and it is the one
   * source that can answer the question without asking anybody.
   */
  registryNonResidents?: () => string[];
  /**
   * A total the BACKEND has committed to for this transaction — the minimumAmount
   * on an Emirates Post hold. It outranks both the definition's price and the
   * model's, because it is the figure the backend will reconcile the payment
   * against, and it is read from a response rather than remembered.
   */
  authoritativeAmount?: number | null;
  /**
   * An amount the SERVER adds to this journey's fee, with a name for it.
   *
   * For EPGL's renewal: the penalties Salesforce holds as approved and unpaid.
   * Read per company at lookup time, so it cannot live in the journey's
   * configuration, and never left to the model to add.
   */
  extraCharge?: { amount: number; label: string } | null;
  /**
   * Save tools that record against a reservation the backend issued earlier, and
   * whether such a reservation currently exists. Kept as data rather than a
   * prepared message because the decision needs the journey as it is AT THE MOMENT
   * OF THE CALL: computing it from the turn's opening state saw journeyKey null
   * whenever the journey was started in the same turn, so the check silently did
   * not apply on exactly the run it was written for.
   */
  holdBackedSaveTools?: string[];
  holdPresent?: boolean;
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
/**
 * What a refused consent stops from happening.
 *
 * Read off the journey rather than written down twice: the acceptance a
 * chargeable journey gates payment on stops the payment, anything a submission
 * needs stops the submission, and the rest stop the step they belong to. Stated
 * in the customer's terms, because the consent log is read by people.
 */
export function haltedBy(agent: AgentDefinition, state: CaseState, fieldKey: string): string {
  const journey = findJourney(agent, state.journeyKey);
  const sub = journey?.submission;
  if (fieldKey === "terms_accepted" && (sub?.requiresPayment || sub?.amount)) {
    return "payment and submission of the request";
  }
  const required = (journey?.steps ?? []).some((st) =>
    st.fields.some((f) => f.key === fieldKey && f.validation?.required)
  );
  if (required) return "submission of the request";
  return "the step this acceptance belongs to";
}

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

/**
 * Round to fils. 1% of 12,345 is 123.45, and a gateway takes minor units -- a
 * float left unrounded reaches N-Genius as 12345.000000000002 and is refused.
 */
function toFils(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * The percentage fee to add on top, and what to call it.
 *
 * ON TOP, not carved out: 100,000 at 1% is charged as 101,000, which is what
 * EPGL confirmed. Returns zero when the journey declares none or its condition
 * does not hold -- a journey offering both a gateway and the VIBAN route must
 * only charge it on the gateway.
 */
export function processingFeeFor(
  sub: NonNullable<Journey["submission"]>,
  data: Record<string, unknown>,
  base: number
): { amount: number; label?: LocalizedString; percent?: number } {
  const fee = sub.processingFee;
  if (!fee || !(base > 0)) return { amount: 0 };
  if (fee.when && !evalCondition(fee.when, data)) return { amount: 0 };
  return { amount: toFils(base * (fee.percent / 100)), label: fee.label, percent: fee.percent };
}

/** Which document supplied each field. Written by the upload route. */
export const DOC_FIELDS_KEY = "__doc_fields";

/**
 * How to tell a customer to reach a person, for THIS entity.
 *
 * Emirates Post's 600 599 999 was written into both of these, for every agent,
 * so an EPGL licensing failure on 16 September sent the applicant to the PO Box
 * helpline about a postal activity licence. Whoever answers there cannot help
 * with it.
 *
 * An entity that has given us a contact route gets it quoted; one that has not
 * gets its name and no number, because inventing a phone number for a government
 * service is worse than admitting we do not have one.
 */
function supportRoute(agent: { name: string; supportContact?: string; theme?: { brandName?: string } }): string {
  const who = agent.theme?.brandName?.trim() || agent.name;
  const contact = agent.supportContact?.trim();
  return contact
    ? `Give them ${who}'s contact route so they can reach someone themselves: ${contact}.`
    : `Tell them to contact ${who} directly through their usual channel — do NOT invent a phone number, email address or link for them.`;
}
/** Set once the customer edits a detail their trade licence had supplied. */
export const LICENCE_CHANGED_KEY = "__licence_changed";

/** Document slots that ARE the trade licence, whatever the journey calls them. */
const LICENCE_DOC = /^(updated_)?trade_licen[cs]e$|^initial_approval$/i;

/**
 * Details the customer may change freely, even though the licence printed them.
 *
 * A trade licence carries a contact email and phone, so extraction fills those
 * fields from it -- and the first version of this rule then treated updating an
 * email as amending the trade licence: it asked for a new licence copy and put
 * the renewal down the Licensing-team route. The client's own validation sheet
 * marks contact email, phone, name and designation "Allow client to change".
 *
 * Matched by pattern rather than an exact list because these keys are named
 * differently per journey (contact_email, owner_contact_no, applicant_phone),
 * and the failure of missing one is loud and wrong in the customer's face.
 */
const CUSTOMER_EDITABLE = /(^|_)(email|phone|mobile|contact_no|contact_number|designation)$|^contact_name$|_contact_(name|no|number)$/i;

/**
 * The fields whose change actually means the licence copy is superseded.
 *
 * An ALLOW-LIST, and it used to be the other way round: every field the trade
 * licence had supplied counted, minus a few exceptions. That default is wrong in
 * the direction that hurts, because the penalty is refusing the customer's
 * perfectly current trade licence and blocking the application on an upload that
 * would change nothing.
 *
 * It bit twice in one day. First activity_codes: the licence's DED activities
 * ("Coffee Shop, Restaurant") against the postal services the applicant is
 * actually applying for -- two different things that were never going to match.
 * Then address_street: the licence was read in Arabic, the customer restated the
 * SAME address in English, and their licence was rejected for it.
 *
 * These four are the licence's printed identity. If one of them changes, the
 * copy on file genuinely no longer evidences the application and a current one
 * has to be asked for -- the company-name case the client raised. Everything
 * else on a licence is context: an address phrased differently, an activity list
 * that answers a different question, a contact detail that is the customer's own
 * to give. A new field defaults to "not a contradiction", which is the safe way
 * round.
 */
const LICENCE_IDENTITY = /^(company_name(_ar|_en)?|trade_(license|licence)_number|(license|licence)_expiry_date|(license|licence)_issue_date)$/i;

/**
 * The document that supplied a field, if one did.
 *
 * `__doc_fields` maps each uploaded document to the fields its extraction
 * filled, so when the customer edits one of those values we know which document
 * no longer says what the application says.
 */
export function documentThatSupplied(state: CaseState, fieldKey: string): string | null {
  const map = state.data[DOC_FIELDS_KEY];
  if (!map || typeof map !== "object") return null;
  for (const [docKey, fields] of Object.entries(map as Record<string, unknown>)) {
    if (Array.isArray(fields) && fields.includes(fieldKey)) return docKey;
  }
  return null;
}

/**
 * Did editing this field just contradict the trade licence on file?
 *
 * A renewal where the customer changes a licence detail -- the company name is
 * the case the client raised -- is a different transaction from a plain renewal:
 * it is not issued within a working day, it goes to the Licensing team, and it
 * gets a different confirmation. Leaving that judgement to the model means the
 * customer is sometimes promised a licence tomorrow that is not coming.
 *
 * It is also the moment the uploaded copy stops being evidence. The licence that
 * was read to fill "company name" still shows the OLD name, so it no longer
 * supports the application and a current copy has to be asked for.
 */
export function licenceContradiction(
  state: CaseState,
  fieldKey: string,
  newValue: unknown
): { documentKey: string; previous: string } | null {
  // Contact details are the customer's own, whatever document they came off.
  if (CUSTOMER_EDITABLE.test(fieldKey)) return null;
  // Only the licence's printed identity can contradict the licence.
  if (!LICENCE_IDENTITY.test(fieldKey)) return null;
  const before = state.data[fieldKey];
  if (before === undefined || before === null || before === "") return null;
  if (String(before).trim() === String(newValue ?? "").trim()) return null;
  const docKey = documentThatSupplied(state, fieldKey);
  if (!docKey || !LICENCE_DOC.test(docKey)) return null;
  return { documentKey: docKey, previous: String(before) };
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
        // The journey's TITLE, not its key. "Starting personal_po_box_rental
        // requires sign-in" put a database identifier in front of a customer.
        events.push({
          type: "auth_required",
          reason: `${tr(journey.title, ctx.locale as Locale)} requires sign-in.`,
        });
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
      /**
       * A PARTNER IS NOT NON-RESIDENT BECAUSE OF THEIR PASSPORT.
       *
       * "Non Resident" waives the Emirates ID, so it is the one value in this
       * journey that REMOVES a mandatory document. EPGL asked for it on
       * 11 September and the guidance that came with it said, in capitals, not
       * to infer it from nationality — most UAE residents hold a foreign
       * passport.
       *
       * On the first full run afterwards the model marked a British partner
       * "Non Resident" anyway, and the application submitted without her
       * Emirates ID. Nobody had said she lives abroad.
       *
       * So the value has to come from the CUSTOMER. They set it by answering the
       * question — pressing "This partner lives outside the UAE", or saying it
       * in their own words — and this checks that they did. Re-recording a value
       * already on the case is allowed, so a correction elsewhere in the same
       * turn does not trip over it.
       *
       * The refusal is not silent: the model is told to ask, which is what it
       * should have done.
       */
      if (/^partner_\d+_residence$/.test(fieldKey) && String(input.value ?? "").toLowerCase() === "non resident") {
        const already = String(state.data[fieldKey] ?? "").toLowerCase() === "non resident";
        // Or the registry said so about this partner by name. Matched on the
        // name we hold for that slot, so it cannot be claimed for a partner the
        // registry never mentioned.
        const slot = /^partner_(\d+)_residence$/.exec(fieldKey)?.[1];
        const partnerName = slot ? String(state.data[`partner_${slot}_name`] ?? "") : "";
        const registrySaysSo = partnerName
          ? (ctx.registryNonResidents?.() ?? []).some((n) => sameHuman(n, partnerName))
          : false;
        if (!already && !registrySaysSo && !saysNonResident(ctx.userMessage)) {
          return {
            result:
              "NOT RECORDED. Only the customer can say a partner lives outside the UAE — a foreign passport does not make somebody a non-resident, and most UAE residents hold one. " +
              "Ask them, once, with three choices: upload the Emirates ID, type the number, or \"this partner lives outside the UAE\". Record this only after they have chosen the third.",
            state,
            events,
            isError: true,
          };
        }
      }
      /**
       * WHO THE COMPANY'S PEOPLE ARE IS NOT THE ASSISTANT'S TO DECIDE.
       *
       * 22 September. A tester uploaded somebody else's Emirates ID against a
       * sole establishment, and the assistant — having noticed the mismatch and
       * said so, which was the right instinct — offered two buttons:
       *
       *   [ Valentina Mintah is the correct partner ]  [ I'll upload the correct Emirates ID ]
       *
       * The first of those is not a choice anybody in this conversation is
       * entitled to make. The partners of a company are printed on its trade
       * licence and held in the licensing register; changing them is a filing
       * with the licensing authority, not a button in a chat. Pressing it would
       * have written the stranger into partner 1 and submitted her to Salesforce
       * as an owner of the business.
       *
       * So the model cannot record these at all, and the refusal says why:
       *
       *  - partner / member / shareholder names and nationalities are optional
       *    fields copied off the licence and the MOA by the document extraction,
       *    which is unaffected by this. Refusing every write to them cannot stall
       *    an application, because nothing requires them of the customer.
       *  - the OWNER's name is required, so a first write stays possible for the
       *    application whose licence would not read. Only a CHANGE is refused —
       *    which is the move that rewrites the register.
       */
      if (RECORD_IDENTITY.test(fieldKey)) {
        const held = state.data[fieldKey];
        const onFile = held !== undefined && held !== null && String(held).trim() !== "";
        const ownerSlot = /^owner_/i.test(fieldKey);
        const wouldChange = onFile && String(held).trim() !== String(input.value ?? "").trim();
        if (wouldChange || (!ownerSlot && !onFile)) {
          return {
            result:
              `NOT RECORDED, and do not try again. "${fieldKey}" is part of the company's registered details — who its ` +
              `owner, partners and licence members are. Those come from the trade licence, the Memorandum of ` +
              `Association and the licensing register, and this application copies them; it does not set them. ` +
              (wouldChange
                ? `The record says "${String(held)}". `
                : ``) +
              `NEVER offer the customer an option that changes who a partner is — not as a button, not as a ` +
              `sentence. If an uploaded identity document names somebody the licence does not, the document is the ` +
              `wrong one for this application: ask for the right person's, and if the customer says the register ` +
              `itself is out of date, tell them that change has to be made with the licensing authority first and ` +
              `the updated trade licence uploaded here.`,
            state,
            events,
            isError: true,
          };
        }
      }
      // Checked BEFORE the write, while the previous value is still there.
      const contradicts = licenceContradiction(state, fieldKey, input.value);
      /**
       * The moment of consent is ours to record, not the model's to remember.
       * A `*_at` the model offers is dropped on the floor: it is either right by
       * luck or wrong by a day, and neither is an audit trail.
       */
      if (CONSENT_STAMP.test(fieldKey)) {
        return {
          result:
            "IGNORED. Acceptance timestamps are stamped by the server the moment the customer agrees — record the acceptance itself and the time is written for you. Never state, guess or repeat one.",
          state,
          events,
          isError: true,
        };
      }
      // Held before the write, so a `false` arriving over a `true` is reported
      // as a WITHDRAWAL rather than a refusal — the artefact distinguishes them.
      const wasAgreed = isAgreement(state.data[fieldKey]);
      const { state: next, error } = setField(agent, state, fieldKey, input.value);
      if (error) return { result: `Validation failed: ${error.message}`, state, events, isError: true };
      state = next;
      if (CONSENT_FIELD.test(fieldKey) && isAgreement(input.value)) {
        // ISO 8601 in UTC, from this machine's clock at the moment the tool ran.
        // Withdrawing an acceptance clears the stamp with it, so a stale time can
        // never sit beside a `false`.
        state = { ...state, data: { ...state.data, [`${fieldKey}_at`]: new Date().toISOString() } };
      } else if (CONSENT_FIELD.test(fieldKey)) {
        const { [`${fieldKey}_at`]: _dropped, ...rest } = state.data as Record<string, unknown>;
        state = { ...state, data: rest };
        /**
         * A REFUSAL IS AN OUTCOME, NOT AN ABSENCE.
         *
         * The consent log the entity files has مرفوضة and مسحوبة rows — refused
         * and withdrawn — each naming the action that consequently did not
         * happen. Declining used to leave nothing behind but a missing field,
         * which is indistinguishable from never having been asked, and a
         * customer who withdrew an acceptance left no trace of having held it.
         *
         * Recorded with the moment and with what it stopped, so the negative
         * path can be evidenced the same way the positive one is.
         */
        const withdrawn = wasAgreed ? "withdrawn" : "refused";
        events.push({
          type: "consent_declined",
          field: fieldKey,
          outcome: withdrawn,
          at: new Date().toISOString(),
          halted: haltedBy(agent, state, fieldKey),
        });
      }
      if (contradicts) {
        // The copy on file was read to fill this field and still shows the old
        // value, so it no longer evidences the application. Asking for a current
        // one is the point -- and the flag is what decides which confirmation
        // the customer gets, rather than the model remembering that it should.
        state = { ...state, data: { ...state.data, [LICENCE_CHANGED_KEY]: true } };
        state = setDocument(agent, state, {
          key: contradicts.documentKey,
          status: "rejected",
          rejectionReason:
            `This was read from the trade licence on file, which still shows "${contradicts.previous}". ` +
            `Please upload the updated trade licence showing the new details.`,
        });
        events.push({ type: "case", state });
        return {
          result:
            `Saved ${fieldKey}. THIS IS NOW A RENEWAL WITH CHANGES: the value came from the trade licence already ` +
            `uploaded, which still says "${contradicts.previous}", so that copy no longer supports the application ` +
            `and has been marked for re-upload. Ask the customer for the UPDATED trade licence showing the new ` +
            `details. When this application is submitted it must use the CHANGES confirmation wording — the ` +
            `Licensing team will contact them within one working day — and must NOT promise the licence will be ` +
            `issued within one working day, because a renewal with changes is not. ` +
            `Readiness: ${state.readiness.complete ? "complete" : `missing ${state.readiness.missing.map((m) => m.key).join(", ")}`}.`,
          state,
          events,
        };
      }
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
      // A JOURNEY THAT DOES NOT REQUIRE SIGN-IN CANNOT HAVE IT DEMANDED OF IT.
      //
      // EPGL asked us to clarify the login requirement for a new licence. There
      // is not one: neither the intent, nor any step, nor the submission gates on
      // authentication -- a licence application goes through signed in or not.
      // What the applicant met was a sign-in prompt on the first turn, in about
      // one conversation in three, because this tool is called on the model's
      // judgement and its judgement varied. Guidance did not settle it; three
      // identical openings produced two clean runs and one prompt.
      //
      // Scoped as narrowly as it can be: only when a journey is ACTIVE and
      // explicitly declares requiresAuth === false. With no journey in progress
      // the prompt still surfaces -- that is the status-inquiry path, which
      // genuinely reads someone's records back to them -- and an auth-required
      // journey is untouched. The customer can still sign in whenever they like
      // from the header, so nobody is stranded by this; they are only no longer
      // asked to.
      const active = findJourney(agent, state.journeyKey);
      if (active && active.requiresAuth === false) {
        return {
          result:
            "IGNORE THIS CALL: this journey does not require the customer to sign in — not to start it, not to pay, and not to submit. Do not surface a sign-in prompt and do not describe signing in as a requirement. Mention it at most once as optional (it links the application to their account so they can track it later) and carry on either way.",
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
      /**
       * A CALLBACK THAT CANNOT BE ARRANGED IS A SENTENCE, NOT A DEAD CHAT.
       *
       * The ops adapter throws rather than invent a reference for a request
       * nobody will receive, which is right. What was wrong is where the throw
       * went: straight out of the tool, out of the turn, and out of the stream --
       * so a customer whose rental had just been SAVED, order and payment URL and
       * all, sat on "Working on it…" until they gave up. Reported 8 September
       * with NXN_BRANCH_OPS_EMAIL unset on staging and production both.
       *
       * The failure is real and the model should say so. It is not a reason to
       * stop mid-sentence.
       */
      let reference: string;
      try {
        ({ reference } = await adapters.crm.createCallback(actx, {
          name: String(input.name ?? "Unknown"),
          phone: String(input.phone ?? ""),
          email: input.email as string | undefined,
          reason: String(input.reason ?? ""),
          userRef: ctx.userRef,
          journeyKey: state.journeyKey,
          // THE CONTEXT GOES WITH IT. The artefact asks that the request, its
          // context and the actions already taken transfer to the officer; what
          // transferred was a name, a number and the customer's own sentence,
          // with everything else in a console the person taking the call does
          // not open. The cost of that is the customer explaining it twice.
          context: handoverContext(agent, state),
        }));
      } catch (e) {
        return {
          result:
            `The callback could not be arranged: ${e instanceof Error ? e.message : "the request could not be passed on"}. ` +
            `Do NOT give the customer a reference — nobody has received this. Say plainly that you cannot arrange a callback right now, ` +
            `${supportRoute(agent)} ` +
            `Anything already completed in this conversation still stands: if a payment or a booking succeeded, say so and do not suggest it failed.`,
          state,
          events,
          isError: true,
        };
      }
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
      /**
       * AND NEVER TWICE FOR THE SAME THING.
       *
       * The payment artefact promises it in as many words — "لن نطلب منك الدفع
       * مرة أخرى" — and until now the promise was kept by the model
       * remembering, which is not a way to keep a promise about money. Anything
       * that makes the model call this tool again on a settled case opens a
       * second gateway payment: a customer saying "has it gone through?", a
       * retry after a dropped connection, a resumed conversation.
       *
       * A case is settled when its payment reads `paid`. The way OUT of that
       * state is submitting — after which the journey either completes or a new
       * case begins — so refusing here strands nobody: the reply says what was
       * already paid, with its reference, and points at the step that actually
       * remains.
       */
      if (state.payment.status === "paid") {
        const paid = typeof state.payment.amount === "number" ? `${state.payment.amount} ${state.payment.currency ?? sub.currency ?? "AED"}` : "the fee";
        const ref = state.payment.reference ? ` under reference ${state.payment.reference}` : "";
        return {
          result:
            `ALREADY PAID — NOTHING WAS CHARGED AND NOTHING IS WRONG. This case has a confirmed payment of ${paid}${ref}, so no second payment card has been opened. ` +
            `Do NOT ask the customer to pay again, do NOT tell them the payment failed, and do NOT open a payment link. ` +
            (state.status === "submitted"
              ? "The application is already submitted as well — give them the reference and offer to check its status."
              : "Call submit_case now: the payment is settled and submission is the step that remains.") +
            " If they are asking whether the payment went through, the answer is yes.",
          state,
          events,
        };
      }
      // THE APPLICANT CHOSE THE OTHER WAY TO PAY.
      //
      // EPGL's process map offers two payment methods and only one of them is
      // ours. If the applicant picked the Virtual IBAN, opening a gateway card
      // would charge them through a channel they declined -- and Finance would
      // still be raising a VIBAN for the same application. Refused here rather
      // than in a prompt, because "do not call this tool" is exactly the kind of
      // instruction that survives review and fails on the day.
      const method = String(state.data["payment_method"] ?? "").toLowerCase();
      if (method === "viban") {
        return {
          result:
            "PAYMENT BLOCKED: the applicant chose to pay by Virtual IBAN, not through the payment gateway. Do NOT open a payment card. Submit the application if you have not already, then tell them EPGL Finance will email them a Virtual IBAN to transfer the fee to, and that their licence is issued once Finance confirms the transfer. NOTHING has been charged and nothing has gone wrong -- this is the method they picked. If they have changed their mind and want to pay by card now, record it with collect_field(payment_method, gateway) and call request_payment again.",
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
      // NOTHING TO ATTACH THE MONEY TO.
      //
      // EPGL's payment notification keys on the licence request's Salesforce id,
      // and that id does not exist until the composite has been submitted. The
      // order -- duplicate check, submit, then pay -- has been carried in the
      // journey's guidance since 3 September, in competition with a second rule
      // further down the same text, and on 8 September a full run through the
      // journey took payment with the case reference still null: an application
      // nobody had submitted, and AED 1,000 about to settle against it.
      //
      // Prose has now lost this argument twice, so it is decided here.
      if (sub.apiFlow?.submitBeforePayment && !state.reference) {
        return {
          result:
            `PAYMENT BLOCKED: this application has not been submitted yet, so there is nothing for the payment to attach to. ` +
            `Call ${sub.apiFlow.saveTool ?? "the submission tool"} FIRST and keep the reference it returns, then request payment. ` +
            `NOTHING has been charged and nothing has gone wrong — do not tell the customer a payment failed, and do not offer them a link.`,
          state,
          events,
          isError: true,
        };
      }
      // Charging before the thing being paid for exists is the wrong order, and it
      // is the order this journey kept falling into: pay, then discover there is no
      // reservation to attach the payment to, then apologise.
      const saveTool = sub.apiFlow?.saveTool;
      if (saveTool && (ctx.holdBackedSaveTools ?? []).includes(saveTool) && !ctx.holdPresent) {
        return {
          result:
            "PAYMENT BLOCKED: the box has not been reserved yet. Emirates Post records this rental against a hold, so a payment taken now could not be attached to anything. Call the reservation tool for the chosen box FIRST — using its uniqueBoxId, not the box number shown to the customer — and request payment once it succeeds. NOTHING has been charged: do not tell the customer a payment failed, and do not offer a callback.",
          state,
          events,
          isError: true,
        };
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
      // The base, before any percentage fee. A base remembered from an earlier
      // payment on this same unpaid case wins over the model's figure: once a
      // total has been quoted, the number the model passes next time already
      // contains the fee, and adding to it charges 100,000 -> 101,000 -> 102,010
      // across reissued links for one unchanged application.
      // A settled case never reaches here any more — the already-paid refusal
      // above returns first — so this no longer has to exclude "paid" itself.
      const remembered =
        sub.processingFee && typeof state.payment.baseAmount === "number" ? state.payment.baseAmount : undefined;
      /**
       * A CHARGE THE BACKEND ADDS, NOT ONE THE CONFIGURATION KNOWS.
       *
       * EPGL's renewal process map: "System calculates renewal fees and
       * penalties if any" then "Client makes payment accordingly". The penalty
       * is a live figure read off Salesforce for this one company, so it is
       * neither the journey's configured amount nor a surcharge with a `when`
       * — both of those are fixed numbers decided at configuration time.
       *
       * It is added here rather than passed as `amount` by the model, because
       * the model passing a total is how a summary saying 100,700 ends up
       * beside a card charging 118,700. `remembered` is respected first for the
       * same reason it exists: once a total has been quoted on this case, the
       * addend is already inside it and adding again compounds across reissued
       * links.
       */
      const extra = remembered === undefined && ctx.extraCharge && ctx.extraCharge.amount > 0 ? ctx.extraCharge : null;
      const base = toFils((backendAmount ?? remembered ?? chargeableAmount(sub, state.data, overrideAmount)) + (extra?.amount ?? 0));
      const fee = processingFeeFor(sub, state.data, base);
      const amount = toFils(base + fee.amount);
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
        baseAmount: base,
      });
      events.push({ type: "payment_initiated", reference: res.reference, link: res.link, amount, currency });
      events.push({ type: "case", state });
      const surchargeTotal = applicable.reduce((sum, s) => sum + s.amount, 0);
      const parts = [
        ...(extra ? [`${extra.label} ${extra.amount} ${currency}`] : []),
        ...applicable.map((s) => `${s.label.en} ${s.amount} ${currency}`),
        ...(fee.amount > 0 ? [`${fee.label?.en ?? "Processing fee"} ${fee.amount} ${currency} (${fee.percent}%)`] : []),
      ];
      const breakdown = parts.length
        ? ` The total includes ${parts.join(" + ")} on top of ${toFils(amount - surchargeTotal - fee.amount - (extra?.amount ?? 0))} ${currency} — state this breakdown to the customer so no fee is a surprise.`
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
      // Same rule as the callback: a submission that could not be recorded is
      // something to tell the customer, not something to end the turn on.
      let reference: string;
      try {
        ({ reference } = await adapters.crm.createCase(actx, {
          journeyKey: state.journeyKey!,
          data: attachedDocs.length ? { ...state.data, _documents: attachedDocs } : state.data,
          userRef: ctx.userRef,
        }));
      } catch (e) {
        return {
          result:
            `The request could not be recorded: ${e instanceof Error ? e.message : "it could not be passed on"}. ` +
            `Do NOT give the customer a reference and do not tell them it is submitted — nobody has received it. ` +
            `Say plainly that you could not file it. ${supportRoute(agent)} ` +
            `Anything already completed in this conversation still stands and must not be described as failed.`,
          state,
          events,
          isError: true,
        };
      }
      state = { ...state, status: "submitted", reference };
      events.push({ type: "submitted", reference });
      events.push({ type: "case", state });
      return { result: `Submitted. Reference: ${reference}.`, state, events };
    }

    default:
      return { result: `Unknown tool ${name}.`, state, events, isError: true };
  }
}
