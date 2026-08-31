/**
 * Customer Pulse — the UAE government's post-service satisfaction survey.
 *
 * Emirates Post asked for it at the same point their own portal shows it: right
 * after the payment succeeds and the customer sees their confirmation. Their
 * portal does it in two calls, and the published manual documents neither (it is
 * still at v1, describing /api/survey/token/manage/ and a linking_id string). The
 * live v2 API, read from its own OpenAPI document on 31 Aug 2026 and confirmed by
 * running it, wants:
 *
 *   POST /api/v2/transaction/create/   -> cp_transaction_entry
 *   POST /api/v2/survey/token/         -> token, given that entry
 *
 * and linking_id is an OBJECT, not the slash-joined string in the manual.
 *
 * The token identifies one customer and one transaction, so it is minted per
 * completed purchase and never reused. A failure here is invisible to the
 * customer by design: their box is rented either way, and a survey that cannot
 * load is not worth a word of the confirmation.
 */
import { log } from "./logger";

export type PulseService = "rent_personal" | "rent_corporate" | "renew_personal" | "renew_corporate";

export interface PulseCustomer {
  emiratesId?: string | null;
  name?: string | null;
  email?: string | null;
  /** E.164, e.g. +971502040000. */
  mobile?: string | null;
}

const SUB_SERVICE_ENV: Record<PulseService, string> = {
  rent_personal: "CUSTOMER_PULSE_ID_RENT_PERSONAL",
  rent_corporate: "CUSTOMER_PULSE_ID_RENT_CORPORATE",
  renew_personal: "CUSTOMER_PULSE_ID_RENEW_PERSONAL",
  renew_corporate: "CUSTOMER_PULSE_ID_RENEW_CORPORATE",
};

/** Which survey a journey belongs to. Anything else gets no survey. */
export function pulseServiceFor(journeyKey: string | null | undefined): PulseService | null {
  switch (journeyKey) {
    case "personal_po_box_rental": return "rent_personal";
    case "corporate_po_box_rental": return "rent_corporate";
    case "personal_po_box_renewal": return "renew_personal";
    case "corporate_po_box_renewal": return "renew_corporate";
    default: return null;
  }
}


/**
 * A UAE mobile in the form Customer Pulse insists on.
 *
 * It validates E.164 strictly and fails the whole call on anything else, and the
 * numbers we hold are local: "0553708000" prefixed with a "+" was rejected, so
 * the survey never appeared. Only shapes that are unambiguously UAE mobiles are
 * converted; anything else is dropped rather than guessed at, since the field is
 * optional and a wrong number is worse than no number.
 */
export function toE164(raw: string | null | undefined): string {
  const s = String(raw ?? "").replace(/[^\d+]/g, "");
  if (!s) return "";
  if (s.startsWith("+")) return /^\+\d{8,15}$/.test(s) ? s : "";
  const d = s.replace(/^00/, "");
  if (d !== s) return /^\d{8,15}$/.test(d) ? `+${d}` : "";      // 00971… -> +971…
  if (/^971\d{9}$/.test(d)) return `+${d}`;                     // 971501234567
  if (/^0(5\d{8})$/.test(d)) return `+971${d.slice(1)}`;        // 0501234567
  if (/^5\d{8}$/.test(d)) return `+971${d}`;                    // 501234567
  return "";
}

function config(service: PulseService) {
  const base = (process.env.CUSTOMER_PULSE_API_BASE_URL ?? "").replace(/\/$/, "");
  const apiKey = process.env.CUSTOMER_PULSE_API_KEY ?? "";
  const entity = process.env.CUSTOMER_PULSE_ID_ENTITY ?? "";
  const channel = process.env.CUSTOMER_PULSE_ID_CHANNEL ?? "";
  const survey = process.env.CUSTOMER_PULSE_ID_SURVEY ?? "";
  const mainService = process.env.CUSTOMER_PULSE_ID_MAIN_SERVICE ?? "";
  const subService = process.env[SUB_SERVICE_ENV[service]] ?? "";
  if (!base || !apiKey || !entity || !channel || !survey || !subService) return null;
  return { base, apiKey, entity, channel, survey, mainService, subService };
}

/**
 * Whether this deployment talks to the Customer Pulse sandbox. The widget script
 * has a matching host, and a token minted on one is not valid on the other — so
 * the client is TOLD which to load rather than inferring it.
 */
export function pulseIsSandbox(): boolean {
  return /sandbox/i.test(process.env.CUSTOMER_PULSE_API_BASE_URL ?? "");
}

/** True when this deployment is configured to show the survey at all. */
export function pulseConfigured(service: PulseService): boolean {
  return config(service) !== null;
}

async function post(base: string, apiKey: string, path: string, body: unknown): Promise<Record<string, unknown> | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "X-INTEGRATION-APIKEY": apiKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      log.warn("customer_pulse_rejected", { path, status: res.status, body: text.slice(0, 300) });
      return null;
    }
    return JSON.parse(text) as Record<string, unknown>;
  } catch (err) {
    log.warn("customer_pulse_unreachable", { path, error: err instanceof Error ? err.message : String(err) });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A survey token for one completed purchase, or null if anything is missing.
 *
 * `transactionId` is our own reference for the purchase (the Emirates Post order
 * number): Customer Pulse stores it so a response can be traced back, and passing
 * the same one twice would attach a second survey to one transaction.
 */
export async function pulseSurveyToken(input: {
  service: PulseService;
  transactionId: string;
  feesAed?: number | null;
  customer?: PulseCustomer;
}): Promise<string | null> {
  const cfg = config(input.service);
  if (!cfg) return null;
  const now = new Date().toISOString();

  const entryRes = await post(cfg.base, cfg.apiKey, "/api/v2/transaction/create/", {
    created_at: now,
    internal_transaction_id: input.transactionId,
    khadamati: {
      entity_linking_id: cfg.entity,
      service_channel_linking_id: cfg.channel,
      ...(cfg.mainService ? { main_service_linking_id: cfg.mainService } : {}),
    },
    initial_transaction_status: {
      time: now,
      status: "submitted",
      entity_internal_status: "submitted",
      ...(typeof input.feesAed === "number" ? { fees_aed: input.feesAed } : {}),
    },
  });
  const entry = entryRes?.cp_transaction_entry;
  if (typeof entry !== "string" || !entry) return null;

  const c = input.customer ?? {};
  // Customer Pulse validates these, and a malformed one fails the whole call —
  // so anything we are not sure of is left out rather than sent as a guess.
  const eid = String(c.emiratesId ?? "").replace(/\D/g, "");
  const e164 = toE164(c.mobile);
  const customer: Record<string, unknown> = {};
  if (eid.length === 15) customer.emirates_id = eid;
  if (c.name) customer.name = c.name;
  if (c.email) customer.email = c.email;
  if (e164) customer.mobile = e164;
  // user_id is required, and identifies the customer to Customer Pulse across
  // transactions. Their portal uses the mobile number; fall back to the email.
  customer.user_id = e164 || c.email || eid || input.transactionId;

  const tokenRes = await post(cfg.base, cfg.apiKey, "/api/v2/survey/token/", {
    linking_id: {
      entity_linking_id: cfg.entity,
      service_channel_linking_id: cfg.channel,
      survey_linking_id: cfg.survey,
      sub_service_linking_id: cfg.subService,
    },
    cp_transaction_entry: entry,
    meta_data: {
      customer,
      employee: { employee_id: String(customer.user_id) },
      transaction_id: input.transactionId,
    },
  });
  const token = tokenRes?.token;
  return typeof token === "string" && token ? token : null;
}
