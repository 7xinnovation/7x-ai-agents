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
 * BROWSER, so a server cannot mint one. Until Emirates Post gives us a
 * server-to-server route, this returns notConfigured/rejected and the caller
 * falls back to the ops mailbox rather than losing the callback.
 */
import { log } from "./logger";

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

export async function raiseEpCase(input: EpCaseInput): Promise<EpCaseResult> {
  const base = (process.env.NXN_CASE_API_BASE_URL ?? "").replace(/\/$/, "");
  const token = process.env.NXN_CASE_TURNSTILE_TOKEN ?? "";
  if (!base) return { ok: false, reason: "not_configured", detail: "NXN_CASE_API_BASE_URL is not set" };
  if (!token) {
    return {
      ok: false,
      reason: "not_configured",
      detail: "no x-turnstile-token — /nextApi/case rejects every request without one and a server cannot mint it",
    };
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
    const res = await fetch(`${base}/nextApi/case`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-turnstile-token": token },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    const text = await res.text();
    if (res.status === 403 || /captcha/i.test(text)) {
      return { ok: false, reason: "captcha", detail: text.slice(0, 200) };
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
