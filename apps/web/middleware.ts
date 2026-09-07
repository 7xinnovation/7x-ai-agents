import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifySession, atLeast, sessionCanSee } from "@/lib/session";

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

  // Always allow the login + SSO surfaces themselves, and the invitation: the
  // person accepting one has no account yet, and the token in the link is what
  // stands in for a session until they have set a password.
  if (
    pathname === "/admin/login" ||
    pathname === "/api/admin/login" ||
    pathname.startsWith("/api/admin/sso/") ||
    pathname.startsWith("/admin/invite/") ||
    pathname === "/api/admin/invite"
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

  // Agent scope: an account limited to named agents cannot reach another's
  // editor or API, whatever it types in the address bar. The pages check this
  // against the database as well — the session's copy can be up to eight hours
  // old — but this stops it at the edge without a query.
  // Only the APIs are stopped here. A PAGE outside the scope is left to render
  // its own not-found: deny() would send it to the login screen, which reads as
  // "sign in again" for someone who is already signed in and simply not
  // entitled to that agent.
  const target = agentSlugIn(pathname);
  if (target && pathname.startsWith("/api/") && !sessionCanSee(claims, target)) return deny(404);

  return NextResponse.next();
}

/**
 * The agent a console path acts on, if it names one: `/admin/<slug>` and
 * `/api/admin/agents/<slug>/...`. Console pages that are not an agent editor
 * (`/admin/users`, `/admin/inbox`, …) are listed here so their names are never
 * mistaken for a slug.
 */
const CONSOLE_PAGES = new Set(["login", "invite", "users", "agents", "inbox", "analytics", "activity", "conversations", "readiness"]);
function agentSlugIn(pathname: string): string | null {
  const p = pathname.split("/").filter(Boolean);
  if (p[0] === "api" && p[1] === "admin" && p[2] === "agents" && p[3]) return decodeURIComponent(p[3]);
  if (p[0] === "admin" && p[1] && p.length === 2 && !CONSOLE_PAGES.has(p[1])) return decodeURIComponent(p[1]);
  return null;
}

/**
 * Set per-agent `frame-ancestors` from the agent's allowedOrigins. Empty list =
 * allow any host (dev default); a configured list restricts which sites may
 * embed that agent's widget.
 */
async function embedCsp(req: NextRequest) {
  const slug = req.nextUrl.pathname.split("/")[2] ?? "";
  let ancestors = "*";
  let diag = "not-attempted";
  // Behind a reverse proxy (Azure App Service, Railway) req.nextUrl.origin is
  // the INTERNAL origin, so fetching our own API through it fails and the catch
  // below quietly served frame-ancestors * — an agent with configured origins was
  // embeddable from anywhere, which is the opposite of what setting them means.
  //
  // The origin is NOT taken from x-forwarded-host alone. That header is written
  // by whoever is in front of us and anyone can put one on a request; this line
  // makes the server fetch a URL, so an unchecked header here is a way to make it
  // fetch someone else's. Only three origins are ever tried: the one this
  // deployment is configured as, the host the request actually arrived on, and
  // our own internal origin. They are tried in turn because a misconfigured
  // public URL must not leave us serving frame-ancestors * — the failure this
  // whole function exists to prevent.
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || req.nextUrl.protocol.replace(/:$/, "");
  const forwarded = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = req.headers.get("host")?.trim();
  const pinned = process.env.PUBLIC_APP_URL || process.env.NEXT_PUBLIC_DIALOG_HOST;
  const candidates: string[] = [];
  const addBase = (v: string | undefined | null) => {
    if (!v) return;
    try {
      const o = new URL(v).origin;
      if (!candidates.includes(o)) candidates.push(o);
    } catch {
      /* not a usable origin */
    }
  };
  if (pinned && /^https?:\/\//i.test(pinned)) addBase(pinned);
  // The forwarded host is trusted only when it agrees with the host the request
  // arrived on, which is what makes it a spelling of the same place rather than
  // a destination someone chose for us.
  if (forwarded && (!host || forwarded === host)) addBase(`${proto}://${forwarded}`);
  if (host) addBase(`${proto}://${host}`);
  addBase(req.nextUrl.origin);

  for (const base of candidates) {
    try {
      const r = await fetch(new URL(`/api/agents/${encodeURIComponent(slug)}`, base));
      diag = `base=${base} status=${r.status}`;
      if (!r.ok) continue;
      const cfg = await r.json();
      const origins: string[] = Array.isArray(cfg.allowedOrigins) ? cfg.allowedOrigins : [];
      diag += ` origins=${origins.length}`;
      if (origins.length) ancestors = ["'self'", ...origins].join(" ");
      break;
    } catch (e) {
      diag = `fetch-failed base=${base}: ${e instanceof Error ? e.message : "unknown"}`;
    }
  }
  const res = NextResponse.next();
  res.headers.set("Content-Security-Policy", `frame-ancestors ${ancestors}`);
  // Why the header came out as it did, on request. Without this the allow-all
  // fallback is indistinguishable from a deliberate open policy.
  if (req.nextUrl.searchParams.get("cspdebug") === "1") res.headers.set("X-CSP-Debug", diag);
  return res;
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*", "/embed/:path*"],
};
