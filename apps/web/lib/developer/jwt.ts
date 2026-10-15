/**
 * HS256 JSON Web Tokens on Web Crypto, for the developer portal session and the
 * A2A access token. The same shape as lib/session.ts, with the secret a
 * parameter, so the two token families never verify each other.
 */
import { createHmac } from "node:crypto";

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

async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

/**
 * A secret for one token family, derived from the deployment's session secret
 * when no dedicated one is set. `A2A_TOKEN_SECRET` overrides it; rotating that
 * invalidates every outstanding access token and portal session at once.
 */
export function derivedSecret(label: string): string {
  const dedicated = process.env.A2A_TOKEN_SECRET;
  if (dedicated) return createHmac("sha256", dedicated).update(label).digest("hex");
  const base = process.env.ADMIN_SESSION_SECRET || "dialog-dev-insecure-session-secret";
  return createHmac("sha256", base).update(`dialog:${label}`).digest("hex");
}

export interface JwtClaims {
  exp: number;
  iat: number;
  [k: string]: unknown;
}

export async function signJwt(payload: Record<string, unknown>, secret: string, ttlSeconds: number): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64url(enc.encode(JSON.stringify({ ...payload, iat: now, exp: now + ttlSeconds })));
  const data = `${header}.${body}`;
  const sig = await crypto.subtle.sign("HMAC", await key(secret), enc.encode(data) as BufferSource);
  return `${data}.${b64url(sig)}`;
}

export async function verifyJwt<T extends JwtClaims = JwtClaims>(token: string | null | undefined, secret: string): Promise<T | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  try {
    const hdr = JSON.parse(new TextDecoder().decode(b64urlDecode(header!))) as { alg?: string };
    if (hdr.alg !== "HS256") return null;
    const ok = await crypto.subtle.verify("HMAC", await key(secret), b64urlDecode(sig!) as BufferSource, enc.encode(`${header}.${body}`) as BufferSource);
    if (!ok) return null;
    const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(body!))) as T;
    if (!claims.exp || claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}
