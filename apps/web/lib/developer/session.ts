/**
 * The developer portal's session: a signed cookie naming the account. Its own
 * secret and its own cookie, so a console session never opens the portal and
 * a portal session never opens the console.
 */
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { getDb, developerAccounts } from "@dialog/db";
import { derivedSecret, signJwt, verifyJwt, type JwtClaims } from "./jwt";

export const DEV_COOKIE = "dlg_dev";
const TTL_SECONDS = 60 * 60 * 12;
const SECRET_LABEL = "developer-session";

export interface DeveloperClaims extends JwtClaims {
  aid: string;
  email: string;
  name: string;
  org: string;
  /** Filled from the database on every read, never trusted from the cookie. */
  role?: "developer" | "admin";
}

export async function signDeveloperSession(c: Omit<DeveloperClaims, "exp" | "iat" | "role">): Promise<string> {
  return signJwt({ aid: c.aid, email: c.email, name: c.name, org: c.org }, derivedSecret(SECRET_LABEL), TTL_SECONDS);
}

/**
 * The signed cookie names the account; the account's row decides the rest.
 * A deactivated account is signed out on its next request, a role change takes
 * effect at once, and the cookie's own copy of name and organisation is
 * refreshed from the row.
 */
export async function verifyDeveloperSession(token: string | undefined | null): Promise<DeveloperClaims | null> {
  const claims = await verifyJwt<DeveloperClaims>(token, derivedSecret(SECRET_LABEL));
  if (!claims || !claims.aid) return null;
  try {
    const [row] = await getDb()
      .select({ active: developerAccounts.active, role: developerAccounts.role, name: developerAccounts.name, org: developerAccounts.organization, email: developerAccounts.email })
      .from(developerAccounts)
      .where(eq(developerAccounts.id, claims.aid))
      .limit(1);
    if (!row || !row.active) return null;
    return { ...claims, name: row.name, org: row.org, email: row.email, role: row.role === "admin" ? "admin" : "developer" };
  } catch {
    return null;
  }
}

export const developerCookie = (token: string) => ({
  name: DEV_COOKIE,
  value: token,
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: TTL_SECONDS,
});

/** The signed-in developer for a server component or a route handler. */
export async function currentDeveloper(): Promise<DeveloperClaims | null> {
  const jar = await cookies();
  return verifyDeveloperSession(jar.get(DEV_COOKIE)?.value);
}

/** The signed-in developer for a route handler given its request. */
export async function developerFromRequest(req: Request): Promise<DeveloperClaims | null> {
  const raw = req.headers.get("cookie") ?? "";
  const m = raw.split(/;\s*/).find((c) => c.startsWith(`${DEV_COOKIE}=`));
  return verifyDeveloperSession(m ? decodeURIComponent(m.slice(DEV_COOKIE.length + 1)) : null);
}
