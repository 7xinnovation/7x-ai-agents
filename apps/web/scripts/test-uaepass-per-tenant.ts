/**
 * Each tenant must sign in with its OWN UAE PASS client.
 *
 * Before this, the config was one set of app-level env vars, so whichever tenant
 * was configured last silently owned sign-in for every agent on the app. With
 * NXN's production client in place, an EPGL sign-in would have been sent to
 * Emirates Post's redirect and failed with callback.not.match — a failure that
 * looks like a UAE PASS problem and is actually a wiring one.
 *
 * Run from apps/web:  npx tsx scripts/test-uaepass-per-tenant.ts
 */
import { buildAuthorizeUrl, uaePassConfigured } from "../lib/uaepass";

let failed = 0;
const check = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}${ok ? "" : `  (got ${JSON.stringify(got)})`}`);
};
const clientOf = (t?: string) => new URL(buildAuthorizeUrl("https://agent.7x.ae/cb", "s", t)).searchParams.get("client_id");
const hostOf = (t?: string) => new URL(buildAuthorizeUrl("https://agent.7x.ae/cb", "s", t)).host;

// Baseline: the unscoped vars, as an app with a single tenant would have.
process.env.UAEPASS_CLIENT_ID = "nxn_client";
process.env.UAEPASS_CLIENT_SECRET = "nxn_secret";
process.env.UAEPASS_BASE = "https://id.uaepass.ae";
for (const k of Object.keys(process.env)) if (/^UAEPASS_\w+_(NXN|EPGL)$/.test(k)) delete process.env[k];

console.log("with only app-level vars");
check("no tenant uses them", clientOf(), "nxn_client");
check("an unconfigured tenant falls back to them", clientOf("epgl"), "nxn_client");
check("configured() is true", uaePassConfigured("epgl"), true);

console.log("\nonce EPGL has its own client");
process.env.UAEPASS_CLIENT_ID_EPGL = "epgl_client";
process.env.UAEPASS_CLIENT_SECRET_EPGL = "epgl_secret";
process.env.UAEPASS_BASE_EPGL = "https://stg-id.uaepass.ae";
check("EPGL uses its own", clientOf("epgl"), "epgl_client");
check("EPGL uses its own base", hostOf("epgl"), "stg-id.uaepass.ae");
check("NXN is untouched", clientOf("nxn"), "nxn_client");
check("NXN keeps its base", hostOf("nxn"), "id.uaepass.ae");
check("no tenant still uses the app-level one", clientOf(), "nxn_client");

console.log("\nthe case that used to fail silently");
// A tenant configured with ONLY a client id is misconfigured, not usable.
delete process.env.UAEPASS_CLIENT_SECRET_EPGL;
check("half-configured tenant is not reported as configured", uaePassConfigured("epgl"), false);

console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
process.exit(failed ? 1 : 0);
