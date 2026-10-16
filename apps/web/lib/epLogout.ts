/**
 * End the customer's Emirates Post session at Emirates Post (2026-10-16).
 *
 * Reported: after signing out of the chat, "Sign in" opened the portal and it
 * greeted the same customer by name, and the window never came back. The
 * portal keeps its session in localStorage (accessToken, profile); clearing it
 * from our side relied on our relay script running on their pages, and on
 * 16 October it was found not to run there at all — their bundle carries the
 * code that adds it, but the script never reaches the page — so the portal's
 * session survived every sign-out.
 *
 * Their own logout button calls POST /users/api/Account/Logout with the token
 * and then clears the two keys. We hold that token for a signed-in conversation,
 * so we make the same call: the session ends at Emirates Post, whatever their
 * page still has in storage. Best-effort and bounded — a sign-out must never
 * wait on, or fail because of, another system.
 */
import { epUsersBaseUrl } from "./hostToken";
import { log } from "./logger";
import type { EnvKey } from "./integrations";

export async function endEmiratesPostSession(agentId: string, env: EnvKey, token: string | undefined): Promise<"ended" | "rejected" | "skipped" | "failed"> {
  if (!token) return "skipped";
  const base = await epUsersBaseUrl(agentId, env).catch(() => undefined);
  if (!base) return "skipped";
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 5000);
  try {
    const res = await fetch(`${base}/api/Account/Logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" },
      body: "{}",
      signal: ctl.signal,
    });
    return res.ok ? "ended" : "rejected";
  } catch (e) {
    log.warn("ep_logout_failed", { reason: e instanceof Error ? e.message : String(e) });
    return "failed";
  } finally {
    clearTimeout(timer);
  }
}
