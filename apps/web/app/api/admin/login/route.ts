import { NextRequest, NextResponse } from "next/server";
import { getUserByEmail, verifyPassword, markLogin, ensureBootstrapOwner } from "@/lib/users";
import { signSession } from "@/lib/session";

export const runtime = "nodejs";

/**
 * Exchange credentials for a signed RBAC session cookie. Two paths:
 *  - email + password → verified against the users table (scrypt), role from DB.
 *  - password only → bootstrap owner login via ADMIN_PASSWORD (first-run / e2e).
 * The cookie is a signed HS256 token carrying {uid, email, role, exp}.
 */
export async function POST(req: NextRequest) {
  const { email, password } = await req.json().catch(() => ({ email: "", password: "" }));
  if (!password) return NextResponse.json({ error: "missing_password" }, { status: 400 });

  let claims:
    | { uid: string; email: string; role: "owner" | "admin" | "editor" | "viewer"; scope?: string[] }
    | null = null;

  if (email) {
    const user = await getUserByEmail(String(email));
    if (user && user.active && verifyPassword(String(password), user.passwordHash)) {
      await markLogin(user.id);
      claims = { uid: user.id, email: user.email, role: user.role, scope: user.agentScope ?? [] };
    }
  } else if (process.env.ADMIN_PASSWORD && password === process.env.ADMIN_PASSWORD) {
    // Bootstrap: password-only login maps to the owner account (created on demand).
    const owner = await ensureBootstrapOwner();
    await markLogin(owner.id);
    claims = { uid: owner.id, email: owner.email, role: owner.role };
  }

  if (!claims) return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });

  const token = await signSession(claims);
  const res = NextResponse.json({ ok: true, role: claims.role, email: claims.email });
  res.cookies.set("dlg_admin", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
  return res;
}
