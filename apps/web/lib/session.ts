/**
 * Minimal signed session token (HS256, JWT-shaped) for the admin console.
 * Carries the user id + role so RBAC can be enforced in the edge middleware
 * without a DB hit. Signed/verified with Web Crypto so the same code runs in
 * both the Node runtime (login route) and the Edge runtime (middleware).
 */
export interface SessionClaims {
  uid: string;
  email: string;
  role: "owner" | "admin" | "editor" | "viewer";
  /**
   * Agent SLUGS this session may see. Absent or empty means all of them.
   *
   * Carried in the session so the middleware can enforce it at the edge without
   * a database read, and so a page can filter what it lists without asking who
   * is looking twice.
   */
  scope?: string[];
  exp: number; // epoch seconds
}

/** May this session see this agent? Scope only ever narrows below admin. */
export function sessionCanSee(claims: SessionClaims | null | undefined, slug: string): boolean {
  if (!claims) return false;
  if (claims.role === "owner" || claims.role === "admin") return true;
  const scope = claims.scope ?? [];
  return scope.length === 0 || scope.includes(slug);
}

const enc = new TextEncoder();
const b64url = (buf: ArrayBuffer | Uint8Array): string => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const b64urlDecode = (s: string): Uint8Array => {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const norm = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(norm);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

function secret(): string {
  return process.env.ADMIN_SESSION_SECRET || "dialog-dev-insecure-session-secret";
}

async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signSession(claims: Omit<SessionClaims, "exp">, ttlSeconds = 60 * 60 * 8): Promise<string> {
  const header = b64url(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payload: SessionClaims = { ...claims, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const data = `${header}.${body}`;
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(), enc.encode(data) as BufferSource);
  return `${data}.${b64url(sig)}`;
}

export async function verifySession(token: string | undefined | null): Promise<SessionClaims | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const data = `${header}.${body}`;
  try {
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(), b64urlDecode(sig!) as BufferSource, enc.encode(data) as BufferSource);
    if (!ok) return null;
    const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(body!))) as SessionClaims;
    if (!claims.exp || claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}

/** Role hierarchy → numeric rank for ≥ comparisons. */
export const ROLE_RANK: Record<SessionClaims["role"], number> = { viewer: 1, editor: 2, admin: 3, owner: 4 };
export const atLeast = (role: SessionClaims["role"] | undefined, min: SessionClaims["role"]): boolean =>
  !!role && ROLE_RANK[role] >= ROLE_RANK[min];
