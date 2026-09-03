/**
 * Numeric conditions, for per-partner documents (2026-09-03).
 *
 * The licensing team's rule: every partner's passport and Emirates ID must be
 * uploaded, and the number of partners comes off the trade licence or initial
 * approval. The document matrix is declarative, so the requirement has to be
 * expressible as a condition -- "partners >= 2" makes the second partner's
 * documents appear when there is a second partner.
 *
 * The grammar previously did string equality only, so a count could not be
 * compared at all.
 *
 * Run from apps/web:
 *   npx tsx scripts/test-conditions-2026-09-03.ts
 */
import { evalCondition } from "@dialog/core";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => {
  console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : extra ?? "");
  ok ? pass++ : fail++;
};

// 1. What the partner documents actually use.
{
  const three = { partner_count: 3 };
  check("partner 2 required when there are 3", evalCondition("partner_count >= 2", three));
  check("partner 3 required when there are 3", evalCondition("partner_count >= 3", three));
  check("partner 4 NOT required when there are 3", !evalCondition("partner_count >= 4", three));
  check("a sole owner needs no second partner", !evalCondition("partner_count >= 2", { partner_count: 1 }));
}

// 2. A repeating group counts as its length, so the count and the rows cannot
//    drift apart.
{
  const partners = { partners: [{ name: "A" }, { name: "B" }] };
  check("two rows means partner 2 is required", evalCondition("partners >= 2", partners));
  check("...and partner 3 is not", !evalCondition("partners >= 3", partners));
  check("an empty group requires nothing", !evalCondition("partners >= 1", { partners: [] }));
}

// 3. The one that matters most: an UNKNOWN count must not read as zero.
//    Zero would quietly drop every per-partner document the moment extraction
//    failed to find a number, and the application would look complete with
//    nothing uploaded.
{
  check("missing is not zero", !evalCondition("partner_count >= 1", {}));
  check("null is not zero", !evalCondition("partner_count >= 1", { partner_count: null }));
  check("empty string is not zero", !evalCondition("partner_count >= 1", { partner_count: "" }));
  check("unreadable text is not zero", !evalCondition("partner_count >= 1", { partner_count: "several" }));
  // And the inverse: "fewer than 2" must not be TRUE just because we do not know.
  check("an unknown count is not 'fewer than 2' either", !evalCondition("partner_count < 2", {}));
}

// 4. Numbers arriving as strings, which is what extraction returns.
{
  check("'3' compares as 3", evalCondition("partner_count >= 3", { partner_count: "3" }));
  check("' 3 ' still compares as 3", evalCondition("partner_count >= 3", { partner_count: " 3 " }));
  check("'0' is a real zero", !evalCondition("partner_count >= 1", { partner_count: "0" }));
}

// 5. Every operator.
{
  const d = { n: 5 };
  check(">= boundary", evalCondition("n >= 5", d));
  check("<= boundary", evalCondition("n <= 5", d));
  check("> strict", !evalCondition("n > 5", d));
  check("< strict", !evalCondition("n < 5", d));
  check("numeric ==", evalCondition("n == 5", d));
  check("numeric !=", evalCondition("n != 4", d));
}

// 6. Nothing that worked before may have changed.
{
  check("string equality", evalCondition("license_type == 'courier'", { license_type: "courier" }));
  check("string inequality", evalCondition("license_type != 'courier'", { license_type: "postal" }));
  check("truthiness", evalCondition("has_moa", { has_moa: true }));
  check("falsy", !evalCondition("has_moa", { has_moa: false }));
  check("no condition is always true", evalCondition(undefined, {}));
  // A quoted number stays a STRING comparison -- '5' and 5 are not the same rule.
  check("quoted values are still string-compared", evalCondition("n == '5'", { n: 5 }));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
