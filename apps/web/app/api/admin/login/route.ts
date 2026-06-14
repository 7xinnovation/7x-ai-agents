import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/** Exchange the admin password for a session cookie. */
export async function POST(req: NextRequest) {
  const { password } = await req.json().catch(() => ({ password: "" }));
  if (!process.env.ADMIN_PASSWORD || password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: "invalid_password" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set("dlg_admin", process.env.ADMIN_SESSION_SECRET ?? "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8, // 8 hours
  });
  return res;
}
