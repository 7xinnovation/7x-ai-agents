/**
 * Emirates Post token introspection.
 *
 * Their identity-service token is opaque, so it is validated by USING it:
 * GET /services/pobox/users/api/v1/Account returns the customer for a good token
 * and 401s for a bad one. These check the rejection paths against the live
 * staging service — the acceptance path needs a real token from their sign-in.
 *
 * Run from apps/web:  npx tsx scripts/test-ep-introspect.ts
 */
import { introspectEmiratesPostToken } from "../lib/hostToken";

const BASE = "https://box-stg.emiratespost.ae/services/pobox/users";
let failed = 0;
const check = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}${ok ? "" : `  (got ${JSON.stringify(got)})`}`);
};

async function main() {
  check("empty token", await introspectEmiratesPostToken("", BASE), { ok: false, reason: "no token" });

  const bogus = await introspectEmiratesPostToken("not-a-real-token", BASE);
  check("bogus token is rejected", bogus.ok, false);
  check("  and says so plainly", (bogus as { reason: string }).reason, "rejected by Emirates Post");

  // Second call must come from cache — a rejection is remembered so a burst of
  // turns with a stale token does not hammer their service.
  const again = await introspectEmiratesPostToken("not-a-real-token", BASE);
  check("rejection is cached", (again as { reason: string }).reason, "rejected by Emirates Post (cached)");

  // An unreachable host must NOT be reported as a rejection: that would sign out
  // every valid holder during a network blip.
  const down = await introspectEmiratesPostToken("some-token", "https://127.0.0.1:9");
  check("unreachable host is not a rejection", down.ok, false);
  check("  and is distinguishable", /could not reach/.test((down as { reason: string }).reason), true);

  console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
  process.exit(failed ? 1 : 0);
}
main();
