/**
 * The developer portal's session: a signed cookie naming the account. Its own
 * secret and its own cookie, so a console session never opens the portal and
 * a portal session never opens the console.
 */
import { cookies } from "next/headers";
import { derivedSecret, signJwt, verifyJwt, type JwtClaims } from "./jwt";

export const DEV_COOKIE = "dlg_dev";
const TTL_SECONDS = 60 * 60 * 12;
const SECRET_LABEL = "developer-session";

export interface DeveloperClaims extends JwtClaims {
  aid: string;
  email: string;
  name: string;
  org: string;
}

export async function signDeveloperSession(c: Omit<DeveloperClaims, "exp" | "iat">): Promise<string> {
  return signJwt(c, derivedSecret(SECRET_LABEL), TTL_SECONDS);
}

export async function verifyDeveloperSession(token: string | undefined | null): Promise<DeveloperClaims | null> {
  const claims = await verifyJwt<DeveloperClaims>(token, derivedSecret(SECRET_LABEL));
  return claims && claims.aid ? claims : null;
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
