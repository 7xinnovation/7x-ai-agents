import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { acceptInvite, userByInviteToken, markLogin } from "@/lib/users";
import { signSession } from "@/lib/session";

export const runtime = "nodejs";

/**
 * Accepting an invitation. Deliberately outside the admin session gate — the
 * person using it has no account yet — and the token IS the authentication.
 *
 * The response never says whether a token exists: an expired or spent link and
 * a made-up one answer identically, so the endpoint cannot be used to find live
 * invitations.
 */
const Body = z.object({
  token: z.string().min(20).max(200),
  // Longer than the six a console password needs: this one is chosen once,
  // by the person who will use it, with nobody waiting on them.
  password: z.string().min(8).max(200),
});

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const user = await acceptInvite(parsed.data.token, parsed.data.password);
  if (!user) return NextResponse.json({ error: "invite_invalid" }, { status: 400 });

  // Straight in: they have just proved they hold the invitation and set the
  // password, and a login screen at this point asks them to type it again for
  // no reason.
  await markLogin(user.id);
  const token = await signSession({
    uid: user.id,
    email: user.email,
    role: user.role,
    scope: user.agentScope ?? [],
  });
  const res = NextResponse.json({ ok: true, email: user.email, role: user.role });
  res.cookies.set("dlg_admin", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
  return res;
}

/** Is this link still good? Used to render the page, and it says nothing else. */
export async function GET(req: NextRequest) {
  const user = await userByInviteToken(req.nextUrl.searchParams.get("token") ?? "");
  if (!user) return NextResponse.json({ valid: false }, { status: 404 });
  return NextResponse.json({ valid: true, name: user.name, email: user.email, role: user.role });
}
