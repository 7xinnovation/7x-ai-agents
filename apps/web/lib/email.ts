import { log } from "./logger";

/**
 * Transactional email sender (customer confirmations/receipts + internal ops
 * notifications). Providers, in order of precedence:
 *   - RESEND_API_KEY (+ EMAIL_FROM): sends via the Resend HTTPS API (no SDK).
 *   - EMAIL_WEBHOOK_URL: POSTs {to, subject, text, html} as JSON to a relay the
 *     ops team controls (e.g. a Power Automate / internal SMTP bridge).
 *   - Neither configured: returns {ok:false, reason:"email_not_configured"}.
 *
 * EVERY ONE OF THOSE TAKES A `_<TENANT>` SUFFIX, and the suffixed set is taken
 * whole. An entity that sends from its OWN address sends through its OWN
 * service: EPGL's licensing mail leaves EPGL's account, under a domain they
 * verified, with a key they issued and can revoke — not ours with their name on
 * it. Mixing those is how a government entity's mail ends up depending on a
 * third party's account nobody there has ever seen.
 *
 * Whole, not field by field: a tenant with its own credential must not silently
 * fall back to the shared sender or the shared relay, because half-configured
 * would mean their address going out through our account, which is the one
 * outcome this exists to prevent.
 *
 * Callers MUST honour the result: never tell a customer an email was sent when
 * ok=false (feedback FB-1426 — the assistant claimed emails that never went out).
 */
export interface EmailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /**
   * WHOSE EMAIL THIS IS, so it can be sent from their address.
   *
   * EMAIL_FROM is one setting and both agents send through it, so switching
   * EPGL to licensing.department@epg.ae would have put Emirates Post's mail on
   * it too. That is the same shape of mistake as the host-token key checking
   * the wrong host's token, and it is cheaper to prevent than to explain.
   *
   * Resolves EMAIL_FROM_<TENANT> and falls back to the shared EMAIL_FROM, so a
   * deployment that has not split its senders behaves exactly as before.
   */
  tenant?: string;
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

export function emailConfigured(tenant?: string): boolean {
  const { resendKey, webhookUrl } = providerFor(tenant);
  return Boolean(resendKey || webhookUrl);
}

/**
 * Where email is sent from, for one tenant.
 *
 * `EMAIL_FROM_<TENANT>` wins; the unsuffixed name is the shared default. Both
 * spellings of the default are accepted because the deployment has used either.
 * The last resort is Resend's sandbox sender, which can ONLY deliver to the
 * Resend account owner — so a real verified sending domain has to be configured
 * before any of this reaches a customer.
 */
export function senderFor(tenant?: string): string {
  const scoped = tenant ? process.env[`EMAIL_FROM_${tenant.toUpperCase()}`] : undefined;
  return (
    scoped?.trim() ||
    process.env.EMAIL_FROM ||
    process.env.NOTIFICATION_FROM_EMAIL ||
    "Dialog <onboarding@resend.dev>"
  );
}

/** Where email would be sent from, for diagnostics. */
export function emailSender(tenant?: string): string {
  return senderFor(tenant);
}

/** The provider credentials for one tenant, taken as a set. See the note above. */
export function providerFor(tenant?: string): { resendKey?: string; webhookUrl?: string; from: string; own: boolean } {
  const suffix = tenant ? `_${tenant.toUpperCase()}` : "";
  if (suffix) {
    const key = process.env[`RESEND_API_KEY${suffix}`]?.trim();
    const hook = process.env[`EMAIL_WEBHOOK_URL${suffix}`]?.trim();
    if (key || hook) {
      return { resendKey: key, webhookUrl: hook, from: senderFor(tenant), own: true };
    }
  }
  return {
    resendKey: process.env.RESEND_API_KEY,
    webhookUrl: process.env.EMAIL_WEBHOOK_URL,
    from: senderFor(tenant),
    own: false,
  };
}

export async function sendEmail(input: EmailInput): Promise<EmailResult> {
  const to = input.to.trim();
  if (!isValidEmail(to)) return { ok: false, reason: `invalid_recipient:${to}` };

  // EMAIL_FROM is the canonical name; NOTIFICATION_FROM_EMAIL is accepted as an
  // alias so either spelling works in the deployment environment. The fallback is
  // Resend's sandbox sender, which can ONLY deliver to the Resend account owner —
  // so a real verified sending domain must be configured for customer email.
  const { resendKey, webhookUrl, from, own } = providerFor(input.tenant);
  /**
   * A tenant sending from its own address through the SHARED account would be
   * signing our mail with their name. Refused rather than sent: their recipients
   * would see a domain we cannot prove we own, and the mail would be rejected or
   * land in spam anyway — with nobody knowing why.
   */
  if (!own && input.tenant && process.env[`EMAIL_FROM_${input.tenant.toUpperCase()}`]) {
    log.error("email_send_failed", new Error("tenant sender without tenant provider"), { to, tenant: input.tenant });
    return { ok: false, reason: "tenant_sender_without_provider" };
  }

  try {
    if (resendKey) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${resendKey}`,
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

    if (webhookUrl) {
      const res = await fetch(webhookUrl, {
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
/**
 * The sender's own brand, for the top of a customer-facing email.
 *
 * The receipt has carried the logo since FB-1445 — "the receipt said NXN, an
 * internal product name, to a customer who had just bought from Emirates Post" —
 * and the confirmation email went out with nothing but the text. Same customer,
 * same transaction, one of the two anonymous.
 */
export interface EmailBrand {
  /** What the sender is called. The theme's brandName, never the agent's slug. */
  name: string;
  /** The agent's logo path or URL. An .svg is swapped for its email PNG. */
  logoUrl?: string | null;
  primary?: string | null;
  /** Where this deployment answers, so an app-relative logo can be fetched. */
  baseUrl?: string | null;
}

/**
 * The logo an EMAIL can actually show.
 *
 * Both agents' marks are SVG, and SVG does not render in Gmail, in Outlook, or
 * in most of what people read mail in — the customer would get the alt text and
 * an empty box. So every `*.svg` has a rasterised `*-email.png` beside it in
 * /public, and that is what goes in the mail. Anything already raster, or on
 * another host, is used as it stands.
 */
export function emailLogoUrl(logoUrl: string | null | undefined, baseUrl?: string | null): string {
  const raw = String(logoUrl ?? "").trim();
  if (!raw) return "";
  const png = raw.replace(/\.svg(\?.*)?$/i, "-email.png$1");
  if (/^https?:\/\//i.test(png)) return png;
  const base = String(baseUrl ?? "").replace(/\/$/, "");
  return base ? `${base}${png.startsWith("/") ? "" : "/"}${png}` : "";
}

export function textToHtml(text: string, heading?: string, brand?: EmailBrand): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  /**
   * A link the reader can click, out of a line of plain text.
   *
   * The receipt reached the customer as a bare URL in a table cell — 90
   * characters of it, right-aligned, wrapped mid-token. Escaping happens first
   * and the pattern then matches only what escaping leaves behind, so nothing
   * here can reintroduce markup: `&` is already `&amp;`, so a query string
   * survives, and `<` can no longer appear at all.
   */
  /**
   * AND A LINK THAT WAS GIVEN A NAME KEEPS IT.
   *
   * "In the chat, Download receipt shows as a clean, shortened link label. In
   * the confirmation email, the same link instead shows the full raw 7xagents
   * URL" — EPGL, 22 September. Both were true: the email is built from plain
   * text and the only rule here was "make a URL clickable", which can do nothing
   * but show the URL.
   *
   * A markdown link is matched FIRST and rendered with its label, so
   * `[Download receipt](https://…)` reads as it does in the chat. Everything
   * else still falls to the bare-URL rule below — a link nobody named has
   * nothing to show but itself.
   */
  const MD_LINK = /\[([^\]\n]{1,80})\]\((https?:\/\/[^)\s]+)\)/g;
  const anchor = (href: string, label: string) =>
    `<a href="${href}" style="color:#1330F0;word-break:break-all">${label}</a>`;
  const link = (escaped: string) => {
    // Escaping has already run, so `<` cannot appear and `&` is `&amp;` — the
    // patterns below match only what escaping leaves behind and can therefore
    // not reintroduce markup. The href is the same escaped text as the label.
    const named: string[] = [];
    const held = escaped.replace(MD_LINK, (_m, label: string, href: string) => {
      named.push(anchor(href, label));
      // A placeholder the bare-URL rule cannot match, and escaping cannot have
      // produced: the URL is out of the string while that rule runs.
      return `\u0000LINK${named.length - 1}\u0000`;
    });
    return held
      .replace(/https?:\/\/[^\s<>"]+/g, (u) => anchor(u, u))
      .replace(/\u0000LINK(\d+)\u0000/g, (_m, i: string) => named[Number(i)] ?? "");
  };
  /**
   * A "Label: value" line, in ANY script.
   *
   * It used to require a Latin first letter, so an Arabic confirmation never
   * formed a detail table — every row fell through to the paragraph branch and
   * the customer got a wall of lines where an English customer got a table.
   */
  const row = /^\s*(\p{L}[^:]{0,44}):\s*(.+?)\s*$/u;
  /**
   * RIGHT-TO-LEFT, AND THE NUMBERS INSIDE IT.
   *
   * "16-09-2026" in an Arabic paragraph renders as "2026-09-16": the digits are
   * three separate left-to-right runs and the hyphens between them are neutral,
   * so the bidi algorithm lays the runs out right to left and the date reads
   * backwards. Reported on LR-37385, where the email said 2026-09-16 and the
   * text it was built from said 16-09-2026.
   *
   * So a value with no Arabic in it — a date, an amount, a reference, an
   * address, a URL — is isolated as left-to-right wherever it sits.
   */
  const rtl = /[\u0600-\u06ff]/.test(text.replace(/[^\p{L}]/gu, "").slice(0, 400));
  const hasArabic = (v: string) => /[\u0600-\u06ff]/.test(v);
  const isolate = (escaped: string, raw: string) =>
    rtl && !hasArabic(raw) ? `<span dir="ltr" style="unicode-bidi:isolate">${escaped}</span>` : escaped;

  const blocks = text.replace(/\r\n/g, "\n").split(/\n\s*\n/).map((b) => b.split("\n").filter((l) => l.trim()));
  const parts: string[] = [];
  for (const lines of blocks) {
    if (!lines.length) continue;
    const matched = lines.map((l) => l.match(row));
    // Two or more label/value lines read as a detail block, not as prose.
    if (matched.filter(Boolean).length >= 2 && matched.every(Boolean)) {
      const labelPad = rtl ? "padding:8px 0 8px 16px" : "padding:8px 16px 8px 0";
      const valuePad = rtl ? "padding:8px 0;text-align:left" : "padding:8px 0;text-align:right";
      const cells = matched
        .map(
          (m) =>
            `<tr><td style="${labelPad};color:#5b6472;white-space:nowrap;border-bottom:1px solid #edf0f4">${esc(
              m![1]!
            )}</td><td style="${valuePad};font-weight:600;color:#111827;word-break:break-word;border-bottom:1px solid #edf0f4">${isolate(
              link(esc(m![2]!)),
              m![2]!
            )}</td></tr>`
        )
        .join("");
      parts.push(`<table style="width:100%;border-collapse:collapse;margin:18px 0;font-size:14px">${cells}</table>`);
      continue;
    }
    parts.push(
      `<p style="margin:14px 0;line-height:1.55;color:#111827;font-size:14px">${lines
        .map((l) => isolate(link(esc(l)), l))
        .join("<br>")}</p>`
    );
  }

  // THE HEADER, BUILT THE WAY THE RECEIPT PRINTS RATHER THAN THE WAY IT RENDERS.
  //
  // On screen the receipt knocks the logo out to white and sits it on a
  // brand-coloured band. Mail clients strip CSS filters, so that would put a
  // navy mark on a navy band. The receipt's PRINT rules already solve exactly
  // this — white ground, the mark in its own colours, a brand rule underneath to
  // keep the header a header — so the email uses those.
  //
  // Width and height are attributes as well as CSS: Outlook sizes an image from
  // the attributes and ignores the rest.
  const primary = brand?.primary && /^#[0-9a-f]{3,8}$/i.test(brand.primary) ? brand.primary : "#0052a3";
  const logo = brand ? emailLogoUrl(brand.logoUrl, brand.baseUrl) : "";
  const header = brand
    ? `<div style="padding:0 0 14px;border-bottom:2px solid ${esc(primary)};margin:0 0 18px">${
        logo
          ? `<img src="${esc(logo)}" width="106" height="56" alt="${esc(brand.name)}" style="display:block;border:0;outline:none;height:56px;width:106px">`
          : `<div style="font-size:16px;font-weight:700;color:${esc(primary)}">${esc(brand.name)}</div>`
      }</div>`
    : "";
  return [
    `<div style="margin:0;padding:24px;background:#f6f7f9"${rtl ? ' dir="rtl"' : ""}>`,
    `<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e8ee;border-radius:14px;padding:28px;`,
    `font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">`,
    header,
    heading
      ? `<h1 style="margin:0 0 4px;font-size:17px;font-weight:700;color:#111827">${esc(heading)}</h1>`
      : "",
    parts.join(""),
    `</div></div>`,
  ].join("");
}
