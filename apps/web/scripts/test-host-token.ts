/**
 * Validation of the signed token NXN hands the embedded agent.
 *
 * The cases that matter are the ones an attacker would try, not the happy path:
 * a token with alg "none", an HMAC token offered when we hold a public key
 * (algorithm confusion), an expired one, and one signed with the wrong key.
 * Each must be rejected on its own, without relying on any other check.
 *
 * Run from apps/web:  npx tsx scripts/test-host-token.ts
 */
import { createHmac, generateKeyPairSync, createSign } from "node:crypto";
import { verifyHostToken, hostTokenConfigured } from "../lib/hostToken";

let failed = 0;
const check = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}${ok ? "" : `  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`);
};

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const SECRET = "shared-secret-from-nxn";
const now = Math.floor(Date.now() / 1000);

function hs256(claims: Record<string, unknown>, secret = SECRET, header: Record<string, unknown> = { alg: "HS256", typ: "JWT" }) {
  const input = `${b64(header)}.${b64(claims)}`;
  return `${input}.${createHmac("sha256", secret).update(input).digest("base64url")}`;
}

const clearEnv = () => {
  delete process.env.HOST_TOKEN_HS256_SECRET;
  delete process.env.HOST_TOKEN_PUBLIC_KEY;
  delete process.env.HOST_TOKEN_ISSUER;
  delete process.env.HOST_TOKEN_AUDIENCE;
  delete process.env.HOST_TOKEN_MAX_AGE_S;
};

console.log("fail-closed with nothing configured");
clearEnv();
check("configured() is false", hostTokenConfigured(), false);
check("a perfectly good token is still rejected", verifyHostToken(hs256({ sub: "u1" })).ok, false);
check("  reason names the missing key", verifyHostToken(hs256({ sub: "u1" })), { ok: false, reason: "no verification key configured" });

console.log("\nHMAC verification");
process.env.HOST_TOKEN_HS256_SECRET = SECRET;
check("valid token passes", verifyHostToken(hs256({ sub: "u1", exp: now + 300 })).ok, true);
check("  and carries the subject", (verifyHostToken(hs256({ sub: "u1" })) as { claims: { sub: string } }).claims.sub, "u1");
check("wrong signing key", verifyHostToken(hs256({ sub: "u1" }, "not-the-secret")).ok, false);
check("tampered payload", verifyHostToken(hs256({ sub: "u1" }).replace(/\.(.*)\./, `.${b64({ sub: "admin" })}.`)).ok, false);
check("expired", verifyHostToken(hs256({ sub: "u1", exp: now - 3600 })), { ok: false, reason: "token expired" });
check("not yet valid", verifyHostToken(hs256({ sub: "u1", nbf: now + 3600 })), { ok: false, reason: "token not yet valid" });
check("no subject", verifyHostToken(hs256({ exp: now + 300 })), { ok: false, reason: "no subject claim" });
check("not a JWS", verifyHostToken("just-a-string"), { ok: false, reason: "not a compact JWS" });
check("empty", verifyHostToken(""), { ok: false, reason: "no token" });
check("non-string", verifyHostToken(12345), { ok: false, reason: "no token" });

console.log("\nalgorithm confusion — the classic bypass");
// alg:none must never be honoured, whatever the payload says.
const none = `${b64({ alg: "none" })}.${b64({ sub: "admin" })}.`;
check("alg none", verifyHostToken(none), { ok: false, reason: "unsupported alg none" });
check("alg empty", verifyHostToken(`${b64({ alg: "" })}.${b64({ sub: "a" })}.x`), { ok: false, reason: "unsupported alg (none)" });

// Holding ONLY a public key, an HMAC-signed token must be refused rather than
// verified with the public key as if it were a shared secret.
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
clearEnv();
process.env.HOST_TOKEN_PUBLIC_KEY = pem;
check(
  "HMAC token offered against a public key",
  verifyHostToken(hs256({ sub: "admin" }, pem)),
  { ok: false, reason: "token is HMAC-signed but no shared secret is configured" }
);

console.log("\nRSA verification");
function rs256(claims: Record<string, unknown>) {
  const input = `${b64({ alg: "RS256", typ: "JWT" })}.${b64(claims)}`;
  const s = createSign("RSA-SHA256");
  s.update(input);
  s.end();
  return `${input}.${s.sign(privateKey).toString("base64url")}`;
}
check("valid RSA token", verifyHostToken(rs256({ sub: "u2", exp: now + 300 })).ok, true);
check("RSA token with a tampered payload", verifyHostToken(rs256({ sub: "u2" }).replace(/\.(.*)\./, `.${b64({ sub: "admin" })}.`)).ok, false);

console.log("\nissuer / audience / age pinning");
clearEnv();
process.env.HOST_TOKEN_HS256_SECRET = SECRET;
process.env.HOST_TOKEN_ISSUER = "https://nxn.emiratespost.ae";
check("wrong issuer", verifyHostToken(hs256({ sub: "u1", iss: "https://evil.example" })), { ok: false, reason: "unexpected issuer" });
check("right issuer", verifyHostToken(hs256({ sub: "u1", iss: "https://nxn.emiratespost.ae" })).ok, true);
process.env.HOST_TOKEN_AUDIENCE = "agent.7x.ae";
check("missing audience", verifyHostToken(hs256({ sub: "u1", iss: "https://nxn.emiratespost.ae" })), { ok: false, reason: "unexpected audience" });
check(
  "audience as an array",
  verifyHostToken(hs256({ sub: "u1", iss: "https://nxn.emiratespost.ae", aud: ["other", "agent.7x.ae"] })).ok,
  true
);
delete process.env.HOST_TOKEN_ISSUER;
delete process.env.HOST_TOKEN_AUDIENCE;
process.env.HOST_TOKEN_MAX_AGE_S = "300";
check("older than max age", verifyHostToken(hs256({ sub: "u1", iat: now - 4000 })), { ok: false, reason: "token older than the permitted age" });
check("within max age", verifyHostToken(hs256({ sub: "u1", iat: now - 10 })).ok, true);

console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
process.exit(failed ? 1 : 0);
