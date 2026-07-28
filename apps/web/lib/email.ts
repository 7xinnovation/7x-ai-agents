import { log } from "./logger";

/**
 * Transactional email sender (customer confirmations/receipts + internal ops
 * notifications). Providers, in order of precedence:
 *   - RESEND_API_KEY (+ EMAIL_FROM): sends via the Resend HTTPS API (no SDK).
 *   - EMAIL_WEBHOOK_URL: POSTs {to, subject, text, html} as JSON to a relay the
 *     ops team controls (e.g. a Power Automate / internal SMTP bridge).
 *   - Neither configured: returns {ok:false, reason:"email_not_configured"}.
 *
 * Callers MUST honour the result: never tell a customer an email was sent when
 * ok=false (feedback FB-1426 — the assistant claimed emails that never went out).
 */
export interface EmailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailResult {
  ok: boolean;
  id?: string;
  reason?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(addr: string): boolean {
  return EMAIL_RE.test(addr.trim());
}

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY || process.env.EMAIL_WEBHOOK_URL);
}

export async function sendEmail(input: EmailInput): Promise<EmailResult> {
  const to = input.to.trim();
  if (!isValidEmail(to)) return { ok: false, reason: `invalid_recipient:${to}` };

  const from = process.env.EMAIL_FROM || "Dialog <onboarding@resend.dev>";

  try {
    if (process.env.RESEND_API_KEY) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from,
          to: [to],
          subject: input.subject,
          text: input.text,
          ...(input.html ? { html: input.html } : {}),
        }),
      });
      if (!res.ok) {
        const body = (await res.text()).slice(0, 300);
        log.error("email_send_failed", new Error(`resend ${res.status}`), { to, body });
        return { ok: false, reason: `provider_error_${res.status}` };
      }
      const json = (await res.json().catch(() => ({}))) as { id?: string };
      return { ok: true, id: json.id };
    }

    if (process.env.EMAIL_WEBHOOK_URL) {
      const res = await fetch(process.env.EMAIL_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to, subject: input.subject, text: input.text, html: input.html }),
      });
      if (!res.ok) {
        log.error("email_send_failed", new Error(`webhook ${res.status}`), { to });
        return { ok: false, reason: `webhook_error_${res.status}` };
      }
      return { ok: true };
    }
  } catch (e) {
    log.error("email_send_failed", e, { to });
    return { ok: false, reason: "network_error" };
  }

  return { ok: false, reason: "email_not_configured" };
}
