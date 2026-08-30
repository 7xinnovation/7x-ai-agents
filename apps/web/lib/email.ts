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

/** Where email would be sent from, for diagnostics. */
export function emailSender(): string {
  return process.env.EMAIL_FROM || process.env.NOTIFICATION_FROM_EMAIL || "Dialog <onboarding@resend.dev>";
}

export async function sendEmail(input: EmailInput): Promise<EmailResult> {
  const to = input.to.trim();
  if (!isValidEmail(to)) return { ok: false, reason: `invalid_recipient:${to}` };

  // EMAIL_FROM is the canonical name; NOTIFICATION_FROM_EMAIL is accepted as an
  // alias so either spelling works in the deployment environment. The fallback is
  // Resend's sandbox sender, which can ONLY deliver to the Resend account owner —
  // so a real verified sending domain must be configured for customer email.
  const from =
    process.env.EMAIL_FROM || process.env.NOTIFICATION_FROM_EMAIL || "Dialog <onboarding@resend.dev>";

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

/**
 * Render an agent-written plain-text email as HTML.
 *
 * The confirmation went out as text only, so a mail client showed a wall of
 * unformatted lines with the details — order reference, box number, expiry, price
 * — indistinguishable from the prose around them. The model writes plain text and
 * should keep writing plain text; this reads its shape instead of asking it for
 * markup, which it would get wrong at some point and which no one could review.
 *
 * A run of "Label: value" lines becomes a table; everything else stays a
 * paragraph. The text part is still sent unchanged, so a client that prefers it,
 * or strips HTML, loses nothing.
 */
export function textToHtml(text: string, heading?: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const row = /^\s*([A-Za-z][^:]{0,44}):\s*(.+?)\s*$/;

  const blocks = text.replace(/\r\n/g, "\n").split(/\n\s*\n/).map((b) => b.split("\n").filter((l) => l.trim()));
  const parts: string[] = [];
  for (const lines of blocks) {
    if (!lines.length) continue;
    const matched = lines.map((l) => l.match(row));
    // Two or more label/value lines read as a detail block, not as prose.
    if (matched.filter(Boolean).length >= 2 && matched.every(Boolean)) {
      const cells = matched
        .map(
          (m) =>
            `<tr><td style="padding:8px 16px 8px 0;color:#5b6472;white-space:nowrap;border-bottom:1px solid #edf0f4">${esc(
              m![1]!
            )}</td><td style="padding:8px 0;font-weight:600;color:#111827;text-align:right;border-bottom:1px solid #edf0f4">${esc(
              m![2]!
            )}</td></tr>`
        )
        .join("");
      parts.push(`<table style="width:100%;border-collapse:collapse;margin:18px 0;font-size:14px">${cells}</table>`);
      continue;
    }
    parts.push(
      `<p style="margin:14px 0;line-height:1.55;color:#111827;font-size:14px">${lines.map(esc).join("<br>")}</p>`
    );
  }

  return [
    `<div style="margin:0;padding:24px;background:#f6f7f9">`,
    `<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e8ee;border-radius:14px;padding:28px;`,
    `font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">`,
    heading
      ? `<h1 style="margin:0 0 4px;font-size:17px;font-weight:700;color:#111827">${esc(heading)}</h1>`
      : "",
    parts.join(""),
    `</div></div>`,
  ].join("");
}
