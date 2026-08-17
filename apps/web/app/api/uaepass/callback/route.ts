import { NextRequest, NextResponse } from "next/server";
import { uaePassConfigured, uaePassMockAllowed, exchangeCode, resolveRedirectUri, requestOrigin } from "@/lib/uaepass";
import { saveSessionToken, markAuthenticated, getOrCreateSession } from "@/lib/conversation";
import { getAgentBySlug } from "@/lib/agents";
import { MOCK_PERSONA_SUB, MOCK_PERSONA_NAME } from "@/lib/mockPersona";
import { log } from "@/lib/logger";

export const runtime = "nodejs";

/**
 * Customer UAE PASS sign-in — step 2. Exchanges the auth code for the user's
 * access token + identity, attaches it to the conversation (the token becomes the
 * session bearer reused for protected integration calls), then returns to the embed.
 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const err = req.nextUrl.searchParams.get("error");
  let flow: { state?: string; cid?: string; agent?: string; returnTo?: string; popup?: boolean; mock?: boolean } = {};
  try { flow = JSON.parse(req.cookies.get("uaepass_flow")?.value ?? "{}"); } catch { /* ignore */ }
  // Honour the mock decision made at login, but only if this deployment still
  // permits it (guards against a stale cookie after the flag is turned off).
  const isMock = uaePassMockAllowed() && Boolean(flow.mock);
  // The code was issued to the tenant's OWN UAE PASS client at login, so it can
  // only be redeemed with that tenant's credentials. Reading them from the flow
  // cookie's agent keeps both halves of the round trip on the same client.
  const flowTenant = flow.agent ? (await getAgentBySlug(flow.agent))?.definition.tenantSlug : undefined;
  if (!uaePassConfigured(flowTenant)) return NextResponse.json({ error: "uaepass_not_configured" }, { status: 501 });

  const back = (params: Record<string, string>, cid: string | undefined = flow.cid) => {
    // Popup flow: hand the result back to the chat via postMessage and close —
    // the embed stays exactly where it was (no page navigation at all).
    if (flow.popup) {
      const payload = JSON.stringify({ source: "dialog-uaepass", status: params.uaepass ?? "ok", cid: cid ?? null });
      // postMessage must target the OPENER's origin (the embed), not this request's
      // internal origin (localhost behind the proxy) or the message is dropped.
      let targetOrigin = requestOrigin(req);
      try { if (flow.returnTo) targetOrigin = new URL(flow.returnTo).origin; } catch { /* keep default */ }
      const origin = JSON.stringify(targetOrigin);
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>Sign-in complete</title></head>
<body style="font-family:-apple-system,system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;color:#5b6478">
<p>Returning you to the chat…</p>
<script>try{if(window.opener)window.opener.postMessage(${payload},${origin});}catch(e){}window.close();</script>
</body></html>`;
      const res = new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
      res.cookies.delete("uaepass_flow");
      return res;
    }
    const url = new URL(flow.returnTo || `${requestOrigin(req)}/embed/${flow.agent ?? ""}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    if (cid) url.searchParams.set("cid", cid);
    const res = NextResponse.redirect(url.toString());
    res.cookies.delete("uaepass_flow");
    return res;
  };

  if (err) return back({ uaepass: "cancelled" });
  if (!code || !state || state !== flow.state) return back({ uaepass: "invalid_state" });

  try {
    // Mock mode: synthesize a verified identity instead of calling UAE PASS, so the
    // sign-in → session → authenticated flow is testable without registration.
    const id = isMock
      ? { accessToken: `mock-uaepass-${crypto.randomUUID()}`, sub: MOCK_PERSONA_SUB, name: MOCK_PERSONA_NAME }
      : await exchangeCode(code, resolveRedirectUri(requestOrigin(req)), flowTenant);
    // Signed in before the first message → no conversation exists yet. Create it
    // here so the verified identity has somewhere to live; the redirect's ?cid=
    // pins it in the embed, and the post-sign-in pulse lands in it.
    let cid = flow.cid;
    if (!cid && flow.agent) {
      const agent = await getAgentBySlug(flow.agent);
      if (agent) {
        const s = await getOrCreateSession({ agentId: agent.id, locale: "en", authenticated: false });
        cid = s.conversationId;
      }
    }
    if (cid) {
      // Stored as an IDENTITY token (kind "uaepass"), not a backend API session:
      // only integrations that declare authType "uaepass_live" may use it as their
      // bearer. Anything else keeps using its own stored service credentials —
      // FB-1485: a UAE PASS access token sent to Emirates Post 401s, and the agent
      // then told an already-signed-in customer to sign in again.
      // In mock mode the "token" is a synthetic placeholder no backend would
      // accept, so it is not stored at all; the mock persona stays authenticated
      // for journey gating.
      if (!isMock) await saveSessionToken(cid, id.accessToken, "uaepass");
      await markAuthenticated(cid, id.sub);
    }
    return back({ uaepass: "ok" }, cid);
  } catch (e) {
    log.error("uaepass_callback_failed", e, { cid: flow.cid });
    return back({ uaepass: "error" });
  }
}
