import { createHmac, createPublicKey, createVerify, timingSafeEqual } from "node:crypto";
import { listIntegrations, type EnvKey, type EnvSpec } from "./integrations";

/**
 * Validation for the signed token the host site hands the embedded agent.
 *
 * The flow: UAE PASS -> emiratespost.ae callback -> NXN authenticates the customer
 * -> NXN issues a SIGNED token -> the embed (agent.7x.ae in production,
 * 7xagents.7x-lab.com in staging) receives it by postMessage -> this validates it
 * -> the claims become the customer's identity, and the raw token becomes the
 * bearer for Emirates Post's protected endpoints.
 *
 * Before this existed the token was taken at face value: the embed accepted
 * anything posted to it with `source === "dialog-host"`, on any origin, and passed
 * it straight through. Emirates Post would have rejected a forged one, but we
 * would already have treated the holder as that customer on our side.
 *
 * FAIL CLOSED. With no verification key configured, every token is rejected. An
 * unverifiable token is worth exactly as much as no token, and the alternative —
 * trusting it "until the key arrives" — is how a temporary gap becomes permanent.
 *
 * Configuration (all optional except the key material):
 *   HOST_TOKEN_HS256_SECRET   shared secret, if NXN signs with HMAC
 *   HOST_TOKEN_PUBLIC_KEY     PEM public key, if NXN signs with RSA/ECDSA
 *   HOST_TOKEN_ISSUER         expected `iss`, when the issuer is pinned
 *   HOST_TOKEN_AUDIENCE       expected `aud`, when the audience is pinned
 *   HOST_TOKEN_MAX_AGE_S      reject tokens older than this even if `exp` is generous
 */

export interface HostTokenClaims {
  /** Stable customer identifier — the UAE PASS subject NXN authenticated. */
  sub: string;
  iss?: string;
  aud?: string | string[];
  exp?: number;
  iat?: number;
  nbf?: number;
  /** Emirates ID, when NXN includes it. */
  emiratesId?: string;
  [claim: string]: unknown;
}

export type HostTokenResult =
  | { ok: true; claims: HostTokenClaims }
  | { ok: false; reason: string };

/** Is any verification material configured? When false, every token is rejected. */
export function hostTokenConfigured(): boolean {
  return Boolean(process.env.HOST_TOKEN_HS256_SECRET || process.env.HOST_TOKEN_PUBLIC_KEY);
}

/**
 * Emirates Post confirmed how the handoff actually works, and it is not a JWT.
 *
 *   UAE PASS -> emiratespost.ae -> NXN sends the AUTH CODE to
 *   /services/pobox/users/api/v1/Account/Token -> their identity service returns
 *   an opaque accessToken -> that token is the bearer their protected endpoints
 *   want, and it is what reaches the widget.
 *
 * The code is exchanged with THEIR UAE PASS client (the failure body names
 * "Origin: box-stg.emiratespost.ae"), which is why the widget has to sit behind
 * their sign-in rather than running its own — a code issued to our client is not
 * one they can redeem.
 *
 * An opaque token has no signature to check, so it is validated by USING it:
 * GET /api/v1/Account returns the customer when the token is good and 401s when
 * it is not. That is a real check, not a assumption, and it hands back the
 * identity at the same time — including the Emirates ID the GSB ownership check
 * needs, which no signed claim would have given us for free.
 *
 * Results are cached briefly: without it every chat turn would pay a round trip
 * to Emirates Post before the model is even called.
 */
export interface EpIdentity {
  /** UAE PASS subject — the stable identifier for this customer. */
  sub: string;
  emiratesId?: string;
  mobileNumber?: string;
  name?: string;
  /** Emirates Post's own numeric user id. */
  epUserId?: number;
}

const INTROSPECT_TTL_MS = 60_000;
const introspectCache = new Map<string, { at: number; result: EpIdentity | null }>();

/** Never key a cache on a bearer in the clear — a heap dump should not leak sessions. */
function cacheKey(token: string): string {
  return createHmac("sha256", "host-token-cache").update(token).digest("base64url");
}

export async function introspectEmiratesPostToken(
  token: string,
  usersBaseUrl: string
): Promise<{ ok: true; identity: EpIdentity } | { ok: false; reason: string }> {
  if (!token) return { ok: false, reason: "no token" };
  const key = cacheKey(token);
  const hit = introspectCache.get(key);
  if (hit && Date.now() - hit.at < INTROSPECT_TTL_MS) {
    return hit.result ? { ok: true, identity: hit.result } : { ok: false, reason: "rejected by Emirates Post (cached)" };
  }

  let res: Response;
  try {
    res = await fetch(`${usersBaseUrl.replace(/\/$/, "")}/api/v1/Account`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
  } catch (e) {
    // A network failure is NOT proof the token is bad, so it is not cached as a
    // rejection — that would turn a blip into a sign-out for everyone holding one.
    return { ok: false, reason: `could not reach Emirates Post: ${(e as Error).message}` };
  }

  if (res.status === 401) {
    introspectCache.set(key, { at: Date.now(), result: null });
    return { ok: false, reason: "rejected by Emirates Post" };
  }
  if (!res.ok) return { ok: false, reason: `Emirates Post returned HTTP ${res.status}` };

  const body = (await res.json().catch(() => null)) as { payload?: Record<string, unknown> } | null;
  const u = body?.payload;
  if (!u) return { ok: false, reason: "no user in the response" };

  const sub = String(u.uaePassId ?? u.emiratesId ?? u.id ?? "").trim();
  if (!sub) return { ok: false, reason: "no identifier on the user record" };

  const identity: EpIdentity = {
    sub,
    emiratesId: typeof u.emiratesId === "string" ? u.emiratesId : undefined,
    mobileNumber: typeof u.mobileNumber === "string" ? u.mobileNumber : undefined,
    name: [u.firstNameEN, u.lastNameEN].filter((x) => typeof x === "string" && x).join(" ").trim() || undefined,
    epUserId: typeof u.id === "number" ? u.id : undefined,
  };
  introspectCache.set(key, { at: Date.now(), result: identity });
  return { ok: true, identity };
}

const b64urlToBuf = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

/** Constant-time compare that never throws on a length mismatch. */
function sameSignature(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const ALGS: Record<string, "hmac" | "rsa" | "ec"> = {
  HS256: "hmac", HS384: "hmac", HS512: "hmac",
  RS256: "rsa", RS384: "rsa", RS512: "rsa",
  ES256: "ec", ES384: "ec", ES512: "ec",
};

const NODE_HASH: Record<string, string> = {
  HS256: "sha256", HS384: "sha384", HS512: "sha512",
  RS256: "RSA-SHA256", RS384: "RSA-SHA384", RS512: "RSA-SHA512",
  ES256: "sha256", ES384: "sha384", ES512: "sha512",
};

/**
 * Verify a compact JWS and return its claims.
 *
 * `alg` is read from the header only to select the verifier, and is then checked
 * against the key material we actually hold — a token declaring "none", or an
 * HMAC token where we hold a public key, is rejected rather than being allowed to
 * choose its own verification. That confusion is the classic JWT bypass.
 */
export function verifyHostToken(token: unknown, now = Date.now()): HostTokenResult {
  if (typeof token !== "string" || !token) return { ok: false, reason: "no token" };
  if (!hostTokenConfigured()) return { ok: false, reason: "no verification key configured" };

  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "not a compact JWS" };
  const [h, p, s] = parts as [string, string, string];

  let header: { alg?: string; typ?: string };
  let claims: HostTokenClaims;
  try {
    header = JSON.parse(b64urlToBuf(h).toString("utf8"));
    claims = JSON.parse(b64urlToBuf(p).toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed token" };
  }

  const alg = String(header.alg ?? "");
  const kind = ALGS[alg];
  if (!kind) return { ok: false, reason: `unsupported alg ${alg || "(none)"}` };

  const secret = process.env.HOST_TOKEN_HS256_SECRET;
  const pubKey = process.env.HOST_TOKEN_PUBLIC_KEY;
  // The key we hold decides the algorithm family, never the token's own header.
  if (kind === "hmac" && !secret) return { ok: false, reason: "token is HMAC-signed but no shared secret is configured" };
  if (kind !== "hmac" && !pubKey) return { ok: false, reason: "token is asymmetrically signed but no public key is configured" };

  const signingInput = `${h}.${p}`;
  const sig = b64urlToBuf(s);
  let valid = false;
  try {
    if (kind === "hmac") {
      const expected = createHmac(NODE_HASH[alg]!, secret!).update(signingInput).digest();
      valid = sameSignature(sig, expected);
    } else {
      const verifier = createVerify(NODE_HASH[alg]!);
      verifier.update(signingInput);
      verifier.end();
      valid = verifier.verify(createPublicKey(pubKey!), sig);
    }
  } catch {
    return { ok: false, reason: "signature check failed" };
  }
  if (!valid) return { ok: false, reason: "bad signature" };

  const nowS = Math.floor(now / 1000);
  const skew = 60; // clock drift between NXN and us
  if (typeof claims.exp === "number" && nowS > claims.exp + skew) return { ok: false, reason: "token expired" };
  if (typeof claims.nbf === "number" && nowS + skew < claims.nbf) return { ok: false, reason: "token not yet valid" };

  const maxAge = Number(process.env.HOST_TOKEN_MAX_AGE_S ?? 0);
  if (maxAge > 0 && typeof claims.iat === "number" && nowS - claims.iat > maxAge + skew) {
    return { ok: false, reason: "token older than the permitted age" };
  }

  const wantIss = process.env.HOST_TOKEN_ISSUER;
  if (wantIss && claims.iss !== wantIss) return { ok: false, reason: "unexpected issuer" };

  const wantAud = process.env.HOST_TOKEN_AUDIENCE;
  if (wantAud) {
    const aud = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : [];
    if (!aud.includes(wantAud)) return { ok: false, reason: "unexpected audience" };
  }

  // Without a subject the token proves a signature but identifies nobody, which is
  // not something we can attach a conversation to.
  if (!claims.sub || typeof claims.sub !== "string") return { ok: false, reason: "no subject claim" };

  return { ok: true, claims };
}

/**
 * The users service sits on a DIFFERENT path prefix from the PO Box API
 * (/services/pobox/users vs /services/pobox), which is why Account/Token is
 * absent from the swagger we were originally given and the token exchange looked
 * like it did not exist at all.
 *
 * Derived from the NXN integration's own base URL so staging and production
 * follow it automatically rather than needing a second setting to keep in sync.
 */
export async function epUsersBaseUrl(agentId: string, env: EnvKey): Promise<string | undefined> {
  const row = (await listIntegrations(agentId)).find((r) => /nxn/i.test(r.name));
  const spec = row?.environments[env] as EnvSpec | undefined;
  return spec?.baseUrl ? `${spec.baseUrl.replace(/\/$/, "")}/users` : undefined;
}
