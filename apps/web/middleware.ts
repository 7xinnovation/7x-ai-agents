import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Gate the admin console and its APIs behind a session cookie. The login route
 * sets the cookie to ADMIN_SESSION_SECRET after a password check; everything
 * under /admin and /api/admin requires it. Scaffold-grade (opaque shared
 * secret) — swap for real SSO before a serious deployment.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Always allow the login surface itself.
  if (pathname === "/admin/login" || pathname === "/api/admin/login") {
    return NextResponse.next();
  }

  const token = req.cookies.get("dlg_admin")?.value;
  if (token && token === process.env.ADMIN_SESSION_SECRET) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/admin/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
