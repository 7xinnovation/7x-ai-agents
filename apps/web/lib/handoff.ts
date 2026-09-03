/**
 * Short-lived handoff codes, so a native app's session token never enters the
 * WebView at all.
 *
 * The mobile developer's objection and their fix, both correct. Passing the
 * customer's Emirates Post token to the widget means it lives in the WebView's
 * JS context, and anything that can read that context can replay it against
 * Emirates Post for as long as it is valid. Keeping it out of the URL removed
 * the logging and history problem; it did not remove that one.
 *
 * So the app exchanges it instead. It POSTs the real token to us from NATIVE
 * code -- no WebView involved -- we verify it, attach it to a conversation
 * server-side, and hand back a code that is:
 *
 *   - opaque: it carries a conversation id, not a credential;
 *   - short-lived: two minutes, which is a page load, not a session;
 *   - scoped: it names one agent and one conversation and can do nothing else;
 *   - useless to Emirates Post: replayed against their API it is not a token.
 *
 * The real token stays server-side, encrypted against the conversation, which is
 * where the chat route already reads it from. The WebView never sees it.
 *
 * Stateless by design -- the code IS its own record, encrypted with the same key
 * as everything else at rest. A store would let us make it single-use, and that
 * is the one property this does not have; two minutes bounds the damage instead.
 */
import { encryptSecret, decryptSecret, isEncrypted } from "./crypto";

/** A page load, not a session. */
export const HANDOFF_TTL_MS = 120_000;

export interface HandoffClaims {
  /** The conversation the token is already attached to. */
  cid: string;
  /** The agent it was minted for; a code from one agent is not valid on another. */
  agent: string;
  /** Epoch ms after which it is refused. */
  exp: number;
}

/**
 * Mint a code for a conversation that has ALREADY been authenticated.
 *
 * Deliberately takes no token: nothing secret goes in, so nothing secret comes
 * out. Callers must have verified the customer before reaching here.
 */
export function mintHandoff(cid: string, agent: string, now = Date.now()): string | null {
  const payload: HandoffClaims = { cid, agent, exp: now + HANDOFF_TTL_MS };
  return encryptSecret(JSON.stringify(payload));
}

export type HandoffResult =
  | { ok: true; claims: HandoffClaims }
  | { ok: false; reason: "malformed" | "expired" | "wrong_agent" };

/**
 * Read a code back.
 *
 * Every failure is the same to the caller -- refused -- but they are separated
 * here because "expired" is a customer who took too long to open the screen and
 * "malformed" is someone probing, and those deserve different log lines.
 */
export function readHandoff(code: string, agent: string, now = Date.now()): HandoffResult {
  // decryptSecret passes anything without the encrypted prefix straight back --
  // right for reading legacy plaintext rows out of the database, catastrophic
  // here, where the input is supplied by whoever is calling. Without this a
  // forged `{"cid":…,"agent":…,"exp":…}` would be accepted as a valid code.
  // Caught by the test that sends exactly that.
  if (!isEncrypted(code)) return { ok: false, reason: "malformed" };
  const plain = decryptSecret(code);
  if (!plain) return { ok: false, reason: "malformed" };
  let claims: HandoffClaims;
  try {
    claims = JSON.parse(plain) as HandoffClaims;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (typeof claims?.cid !== "string" || typeof claims?.agent !== "string" || typeof claims?.exp !== "number") {
    return { ok: false, reason: "malformed" };
  }
  // Agent before expiry: a code offered to the wrong agent is a different kind of
  // wrong from a slow customer, and should not be reported as staleness.
  if (claims.agent !== agent) return { ok: false, reason: "wrong_agent" };
  if (now >= claims.exp) return { ok: false, reason: "expired" };
  return { ok: true, claims };
}
