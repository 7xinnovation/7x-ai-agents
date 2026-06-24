import { NextRequest, NextResponse } from "next/server";
import { uaePassConfigured, buildAuthorizeUrl, resolveRedirectUri } from "@/lib/uaepass";

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
  const cid = req.nextUrl.searchParams.get("cid") ?? "";
  const agent = req.nextUrl.searchParams.get("agent") ?? "";
  const returnTo = req.nextUrl.searchParams.get("returnTo") || `${req.nextUrl.origin}/embed/${agent}`;
  const redirectUri = resolveRedirectUri(req.nextUrl.origin);
  const state = crypto.randomUUID();

  const res = NextResponse.redirect(buildAuthorizeUrl(redirectUri, state));
  res.cookies.set("uaepass_flow", JSON.stringify({ state, cid, agent, returnTo }), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 600,
  });
  return res;
}
