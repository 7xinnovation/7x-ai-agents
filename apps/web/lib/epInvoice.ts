import { epUsersBaseUrl } from "./hostToken";
import { log } from "./logger";
import type { EnvKey } from "./integrations";

/**
 * The invoice Emirates Post issue for a PO Box payment.
 *
 * `GET {usersBase}/api/v1/Invoice?PaymentReferenceNumber=<guid>&IsFile=true`
 * returns the PDF. Everything here was established by calling it on staging,
 * because their spec declares the 200 body as `{"type":"object"}` and says
 * nothing else:
 *
 *   IsFile=true    application/pdf, 115 KB for a rental
 *   IsFile=false   {"message":"...","payload":"<base64 of the same PDF>"}
 *   Type           documented as CommonOrderTypes and IGNORED — RENT, RENEWAL
 *                  and no Type at all return the same document, so none is sent
 *                  and there is no journey-to-order-type mapping to keep correct
 *   unknown ref    HTTP 500, not 404
 *
 * Their endpoint carries no authentication at all: a payment reference is the
 * whole of it. Ours is what protects it — the receipt route matches the
 * reference against the conversation before this is ever called — and it is
 * worth Emirates Post knowing that a leaked GUID is a leaked invoice.
 */

/** A chat turn does not wait on a document; the fallback is a page we render. */
const TIMEOUT_MS = 8000;

export async function emiratesPostInvoice(
  agentId: string,
  env: EnvKey,
  paymentReference: string
): Promise<ArrayBuffer | null> {
  // The users service, which is where the invoice lives — the same base the
  // token introspection uses, so there is nothing new to configure.
  const base = await epUsersBaseUrl(agentId, env).catch(() => undefined);
  if (!base) return null;

  const url = `${base.replace(/\/$/, "")}/api/v1/Invoice?PaymentReferenceNumber=${encodeURIComponent(
    paymentReference
  )}&IsFile=true`;

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { Accept: "application/pdf" }, signal: ctl.signal });
    /**
     * ANY non-200 is "no invoice", not an error to report. An unknown reference
     * answers 500, so there is no status that reliably means "not found" — and
     * a customer who has paid must be handed something either way. The caller
     * falls back to the receipt we render.
     */
    if (!res.ok) {
      log.warn("ep_invoice_unavailable", { status: res.status, paymentReference });
      return null;
    }
    const type = res.headers.get("content-type") ?? "";
    if (!/pdf/i.test(type)) {
      log.warn("ep_invoice_not_pdf", { type, paymentReference });
      return null;
    }
    const buf = await res.arrayBuffer();
    // A PDF starts "%PDF". An error page with the wrong content type would not,
    // and handing one to the browser as application/pdf shows a broken document
    // rather than falling back to a receipt that works.
    const head = new TextDecoder().decode(buf.slice(0, 4));
    if (head !== "%PDF") {
      log.warn("ep_invoice_not_a_pdf_body", { head, paymentReference });
      return null;
    }
    return buf;
  } catch (e) {
    log.warn("ep_invoice_failed", { reason: (e as Error).message, paymentReference });
    return null;
  } finally {
    clearTimeout(timer);
  }
}
