import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifySession, atLeast } from "@/lib/session";

/**
 * Gate the admin console and its APIs behind a signed RBAC session (PRD: User
 * Management + RBAC). The login route sets a signed HS256 cookie carrying the
 * user's role; this verifies the signature/expiry in the edge runtime and
 * enforces role requirements per route + method.
 */
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const method = req.method.toUpperCase();

  // Embed is public, but locked to each agent's approved origins via CSP.
  if (pathname.startsWith("/embed/")) {
    return embedCsp(req);
  }

  // Always allow the login + SSO surfaces themselves.
  if (
    pathname === "/admin/login" ||
    pathname === "/api/admin/login" ||
    pathname.startsWith("/api/admin/sso/")
  ) {
    return NextResponse.next();
  }

  const claims = await verifySession(req.cookies.get("dlg_admin")?.value);
  const deny = (status: number) => {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: status === 403 ? "forbidden" : "unauthorized" }, { status });
    const url = req.nextUrl.clone();
    url.pathname = "/admin/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  };

  if (!claims) return deny(401);

  // RBAC: user management requires admin+; any write (non-GET) requires editor+;
  // reads require viewer+ (any authenticated user).
  const isUserMgmt = pathname.startsWith("/api/admin/users") || pathname === "/admin/users";
  const isWrite = method !== "GET" && method !== "HEAD";
  let required: "viewer" | "editor" | "admin" = "viewer";
  if (isUserMgmt) required = "admin";
  else if (isWrite && pathname.startsWith("/api/")) required = "editor";

  if (!atLeast(claims.role, required)) {
    return pathname.startsWith("/api/") ? deny(403) : NextResponse.next();
  }
  return NextResponse.next();
}

/**
 * Set per-agent `frame-ancestors` from the agent's allowedOrigins. Empty list =
 * allow any host (dev default); a configured list restricts which sites may
 * embed that agent's widget.
 */
async function embedCsp(req: NextRequest) {
  const slug = req.nextUrl.pathname.split("/")[2] ?? "";
  let ancestors = "*";
  try {
    const r = await fetch(new URL(`/api/agents/${encodeURIComponent(slug)}`, req.nextUrl.origin));
    if (r.ok) {
      const cfg = await r.json();
      const origins: string[] = Array.isArray(cfg.allowedOrigins) ? cfg.allowedOrigins : [];
      if (origins.length) ancestors = ["'self'", ...origins].join(" ");
    }
  } catch {
    /* fall back to allow-all */
  }
  const res = NextResponse.next();
  res.headers.set("Content-Security-Policy", `frame-ancestors ${ancestors}`);
  return res;
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*", "/embed/:path*"],
};
