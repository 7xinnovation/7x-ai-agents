/**
 * The price in the sentence must be the price on the card (28 Oct 2026).
 *
 * LR-54087 charged AED 1,000 — correctly, from advice P14235 — under a line
 * reading "Amount: AED 2,000 (licence fee AED 1,000 + online payment fee AED
 * 1,000)" and a button the applicant pressed saying "Pay with Card (AED
 * 2,000)". The surcharge is 1.x, and it was sitting in the 2.0 journey's own
 * guidance because the 1.x text was left below the 2.0 block.
 *
 * Checks the catalogue against EPGL's price list, the guidance rewrite, and
 * the stream guard that catches the claim whatever the guidance says.
 *
 * Run from apps/web:  npx tsx scripts/test-epgl-fees-2026-10-28.ts
 */
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { OLD_FEES, NEW_FEES, OLD_POINTER, rewrite } from "./epgl-2.0-fees-2026-10-28";
import { correctStatedTotals, proseTotalGuard } from "../lib/proseTotal";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => { console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : extra ?? ""); ok ? pass++ : fail++; };
const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(resolve(here, p), "utf8");

// ---- 1. the catalogue against EPGL's own price list ---------------------------
/** From "New Licenses_Catalogue.xlsx", the annual fees EPGL published. */
const PRICE_LIST: [string, number][] = [
  ["CEP30-UAE-SME-DOM", 1000], ["CEP30-UAE-SME-INTL", 2000],
  ["CEP30-NONUAE-SME-DOM", 5000], ["CEP30-NONUAE-SME-INTL", 10000],
  ["CEP30-GEN-DOM", 20000], ["CEP30-GEN-INTL", 40000],
  ["FOODMED", 500], ["INTERMED", 5000], ["LOCKERS", 1000], ["OUTSOURCE", 0],
];
const catalogue = JSON.parse(read(join("fixtures", "epgl-catalogue-2026-10-22.json"))) as {
  products?: { code?: string; fees?: { amount?: number; currency?: string; vatApplicable?: boolean }[] }[];
  parameters?: { onlinePaymentThresholdAed?: number };
};
const products = catalogue.products ?? [];
check("the catalogue still carries all ten products", products.length === 10, products.length);
for (const [code, expected] of PRICE_LIST) {
  const p = products.find((x) => x.code === code);
  const amount = (p?.fees ?? []).reduce((s, f) => s + (f.amount ?? 0), 0);
  check(`${code}: catalogue agrees with the price list (AED ${expected})`, !!p && amount === expected, amount);
}
check("OUTSOURCE carries no application fee at all", (products.find((p) => p.code === "OUTSOURCE")?.fees ?? []).length === 0);
check("no product charges VAT", products.every((p) => (p.fees ?? []).every((f) => f.vatApplicable === false)));
check("every fee is in dirhams", products.every((p) => (p.fees ?? []).every((f) => f.currency === "AED")));
check("no product carries a second fee line — there is nothing to add on",
  products.every((p) => (p.fees ?? []).length <= 1));
check("nothing in the catalogue mentions an online payment or gateway fee",
  !/online\s*payment\s*fee|gateway\s*fee|surcharge/i.test(read(join("fixtures", "epgl-catalogue-2026-10-22.json"))));
check("the online-payment ceiling is published, not guessed",
  catalogue.parameters?.onlinePaymentThresholdAed === 20000, catalogue.parameters);
check("...and exactly one product's fee is above it",
  PRICE_LIST.filter(([, a]) => a > (catalogue.parameters?.onlinePaymentThresholdAed ?? 0)).map(([c]) => c).join() === "CEP30-GEN-INTL");

// ---- 2. the guidance rewrite ---------------------------------------------------
check("every price on the list is stated in the new fee paragraph",
  PRICE_LIST.filter(([, a]) => a > 0).every(([code, a]) =>
    NEW_FEES.includes(`${code} AED ${a.toLocaleString("en-US")}`)), NEW_FEES.slice(0, 200));
check("...and OUTSOURCE is described rather than priced",
  /OUTSOURCE no application fee at all/.test(NEW_FEES) && /10% of revenue every six months/.test(NEW_FEES));
check("the new paragraph says nothing is added", /THERE IS ONE CHARGE AND NOTHING IS ADDED TO IT/.test(NEW_FEES));
check("...naming the two 1.x figures as belonging elsewhere",
  /AED 1,000 online payment fee and the AED 100,000 annual fee belong to the PREVIOUS licensing service/.test(NEW_FEES));
check("...and says VAT does not apply", /no VAT/.test(NEW_FEES));
check("the list is for recognising a wrong figure, not for quoting",
  /THESE FIGURES ARE FOR RECOGNISING A WRONG ONE, NOT FOR QUOTING/.test(NEW_FEES));
check("...and a disagreement is raised, not silently corrected",
  /do not correct it yourself and do not quote the list instead/.test(NEW_FEES));
check("a button may not carry an amount", /NEVER PUT AN AMOUNT IN A PAYMENT BUTTON/.test(NEW_FEES));
check("...with the run that caused it quoted", /Pay with Card \(AED 2,000\)/.test(NEW_FEES));

const before = `2.0 block...\n\n${OLD_POINTER}IF THE FEE CANNOT BE TAKEN...\n\n---\n\n${OLD_FEES}\n\nPARTNER DOCUMENTS — every partner...`;
const after = rewrite(before);
check("the 1.x fee paragraph is replaced", !after.includes(OLD_FEES) && after.includes("FEE STRUCTURE — NEW REGULATION"));
check("...and its 101,000 worked example is gone", !after.includes("AED 101,000"));
check("...and the surcharge sentence with it", !/online payment fee of AED 1,000/.test(after));
check("the paragraph that pointed at it is gone too", !after.includes(OLD_POINTER.trim()));
check("what sat after it survives", after.includes("PARTNER DOCUMENTS — every partner..."));
check("what sat before it survives", after.startsWith("2.0 block..."));
check("running it twice changes nothing", rewrite(after) === after);
check("a guidance that never had the paragraph fails loudly", (() => {
  try { rewrite("something else"); return false; } catch { return true; }
})());
check("the levy text goes with it — this journey has no Form 9",
  !/Form 9/.test(after) && !/levy of 10% on revenue/.test(after));

// ---- 3. the guard, which does not depend on any of the above ---------------------
const claim = "**Amount:** AED 2,000 (licence fee AED 1,000 + online payment fee AED 1,000)";
check("the labelled Amount line is corrected to what will be charged",
  correctStatedTotals(claim, 1000).startsWith("**Amount:** AED 1,000.00"), correctStatedTotals(claim, 1000));
check("a plain 'Amount: AED 2,000' is caught too",
  /AED 1,000\.00/.test(correctStatedTotals("Amount: AED 2,000", 1000)));
check("a correct figure is left exactly as written",
  correctStatedTotals("Amount: AED 1,000.00", 1000) === "Amount: AED 1,000.00");
check("a bare 'amount' in prose is NOT a trigger",
  correctStatedTotals("The sum insured is an amount of cover worth AED 500,000", 1000) ===
    "The sum insured is an amount of cover worth AED 500,000");
check("...nor is 'the amount they already paid'",
  correctStatedTotals("the amount they already paid was AED 2,000", 1000) ===
    "the amount they already paid was AED 2,000");
check("the older triggers still work", /AED 1,000\.00/.test(correctStatedTotals("Total: AED 2,000", 1000)));
check("a line item under its own name is untouched",
  correctStatedTotals("Licence fee AED 1,000 and nothing else", 1000) === "Licence fee AED 1,000 and nothing else");
check("the guard streams the correction, not just the whole string", (() => {
  const g = proseTotalGuard(() => 1000);
  let out = "";
  for (const chunk of ["**Amo", "unt:** AED 2,0", "00 (licence fee AED 1,000)"]) out += g.push(chunk);
  out += g.flush();
  return out.includes("AED 1,000.00") && !out.includes("AED 2,000");
})());
check("it does nothing when no figure is authoritative", (() => {
  const g = proseTotalGuard(() => null);
  return g.push("Amount: AED 2,000 ") + g.flush() === "Amount: AED 2,000 ";
})());

const route = read("../app/api/chat/route.ts");
check("the guard is armed with what Emirates Post invoiced",
  /epglInvoiced\.amount > 0 \? epglInvoiced\.amount : apiTools\.getLastHold\(\)/.test(route));
check("...recorded when the advice is raised", /epglInvoiced\.amount = res\.quote\.amount;/.test(route));
check("...and the rental hold still arms it when there is no invoice",
  /apiTools\.getLastHold\(\) \? authoritativeAmount\(\) : null/.test(route));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
