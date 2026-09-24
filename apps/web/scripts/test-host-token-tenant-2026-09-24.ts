/**
 * One host's key must never check another host's token (2026-09-24).
 *
 * Emirates Post sign-in stopped working on the web, and it was our doing.
 *
 * Their identity service issues a SIGNED JWT — iss https://accounts-stg.
 * emiratespost.ae, aud [EPA.Profile, openid, profile], RS256 — and the route
 * chooses its verification path by the token's SHAPE:
 *
 *     const looksSigned = token.split(".").length === 3;
 *     if (looksSigned && hostTokenConfigured()) { verify against our key }
 *     else                                      { validate by using it }
 *
 * `hostTokenConfigured()` read an UNSCOPED setting. So the day EPGL's
 * certificate was installed for EPGL, every Emirates Post token started being
 * checked against EPGL's public key, failed on the signature, and a customer
 * who had just signed in on box-stg came back to a widget that did not know
 * them. The introspection that actually validates their token was never reached.
 *
 * The risk was written down two days earlier and waved off on a false premise —
 * "NXN's token is opaque so it never reaches this path". It is not opaque.
 *
 * So the key is scoped to the tenant, the way UAE PASS's credentials already
 * are, and EPGL's is held as HOST_TOKEN_PUBLIC_KEY_EPGL on both environments
 * with the unscoped name removed.
 *
 * Run from apps/web:  npx tsx scripts/test-host-token-tenant-2026-09-24.ts
 */
import { readFileSync } from "node:fs";
import { generateKeyPairSync, createSign } from "node:crypto";
import { hostTokenConfigured, hostTokenVar, verifyHostToken } from "../lib/hostToken";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, got?: unknown) {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`); }
}

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
/** A token signed by whichever host, so the cross-check is a real signature. */
function mint(privateKey: string, claims: Record<string, unknown>): string {
  const head = b64({ alg: "RS256", typ: "JWT" });
  const body = b64({ sub: "a-customer", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 900, ...claims });
  const s = createSign("RSA-SHA256");
  s.update(`${head}.${body}`);
  s.end();
  return `${head}.${body}.${s.sign(privateKey).toString("base64url")}`;
}

const epgl = generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
const post = generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });

const reset = () => {
  delete process.env.HOST_TOKEN_PUBLIC_KEY;
  delete process.env.HOST_TOKEN_PUBLIC_KEY_EPGL;
  delete process.env.HOST_TOKEN_PUBLIC_KEY_NXN;
  delete process.env.HOST_TOKEN_HS256_SECRET;
  delete process.env.HOST_TOKEN_HS256_SECRET_EPGL;
};

console.log("\nThe configuration that broke Emirates Post");
{
  reset();
  process.env.HOST_TOKEN_PUBLIC_KEY_EPGL = epgl.publicKey;
  // The whole bug in one assertion: with EPGL's key installed, is Emirates Post
  // now "configured"? It must not be — that is what diverted their token.
  check("EPGL is configured", hostTokenConfigured("epgl"));
  check("...and Emirates Post is NOT", !hostTokenConfigured("nxn"));
  check("...so their token goes to introspection, not to a signature check",
    verifyHostToken(mint(post.privateKey, { iss: "https://accounts-stg.emiratespost.ae" }), { tenant: "nxn" }).ok === false);
  const epglToken = mint(epgl.privateKey, { iss: "epgl.ae" });
  check("EPGL's own token still verifies", verifyHostToken(epglToken, { tenant: "epgl" }).ok);
}

console.log("\nAnd a key is never lent to the wrong host");
{
  reset();
  process.env.HOST_TOKEN_PUBLIC_KEY_EPGL = epgl.publicKey;
  process.env.HOST_TOKEN_PUBLIC_KEY_NXN = post.publicKey;
  check("each verifies its own", verifyHostToken(mint(epgl.privateKey, {}), { tenant: "epgl" }).ok && verifyHostToken(mint(post.privateKey, {}), { tenant: "nxn" }).ok);
  const crossed = verifyHostToken(mint(post.privateKey, {}), { tenant: "epgl" });
  check("...and neither verifies the other's", !crossed.ok, crossed);
  check("...reported as a bad signature, not as a missing key", crossed.ok === false && crossed.reason === "bad signature", crossed);
}

console.log("\nThe unscoped name still works where only one host signs");
{
  reset();
  process.env.HOST_TOKEN_PUBLIC_KEY = epgl.publicKey;
  check("it is the fallback for any tenant", hostTokenConfigured("whoever"));
  check("...and verifies", verifyHostToken(mint(epgl.privateKey, {}), { tenant: "whoever" }).ok);
  // And a tenant with its OWN key does not fall back to it.
  process.env.HOST_TOKEN_PUBLIC_KEY_NXN = post.publicKey;
  check("a tenant with its own key ignores the fallback",
    !verifyHostToken(mint(epgl.privateKey, {}), { tenant: "nxn" }).ok);
}

console.log("\nNothing configured is still a refusal");
{
  reset();
  check("no key, no verification", !hostTokenConfigured("epgl"));
  const r = verifyHostToken(mint(epgl.privateKey, {}), { tenant: "epgl" });
  check("...and the token is refused, not accepted", !r.ok && r.reason === "no verification key configured", r);
}

console.log("\nEvery caller passes the tenant");
const chat = readFileSync(new URL("../app/api/chat/route.ts", import.meta.url), "utf8");
const host = readFileSync(new URL("../app/api/uaepass/host/route.ts", import.meta.url), "utf8");
const handoff = readFileSync(new URL("../app/api/embed/handoff/route.ts", import.meta.url), "utf8");
for (const [name, src] of [["the chat route", chat], ["/api/uaepass/host", host], ["/api/embed/handoff", handoff]] as const) {
  check(`  ${name} scopes the check`, /hostTokenConfigured\(tenant\)/.test(src), name);
  check(`  ${name} scopes the verify`, /verifyHostToken\([^)]*\{ tenant \}\)/.test(src), name);
}
// The endpoint the relay's postMessage lands on is the one that mattered here.
check("...and /api/uaepass/host reads the tenant off the agent it was given",
  /const tenant = agent\.definition\.tenantSlug/.test(host));
check("the diagnostic log is scoped too, so it cannot say 'configured' for the wrong host",
  /configured: hostTokenConfigured\(agent\.definition\.tenantSlug\)/.test(chat));
check("the setting name is available for a message that names what is missing", hostTokenVar("epgl") === "HOST_TOKEN_PUBLIC_KEY_EPGL");

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
