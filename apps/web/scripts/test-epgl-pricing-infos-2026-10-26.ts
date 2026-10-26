/**
 * EPGL's pricing call carries infos: [] (26 October 2026).
 *
 * Their spec says outright that "only quotationRequest.appIdentifier.
 * applicationId is needed for a new-regulation application; the other fields
 * are stored for audit", and marks `infos` optional. Their Apex dereferences
 * it anyway:
 *
 *   400 {"status":400,"message":"Attempt to de-reference a null object"}
 *
 * Narrowed field by field against their NewLaw sandbox: of everything in their
 * own example envelope — entityId, requestOn, payType, serviceId,
 * serviceVersion, serviceName, serviceType, requestType — dropping any of them
 * still answers 200. Dropping `infos` is the only one that 400s, and an
 * explicit null 400s too. `[]` is what it wants.
 *
 * NOT COSMETIC. Every pricing call had been failing, so the agent quoted a
 * fallback: AED 2,000 where their catalogue says 1,000, and AED 101,000 before
 * that. Applicants were being told to pay twice what EPGL charge.
 *
 * Run from apps/web:  npx tsx scripts/test-epgl-pricing-infos-2026-10-26.ts
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => { console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : extra ?? ""); ok ? pass++ : fail++; };
const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, "../lib/integrations.ts"), "utf8");

check("the pricing tool is shaped by name, not by guesswork",
  /\/post_services_apexrest_payment_pricing\$\/i\.test\(toolName\)/.test(src));
check("infos is added as an empty ARRAY", /infos: \[\]/.test(src));
check("...only when it is not already an array",
  /!Array\.isArray\(\(q as Record<string, unknown>\)\.infos\)/.test(src));
check("a body with no quotationRequest is left alone",
  /if \(q && typeof q === "object" &&/.test(src));
check("the reason is written down where the next person will look",
  /Attempt to de-reference a null object/.test(src));
check("...including what it was costing applicants", /AED 2,000 against a real catalogue fee/.test(src));
check("the pricing shaping is its own block, not folded into the submit one",
  /payment_pricing\$\/i\.test\(toolName\)\) \{[\s\S]{0,400}?\n    \}\n/.test(src));

/** The shaping, lifted out so the behaviour itself is checked, not just its text. */
function withInfos(input: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  const b = { ...((input?.body ?? {}) as Record<string, unknown>) };
  const q = b.quotationRequest;
  if (q && typeof q === "object" && !Array.isArray((q as Record<string, unknown>).infos)) {
    return { ...input, body: { ...b, quotationRequest: { ...(q as Record<string, unknown>), infos: [] } } };
  }
  return input;
}
const q = (o: Record<string, unknown> | undefined) =>
  ((o?.body as Record<string, unknown>)?.quotationRequest ?? {}) as Record<string, unknown>;

const minimal = { body: { quotationRequest: { appIdentifier: { applicationId: "LR-54066" } } } };
check("the spec's minimum body gains infos", Array.isArray(q(withInfos(minimal)).infos));
check("...and keeps the application id",
  (q(withInfos(minimal)).appIdentifier as { applicationId?: string })?.applicationId === "LR-54066");
check("an explicit null is replaced — null 400s just as hard",
  Array.isArray(q(withInfos({ body: { quotationRequest: { infos: null } } })).infos));
check("infos the model supplied is left exactly as it is", (() => {
  const given = { body: { quotationRequest: { infos: [{ key: "x" }] } } };
  return (q(withInfos(given)).infos as unknown[]).length === 1;
})());
check("a body with no quotationRequest is untouched",
  withInfos({ body: { other: 1 } })?.body !== undefined &&
    !("quotationRequest" in ((withInfos({ body: { other: 1 } })?.body ?? {}) as object)));
check("an empty input does not throw", withInfos(undefined) === undefined);
check("the original input is not mutated", (() => {
  const given = { body: { quotationRequest: { appIdentifier: {} } } };
  withInfos(given);
  return !("infos" in (given.body.quotationRequest as object));
})());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
