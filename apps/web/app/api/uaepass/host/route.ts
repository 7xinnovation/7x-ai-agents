import { NextRequest, NextResponse } from "next/server";
import { getAgentBySlug } from "@/lib/agents";
import { markAuthenticated } from "@/lib/conversation";
import { epUsersBaseUrl, hostTokenConfigured, introspectEmiratesPostToken, verifyHostToken } from "@/lib/hostToken";
import { log } from "@/lib/logger";

export const runtime = "nodejs";

/**
 * Validate a token handed to us by the HOST page, and reflect the sign-in.
 *
 * The customer signs in on the host's own portal (box.emiratespost.ae,
 * app.epgl.ae); the embed loader reads the resulting token from that origin's
 * localStorage and posts it into the widget. The chat route already verifies that
 * token on every turn, so this endpoint exists only so the widget can show
 * "signed in" the moment the popup completes rather than after the next message.
 *
 * It is a verification endpoint, not a trust boundary of its own: the token is
 * checked the same two ways the chat route checks it, and a caller who sends us
 * junk gets a 401 and no state change. Nothing here takes the client's word for
 * who they are -- the identity comes out of the token, never out of the request.
 */
export async function POST(req: NextRequest) {
  let body: { agent?: string; token?: string; cid?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  const { agent: slug, token, cid } = body;
  if (!slug || !token) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  const agent = await getAgentBySlug(slug);
  if (!agent) return NextResponse.json({ ok: false, error: "unknown_agent" }, { status: 404 });

  // Same two shapes the chat route handles, decided by what the token IS: a signed
  // JWS is verified against our key; an Emirates Post token is validated by using
  // it, which also returns the customer's Emirates ID.
  //
  // THE KEY IS THE TENANT'S. Emirates Post's identity service issues a signed JWT
  // too, so "looks signed and we hold a key" is not enough to decide — with the
  // key held unscoped, EPGL's certificate was used to check Emirates Post's
  // tokens and every sign-in through this endpoint failed.
  const tenant = agent.definition.tenantSlug;
  const looksSigned = token.split(".").length === 3;
  let sub: string | undefined;
  let reason = "";

  if (looksSigned && hostTokenConfigured(tenant)) {
    const v = verifyHostToken(token, { tenant });
    if (v.ok) sub = v.claims.sub;
    else reason = v.reason;
  } else {
    const usersBase = await epUsersBaseUrl(agent.id, agent.definition.activeEnvironment ?? "production");
    if (!usersBase) reason = "no host users service configured for this environment";
    else {
      const v = await introspectEmiratesPostToken(token, usersBase);
      if (v.ok) sub = v.identity.sub;
      else reason = v.reason;
    }
  }

  if (!sub) {
    log.warn("host_session_rejected", { agentId: agent.id, conversationId: cid, reason, signed: looksSigned });
    return NextResponse.json({ ok: false, error: "invalid_token" }, { status: 401 });
  }

  // Attach the verified identity when we already have a conversation. With no
  // conversation yet there is nothing to attach it to and nothing to do: the first
  // chat turn carries the same token and authenticates there.
  if (cid) {
    try {
      await markAuthenticated(cid, sub);
    } catch (e) {
      log.error("host_session_attach_failed", e, { agentId: agent.id, conversationId: cid });
    }
  }
  return NextResponse.json({ ok: true, cid: cid ?? null });
}
