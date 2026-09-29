import { NextRequest, NextResponse } from "next/server";
import { buildLogoutUrl, requestOrigin } from "@/lib/uaepass";
import { getAgentBySlug } from "@/lib/agents";

export const runtime = "nodejs";

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
  const target = buildLogoutUrl(`${origin}/uaepass/done`, known?.definition.tenantSlug);
  // Nothing to log out of: send them to the page that closes itself, so the
  // widget's window still goes away rather than sitting on an error.
  return NextResponse.redirect(target ?? `${origin}/uaepass/done`);
}
