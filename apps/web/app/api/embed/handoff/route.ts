import { NextRequest, NextResponse } from "next/server";
import { getAgentBySlug } from "@/lib/agents";
import { getOrCreateSession, markAuthenticated, rememberVerifiedEmiratesId, saveSessionToken } from "@/lib/conversation";
import { epUsersBaseUrl, hostTokenConfigured, introspectEmiratesPostToken, verifyHostToken } from "@/lib/hostToken";
import { mintHandoff, readHandoff, HANDOFF_TTL_MS } from "@/lib/handoff";
import { log } from "@/lib/logger";

export const runtime = "nodejs";

/**
 * Exchange a native app's session token for a short-lived handoff code.
 *
 * POST { agent, token }            <- from NATIVE code, never from the WebView
 *   -> { handoff, conversationId, expiresIn }
 *
 * POST { agent, handoff }          <- from the widget, once it has loaded
 *   -> { ok, conversationId }
 *
 * The point of the pair is that the customer's Emirates Post token goes app ->
 * us and stops there. We verify it, attach it to a conversation encrypted at
 * rest, and the widget is given a code that names that conversation and nothing
 * else. The chat route reads the real token off the conversation, as it already
 * does for a customer who signed in through a hosting page.
 *
 * Verification is the same two shapes as /api/uaepass/host, decided by what the
 * token IS: a signed JWS against our key, or an opaque Emirates Post token
 * validated by using it. We never take the caller's word for who they are.
 */
export async function POST(req: NextRequest) {
  let body: { agent?: string; token?: string; handoff?: string; locale?: string; cid?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  const slug = body.agent;
  if (!slug) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  const agent = await getAgentBySlug(slug);
  if (!agent) return NextResponse.json({ ok: false, error: "unknown_agent" }, { status: 404 });

  // --- Redeem -------------------------------------------------------------
  if (body.handoff) {
    const r = readHandoff(body.handoff, slug);
    if (!r.ok) {
      log.warn("handoff_refused", { agentId: agent.id, reason: r.reason });
      // One answer for every failure. Which of them it was is ours to know, not
      // something to tell whoever is holding the code.
      return NextResponse.json({ ok: false, error: "invalid_handoff" }, { status: 401 });
    }
    return NextResponse.json({ ok: true, conversationId: r.claims.cid });
  }

  // --- Mint ---------------------------------------------------------------
  const token = body.token;
  if (!token) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  const looksSigned = token.split(".").length === 3;
  let sub: string | undefined;
  /**
   * The Emirates ID this introspection already knows.
   *
   * Kept, not merely used. A rental save carries userProfile.idNumber and
   * Emirates Post answers 115 USER_PROFILE_INVALID without it — and an app
   * sign-in is the one route where nothing else will ever ask: the token is
   * held encrypted against the conversation precisely so it never reaches the
   * WebView, so no later turn has one in hand to introspect. 18 September: a
   * rental from the app reached the payment step and died there, with the box
   * already reserved, because this value was discarded here.
   */
  let emiratesId: string | undefined;
  let reason = "";
  if (looksSigned && hostTokenConfigured()) {
    const v = verifyHostToken(token);
    if (v.ok) sub = v.claims.sub;
    else reason = v.reason;
  } else {
    const usersBase = await epUsersBaseUrl(agent.id, agent.definition.activeEnvironment ?? "production");
    if (!usersBase) reason = "no host users service configured for this environment";
    else {
      const v = await introspectEmiratesPostToken(token, usersBase);
      if (v.ok) {
        sub = v.identity.sub;
        emiratesId = v.identity.emiratesId;
      } else reason = v.reason;
    }
  }
  if (!sub) {
    log.warn("handoff_token_rejected", { agentId: agent.id, reason, signed: looksSigned });
    return NextResponse.json({ ok: false, error: "invalid_token" }, { status: 401 });
  }

  const locale = body.locale === "ar" ? "ar" : "en";
  const session = await getOrCreateSession({
    agentId: agent.id,
    conversationId: body.cid,
    locale,
    authenticated: false,
  });
  // Stored encrypted against the conversation, which is where the chat route
  // reads it from. This is the whole trick: the token lives here, not in the app's
  // WebView, and the code handed back cannot be replayed against Emirates Post.
  await saveSessionToken(session.conversationId, token, "backend");
  await markAuthenticated(session.conversationId, sub);
  if (emiratesId && session.caseId) await rememberVerifiedEmiratesId(session.caseId, emiratesId);

  const handoff = mintHandoff(session.conversationId, slug);
  if (!handoff) {
    // encryptSecret returns null with no SECRETS_KEY. Failing here is right:
    // falling back to handing the raw token to the WebView is the thing this
    // endpoint exists to stop.
    log.error("handoff_mint_failed", new Error("SECRETS_KEY missing"), { agentId: agent.id });
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 501 });
  }
  return NextResponse.json({
    ok: true,
    handoff,
    conversationId: session.conversationId,
    expiresIn: Math.floor(HANDOFF_TTL_MS / 1000),
  });
}
