import { NextRequest, NextResponse } from "next/server";
import { buildLogoutUrl, requestOrigin } from "@/lib/uaepass";
import { getAgentBySlug } from "@/lib/agents";

export const runtime = "nodejs";

/**
 * THE BELT UNDER THE LOGOUT: the next sign-in from this browser asks UAE PASS
 * to authenticate again (`prompt=login`), whether or not the logout window
 * above was opened, finished, or closed early. Set here and by
 * /api/embed/signout; the login route reads it; a completed sign-in clears it.
 * A day is longer than any sign-out-then-sign-in and shorter than forever.
 */
export const RELOGIN_COOKIE = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24,
};

/**
 * END THE UAE PASS SESSION ITSELF, not just ours.
 *
 * "I literally clicked sign out and when I clicked sign in, it signed me in
 * instantly without asking me to login again with UAE PASS."
 *
 * Because signing out of us was never signing out of UAE PASS. Ours is a
 * session against the conversation; theirs is a single sign-on cookie on
 * id.uaepass.ae, and it is the one that decides whether the customer is asked
 * for their phone. The first attempt at this added `prompt=login` to the
 * authorize call, which asks UAE PASS to ignore a session it still holds —
 * useful only if they honour it, and they evidently do not.
 *
 * This ends it. A browser navigation to UAE PASS's own logout endpoint is the
 * only thing that clears a cookie on their origin, so the widget opens this in
 * a small window: we redirect to UAE PASS, they clear the session, and they
 * send the browser back to /uaepass/done, which closes itself.
 *
 * Not an error if UAE PASS is not configured for this tenant, and not an error
 * if the customer closes the window early — our own sign-out has already
 * happened by the time this runs, and this is the part that makes the NEXT
 * sign-in ask who they are.
 */
export async function GET(req: NextRequest) {
  const origin = requestOrigin(req);
  const agent = req.nextUrl.searchParams.get("agent") ?? "";
  const known = agent ? await getAgentBySlug(agent) : undefined;
  /**
   * WHERE UAE PASS SENDS THE BROWSER IS NOT OURS TO DECIDE.
   *
   * We pass `redirect_uri` and they are free to ignore it — on production they
   * did, sending the browser to the URL registered against the Emirates Post
   * client (their own portal dashboard) instead of to our page. The logout
   * still happens; only the landing does not.
   *
   * Two consequences, both handled elsewhere rather than here: the widget
   * waits for /uaepass/done to report and otherwise moves the window on after
   * eight seconds, and the next sign-in carries `prompt=login` — from the
   * cookie set below, so a reload cannot forget it. Registering our post-logout
   * URI with UAE PASS would make the landing ours every time — a request to
   * Emirates Post, not a change we can make.
   *
   * 12 October 2026: followed with curl against both environments, the chain
   * id.uaepass.ae → ids.uaepass.ae/commonauth → trustedx-authserver/…/logout
   * DID carry our redirect_uri through and land on /uaepass/done (200), with
   * no session. So the done page's report is the usual case now, and the
   * timer is the fallback for a live session that is bounced elsewhere.
   */
  const target = buildLogoutUrl(`${origin}/uaepass/done`, known?.definition.tenantSlug);
  // Nothing to log out of: send them to the page that closes itself, so the
  // widget's window still goes away rather than sitting on an error.
  const res = NextResponse.redirect(target ?? `${origin}/uaepass/done`);
  res.cookies.set("uaepass_relogin", "1", RELOGIN_COOKIE);
  return res;
}
