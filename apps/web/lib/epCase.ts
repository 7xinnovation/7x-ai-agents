/**
 * Raise a case on emiratespost.ae — the callback the customer asked for.
 *
 * Their website's contact form posts to /nextApi/case, and that is where a
 * callback belongs: in the queue their team already works, with a case number the
 * customer can quote. Ours were going to an ops mailbox instead.
 *
 * The contract is read from their own contact form (production bundle, 2 Sep):
 * a flat body with origin "Web-EP", and the mobile as "00" + digits with no plus
 * and no spaces. Attachments are { body: base64, name, contentType: ".pdf" }.
 *
 * IT IS CAPTCHA-GATED. Every request without a valid `x-turnstile-token` answers
 * 403 {"message":"Invalid CAPTCHA token"} — body and header names make no
 * difference, tested on 2 Sep. Cloudflare Turnstile issues that token to a
 * BROWSER: bound to the hostname that rendered the widget, single-use, and good
 * for about five minutes.
 *
 * Emirates Post supplied the site key on 21 October, so the token now comes from
 * the customer's own browser — the widget runs inside our chat and the token
 * travels with the chat request (lib/turnstile). The env var below is kept only
 * as a manual override for probing their endpoint by hand; it cannot serve real
 * traffic, because the second request would replay a burnt token.
 *
 * SUPERSEDED, 22 October. Emirates Post gave us a DIRECT CRM ENDPOINT — the
 * same case create, authenticated with an API key instead of a CAPTCHA, which a
 * server can call. When NXN_CRM_BASE_URL and NXN_CRM_API_KEY are set that is the
 * route taken and no browser token is involved at all. Everything above is kept
 * as the fallback for an environment that has not been given the key yet.
 *
 * When neither route is configured the caller still falls back to the ops
 * mailbox rather than losing the callback.
 */
import { log } from "./logger";
import { trackedFetch } from "./apiCallLog";
import { takeTurnstileToken } from "./turnstile";

export interface EpCaseInput {
  firstName: string;
  lastName: string;
  /** Any format; normalised to their "00971…" below. */
  mobile: string;
  email?: string;
  message: string;
  emirateCode?: string;
  poBoxNumber?: string;
  trackingNumber?: string;
}

export type EpCaseResult =
  | { ok: true; caseNumber: string }
  | { ok: false; reason: "not_configured" | "captcha" | "rejected" | "unreachable"; detail: string };

/**
 * "+971 55 370 8434" -> "00971553708434".
 *
 * Their form strips spaces and the plus and prefixes "00", validating the result
 * against /^971\d{9,}$/ before it will submit. A number we cannot put in that
 * shape is one their system would reject, so it is left out rather than guessed.
 */
export function epMobile(raw: string | undefined): string {
  const d = String(raw ?? "").replace(/[\s()+\-.]/g, "");
  const national = d.startsWith("00971") ? d.slice(2) : d.startsWith("971") ? d : d.startsWith("0") ? `971${d.slice(1)}` : d;
  return /^971\d{9,}$/.test(national) ? `00${national}` : "";
}

/**
 * The direct CRM endpoint, when we have been given one.
 *
 * Supplied 22 October (Michael, via Hussein) as a Postman collection: the same
 * body as the contact form, on their CRM rather than behind the website, keyed
 * rather than CAPTCHA-gated. It is route 3 of the four in
 * docs/NXN-CALLBACK-BLOCKED-2026-09-03.md — the one we asked for in September.
 *
 * THE KEY TRAVELS AS A QUERY PARAMETER. That is their design. It is masked by
 * name in the API log (`maskUrl` in lib/apiCallLog), so it does not reach our
 * database or the admin console; do not move it into the path, where it would.
 */
export function crmEndpoint(): { url: string } | null {
  const base = (process.env.NXN_CRM_BASE_URL ?? "").replace(/\/$/, "");
  const key = (process.env.NXN_CRM_API_KEY ?? "").trim();
  if (!base || !key) return null;
  return { url: `${base}/Case?X-API-KEY=${encodeURIComponent(key)}` };
}

export async function raiseEpCase(
  input: EpCaseInput,
  /** Who it belongs to, for the admin's API Logs page. */
  ctx: { agentId?: string; conversationId?: string } = {}
): Promise<EpCaseResult> {
  // The keyed CRM route first. It needs no browser token, so the customer's
  // Turnstile token is left unspent rather than burnt on a call that ignores it.
  const crm = crmEndpoint();
  const base = (process.env.NXN_CASE_API_BASE_URL ?? "").replace(/\/$/, "");
  const token = crm ? "" : (takeTurnstileToken() ?? process.env.NXN_CASE_TURNSTILE_TOKEN ?? "");
  if (!crm) {
    if (!base) {
      return {
        ok: false,
        reason: "not_configured",
        detail: "neither NXN_CRM_BASE_URL + NXN_CRM_API_KEY nor NXN_CASE_API_BASE_URL is set",
      };
    }
    if (!token) {
      return {
        ok: false,
        reason: "not_configured",
        detail:
          "no x-turnstile-token — /nextApi/case rejects every request without one, and this turn carried none " +
          "(is NXN_CASE_TURNSTILE_SITE_KEY set, and did the widget load in the customer's browser?)",
      };
    }
  }
  const mobile = epMobile(input.mobile);
  if (!mobile) return { ok: false, reason: "rejected", detail: `mobile ${input.mobile} is not a UAE number their form accepts` };

  const body = {
    origin: "Web-EP",
    caseType: "Inquiry",
    firstName: input.firstName,
    lastName: input.lastName,
    mobilePhone: mobile,
    email: input.email ?? "",
    message: input.message,
    emirateCode: input.emirateCode ?? "",
    poBoxNumber: input.poBoxNumber ?? "",
    trackingNumber: input.trackingNumber ?? "",
    attachments: [] as unknown[],
  };

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (!crm) headers["x-turnstile-token"] = token;
    const res = await trackedFetch(
      crm ? crm.url : `${base}/nextApi/case`,
      { method: "POST", headers, body: JSON.stringify(body), signal: ctl.signal },
      { ...ctx, integration: "Emirates Post enquiries", tool: "ep_raise_case" }
    );
    const text = await res.text();
    if (!crm && (res.status === 403 || /captcha/i.test(text))) {
      return { ok: false, reason: "captcha", detail: text.slice(0, 200) };
    }
    // On the keyed route a 401/403 means the API KEY, not a challenge. Say so,
    // rather than sending whoever reads the log back to the Turnstile thread.
    if (crm && (res.status === 401 || res.status === 403)) {
      return { ok: false, reason: "rejected", detail: `HTTP ${res.status} — NXN_CRM_API_KEY rejected: ${text.slice(0, 160)}` };
    }
    if (!res.ok) return { ok: false, reason: "rejected", detail: `HTTP ${res.status} ${text.slice(0, 200)}` };
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(text) as Record<string, unknown>; } catch { /* a 200 with no body is still a 200 */ }
    const caseNumber =
      (typeof parsed.caseNumbering === "string" && parsed.caseNumbering) ||
      (typeof parsed.caseNumber === "string" && parsed.caseNumber) ||
      "";
    if (!caseNumber) {
      log.warn("ep_case_no_number", { body: text.slice(0, 200) });
      return { ok: false, reason: "rejected", detail: "accepted but returned no case number" };
    }
    return { ok: true, caseNumber };
  } catch (e) {
    return { ok: false, reason: "unreachable", detail: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}
