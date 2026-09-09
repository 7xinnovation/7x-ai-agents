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

export type PulseService =
  | "rent_personal"
  | "rent_corporate"
  | "renew_personal"
  | "renew_corporate"
  | "license_new"
  | "license_renewal";

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
  // EPGL. Its own linking ids, because it is a different service under the same
  // entity -- and its own env vars, so the survey stays off until Customer Pulse
  // has issued them rather than being pointed at a PO Box survey.
  license_new: "CUSTOMER_PULSE_ID_LICENSE_NEW",
  license_renewal: "CUSTOMER_PULSE_ID_LICENSE_RENEWAL",
};

/** Which survey a journey belongs to. Anything else gets no survey. */
export function pulseServiceFor(journeyKey: string | null | undefined): PulseService | null {
  switch (journeyKey) {
    case "personal_po_box_rental": return "rent_personal";
    case "corporate_po_box_rental": return "rent_corporate";
    case "personal_po_box_renewal": return "renew_personal";
    case "corporate_po_box_renewal": return "renew_corporate";
    // EPGL licensing.
    case "new_license": return "license_new";
    case "renewal": return "license_renewal";
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

/**
 * Which set of credentials a survey belongs to.
 *
 * Not cosmetic. Customer Pulse issues linking ids per SERVICE, and EPGL's are
 * not Emirates Post's: the two agree on the entity (Q, EPG) and the survey (C)
 * and differ on everything else -- channel kK against kn, main service Dt
 * against D2 -- and they are registered under different integration keys, since
 * they are different Salesforce orgs. Before this, one CUSTOMER_PULSE_ID_CHANNEL
 * served both, so switching EPGL on would have quietly filed every licence
 * survey against the PO Box channel.
 *
 * So EPGL reads CUSTOMER_PULSE_EPGL_* first and falls back to the shared name.
 * A deployment where the two really do match needs no new settings at all.
 */
const EPGL_SERVICES: ReadonlySet<PulseService> = new Set(["license_new", "license_renewal"]);

function envFor(service: PulseService, suffix: string): string {
  if (EPGL_SERVICES.has(service)) {
    const own = process.env[`CUSTOMER_PULSE_EPGL_${suffix}`];
    if (own) return own;
  }
  return process.env[`CUSTOMER_PULSE_${suffix}`] ?? "";
}

function config(service: PulseService) {
  const base = envFor(service, "API_BASE_URL").replace(/\/$/, "");
  const apiKey = envFor(service, "API_KEY");
  const entity = envFor(service, "ID_ENTITY");
  const channel = envFor(service, "ID_CHANNEL");
  const survey = envFor(service, "ID_SURVEY");
  const mainService = envFor(service, "ID_MAIN_SERVICE");
  const subService = process.env[SUB_SERVICE_ENV[service]] ?? "";
  if (!base || !apiKey || !entity || !channel || !survey || !subService) return null;
  return { base, apiKey, entity, channel, survey, mainService, subService };
}

/**
 * Whether this deployment talks to the Customer Pulse sandbox. The widget script
 * has a matching host, and a token minted on one is not valid on the other — so
 * the client is TOLD which to load rather than inferring it.
 */
export function pulseIsSandbox(service?: PulseService): boolean {
  const base = service ? envFor(service, "API_BASE_URL") : process.env.CUSTOMER_PULSE_API_BASE_URL ?? "";
  return /sandbox/i.test(base);
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
      // Required by their schema and missing here until 9 Sep 2026. The sandbox
      // issues a token without it, which is why it went unnoticed -- but the
      // sub-service is the only thing separating a new licence from a renewal,
      // or a personal box from a corporate one, in their reporting. Without it
      // every transaction lands in one undifferentiated pile.
      sub_service_linking_id: cfg.subService,
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
