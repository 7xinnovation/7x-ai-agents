import { NextRequest, NextResponse } from "next/server";
import { uaePassConfigured, uaePassMock, uaePassMockAllowed, buildAuthorizeUrl, resolveRedirectUri, requestOrigin } from "@/lib/uaepass";

export const runtime = "nodejs";

/**
 * Customer UAE PASS sign-in — step 1. Redirects to the UAE PASS authorize page.
 * Carries the conversation id + return URL in a short-lived signed-ish cookie so
 * the callback can attach the obtained session to the right conversation.
 * Query: cid (conversationId), agent (slug), returnTo (embed URL to come back to).
 */
export async function GET(req: NextRequest) {
  if (!uaePassConfigured()) {
    return NextResponse.json({ error: "uaepass_not_configured", hint: "Set UAEPASS_CLIENT_ID/SECRET/BASE." }, { status: 501 });
  }
  const origin = requestOrigin(req);
  const cid = req.nextUrl.searchParams.get("cid") ?? "";
  const agent = req.nextUrl.searchParams.get("agent") ?? "";
  const returnTo = req.nextUrl.searchParams.get("returnTo") || `${origin}/embed/${agent}`;
  // Popup mode: the embed opened this flow in a popup window (it can't redirect
  // its own iframe to UAE PASS — frame-ancestors forbids it). The callback then
  // notifies the opener via postMessage and closes instead of redirecting.
  const popup = req.nextUrl.searchParams.get("popup") === "1";
  const state = crypto.randomUUID();
  // Mock this request when the whole deployment is mocked (dev), OR when the caller
  // opted in with ?mock=1 and the deployment permits it (UAEPASS_MOCK_ALLOWED) — so
  // testers can simulate a login on a live URL while real customers still get UAE
  // PASS. The decision rides in the flow cookie so the callback stays consistent.
  const wantMock = uaePassMock() || (uaePassMockAllowed() && req.nextUrl.searchParams.get("mock") === "1");
  // Mock mode: skip UAE PASS, go straight to our callback with a fake code so the
  // full flow can be tested without a real UAE PASS session.
  const target = wantMock
    ? `${origin}/api/uaepass/callback?code=MOCK_CODE&state=${state}`
    : buildAuthorizeUrl(resolveRedirectUri(origin), state);

  const res = NextResponse.redirect(target);
  res.cookies.set("uaepass_flow", JSON.stringify({ state, cid, agent, returnTo, popup, mock: wantMock }), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 600,
  });
  return res;
}
