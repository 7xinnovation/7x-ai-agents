/**
 * The browser's CAPTCHA token, carried into the turn that needs it.
 *
 * Emirates Post's /nextApi/case answers 403 {"message":"Invalid CAPTCHA token"}
 * to every request without an `x-turnstile-token`. Cloudflare Turnstile issues
 * that token to a BROWSER — it is bound to a hostname, single-use, and expires
 * in about five minutes — so no server-side value can stand in for it. The old
 * NXN_CASE_TURNSTILE_TOKEN env var could only ever have worked for one request.
 *
 * Emirates Post supplied the site key on 21 October, which makes the real shape
 * possible: the widget runs in the customer's own browser inside our chat, mints
 * a token, and the token travels with the chat request. This module holds it for
 * the length of that request so `raiseEpCase` can pick it up without threading a
 * new argument through the adapter contract, the CRM interface and every tool.
 *
 * Request-scoped on purpose. A module-level variable would hand one customer's
 * token to whichever request happened to be in flight next.
 */
import { AsyncLocalStorage } from "node:async_hooks";

interface Scope {
  /** Cleared once read: Cloudflare burns the token on first verify. */
  token?: string;
}

const scope = new AsyncLocalStorage<Scope>();

/**
 * Run `fn` with this request's token in scope.
 *
 * Called around the construction of the SSE stream, not merely before it: a
 * ReadableStream's `start` runs synchronously inside the constructor, so the
 * whole turn — tools included — inherits the context from here.
 */
export function withTurnstileToken<T>(token: string | undefined, fn: () => T): T {
  return scope.run({ token: token || undefined }, fn);
}

/**
 * The token for this request, consumed.
 *
 * A Turnstile token verifies exactly once. Handing the same string to a retry
 * would turn a recoverable failure into a second "Invalid CAPTCHA token", so the
 * second read gets nothing and the caller falls back honestly.
 */
export function takeTurnstileToken(): string | undefined {
  const s = scope.getStore();
  if (!s?.token) return undefined;
  const token = s.token;
  s.token = undefined;
  return token;
}

/** Whether a turn is currently carrying one (for diagnostics; does not consume). */
export function hasTurnstileToken(): boolean {
  return Boolean(scope.getStore()?.token);
}

/**
 * The site key the widget renders with, or "" when the browser should not load
 * Cloudflare's script at all.
 *
 * Public by design — a Turnstile site key is meant to be read from page source;
 * the secret half lives with Emirates Post, who verify the token.
 */
export function turnstileSiteKey(): string {
  return (process.env.NXN_CASE_TURNSTILE_SITE_KEY ?? "").trim();
}
