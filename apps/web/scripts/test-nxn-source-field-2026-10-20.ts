/**
 * The source we stamp has to be a field Emirates Post actually declares, with a
 * value their enum actually contains.
 *
 * Found 20 October while answering "does a rental look like it came from the
 * website?". It did. The generic stamp wrote `Source: "ChatBot"` on every write
 * to their host — but their save schemas declare `requestSource`, carry no
 * top-level `Source`, and are additionalProperties:false, so the field was not
 * an extra, it was invalid and went nowhere. The renewals were fine: they set
 * `requestSource` explicitly. Rentals were indistinguishable from the website.
 *
 * This reads their live swagger, so it fails the day they rename the field or
 * drop our enum value rather than the day a customer is miscounted.
 *
 *   npx tsx scripts/test-nxn-source-field-2026-10-20.ts            (live)
 *   npx tsx scripts/test-nxn-source-field-2026-10-20.ts --offline  (source only)
 */
import { readFileSync } from "node:fs";

const SPEC = "https://box.emiratespost.ae/services/pobox/swagger/v1/swagger.json";
/** The saves that carry a transaction, and therefore have to name us. */
const TRANSACTIONS = [
  "SavePoBoxRequest", "SaveRenewalRequest", "SaveTijariRequest",
  "SaveAgentRequest", "ProcessPaymentRequest", "SaveChangeAddressRequest",
];

let passed = 0, failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) passed++; else failed++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok || detail === undefined ? "" : " — " + JSON.stringify(detail)}`);
}

const src = readFileSync(new URL("../lib/integrations.ts", import.meta.url), "utf8");
const VALUE = src.match(/const REQUEST_SOURCE = process\.env\.NXN_REQUEST_SOURCE \|\| "([^"]+)"/)?.[1] ?? "";

console.log("\nWhat our code does");
check("the field name comes from the operation's own body schema", /function sourceFieldOf\(/.test(src) && /\/\^\(request\)\?source\$\/i\.test\(n\)/.test(src));
check("an operation that declares none is not stamped", /if \(field && b && typeof b === "object"/.test(src));
check("the value is read from one constant", Boolean(VALUE), VALUE);

if (process.argv.includes("--offline")) {
  console.log("\n(offline: their spec not checked)");
} else {
  console.log(`\nTheir live spec — ${SPEC}`);
  const res = await fetch(SPEC, { signal: AbortSignal.timeout(25000) });
  check("the spec is reachable", res.ok, res.status);
  const doc = (await res.json()) as { components: { schemas: Record<string, any> } };
  const schemas = doc.components.schemas;

  const sourceEnum: string[] = schemas.Source?.enum ?? [];
  check("Source is still an enum", sourceEnum.length > 0, sourceEnum);
  check(`...and still contains ${VALUE}`, sourceEnum.includes(VALUE), sourceEnum);

  for (const name of TRANSACTIONS) {
    const sc = schemas[name];
    if (!sc) { check(`${name} exists`, false); continue; }
    const props: Record<string, any> = sc.properties ?? {};
    const field = Object.keys(props).find((k) => /^(request)?source$/i.test(k));
    check(`${name} declares one source field (${field ?? "none"})`, Boolean(field));
    // The reason the old stamp was dropped rather than merely ignored.
    if (sc.additionalProperties === false) {
      check(`...and rejects anything else, so the name must be exact`, !("Source" in props));
    }
  }
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
