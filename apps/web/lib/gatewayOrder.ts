/**
 * Ask the GATEWAY what happened, when the backend only says "not paid".
 *
 * Emirates Post's `UpdatePayment` answers `paymentStatus: 2, amountPaid: 0` for
 * a declined card and for a payment nobody has attempted yet. Those are very
 * different things to be told, and the chat could not tell them apart — so a
 * customer whose card was refused was invited to "try the payment page again",
 * and a customer who had not finished was told their payment had failed.
 *
 * 4 Sep proved how far that goes: six orders in a row came back FAILED at the
 * gateway — 3-D Secure passed, the authorisation never approved — and the
 * conversation reported each as "the payment has not come through yet", which
 * reads as our problem and sends people round the same loop.
 *
 * The rental's order lives on N-Genius outlet b78ef8c7…, which is the outlet our
 * own checkout is configured against, so the same API key reads it. No new
 * credential, and read-only: an access token and one GET.
 */

export interface GatewayOrderState {
  /** N-Genius's own word: PURCHASED, FAILED, STARTED, AWAIT_3DS… */
  state: string | null;
  /** True once the money is actually taken. */
  paid: boolean;
  /** A decline the customer can act on, in their terms. */
  reason: string | null;
  /** The card the attempt used, masked, when there was one. */
  card: string | null;
  /** No payment attempt at all — they have not finished on the page. */
  untouched: boolean;
}

const PAID = new Set(["PURCHASED", "CAPTURED", "AUTHORISED", "AUTHORIZED"]);

export async function gatewayOrderState(opts: {
  baseUrl: string;
  outletRef: string;
  apiKey: string;
  orderId: string;
  timeoutMs?: number;
}): Promise<GatewayOrderState | null> {
  const order = opts.orderId.replace(/^urn:order:/, "").trim();
  if (!order || !opts.apiKey || !opts.outletRef) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 6000);
  try {
    const base = opts.baseUrl.replace(/\/$/, "");
    const auth = await fetch(`${base}/identity/auth/access-token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${opts.apiKey}`,
        "Content-Type": "application/vnd.ni-identity.v1+json",
        Accept: "application/vnd.ni-identity.v1+json",
      },
      body: "{}",
      signal: ctl.signal,
    });
    if (!auth.ok) return null;
    const token = ((await auth.json()) as { access_token?: string }).access_token;
    if (!token) return null;
    const res = await fetch(`${base}/transactions/outlets/${opts.outletRef}/orders/${order}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.ni-payment.v2+json" },
      signal: ctl.signal,
    });
    if (!res.ok) return null;
    return readOrder((await res.json()) as Record<string, unknown>);
  } catch {
    // Diagnosing a payment must never take down the payment.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Exported so the shapes can be tested against real responses without a key. */
export function readOrder(order: Record<string, any>): GatewayOrderState {
  const payments = (order?._embedded?.payment ?? []) as Record<string, any>[];
  if (!payments.length) return { state: null, paid: false, reason: null, card: null, untouched: true };
  // The last attempt is the one they are asking about.
  const p = payments[payments.length - 1]!;
  const state = String(p.state ?? "").toUpperCase() || null;
  const card =
    p.paymentMethod?.pan || p.paymentMethod?.name
      ? [p.paymentMethod?.name, p.paymentMethod?.pan].filter(Boolean).join(" ")
      : null;
  const message = String(p.authResponse?.resultMessage ?? "").trim();
  const code = String(p.authResponse?.resultCode ?? "").trim();
  const paid = state !== null && PAID.has(state);
  const reason = paid
    ? null
    : message
      ? `${message}${code ? ` (${code})` : ""}`
      : state === "FAILED"
        ? "The bank did not approve the payment. No reason was given."
        : null;
  return { state, paid, reason, card, untouched: false };
}
