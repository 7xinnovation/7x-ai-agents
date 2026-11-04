/**
 * One file fills its catalogue twin (4 November 2026).
 *
 * Making the catalogue's conditional slots count toward readiness means the
 * trade licence is now asked for twice — once for our slot, which reads the
 * company off it, and once for EPGL's, which is the only one that reaches
 * their checklist. This pairs them at upload time.
 *
 * Run from apps/web:  npx tsx scripts/test-document-twins-2026-11-04.ts
 */
import { catalogueTwinOf, type TwinSlot } from "@/lib/documentTwins";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : `\n       ${JSON.stringify(got)}`}`); }
};

/** The real epgl-dialog-2 slots, trimmed to the ones that matter here. */
const SLOTS: TwinSlot[] = [
  { key: "trade_license", label: { en: "Trade Licence" }, requirement: "mandatory" },
  { key: "moa", label: { en: "Memorandum of Association" }, requirement: "optional", salesforceType: "Memorandum of Association" },
  { key: "partner_1_passport", label: { en: "Partner 1 passport" }, requirement: "mandatory", salesforceType: "Copy of Passport", condition: "partner_count >= 1" },
  { key: "partner_2_passport", label: { en: "Partner 2 passport" }, requirement: "mandatory", condition: "partner_count >= 2" },
  { key: "sme_licence_federal_or_local_government", label: { en: "SME Licence (federal or local government)" }, requirement: "conditional", condition: "product_is_sme", salesforceType: "SME Licence (federal or local government)" },
  { key: "trade_licence_initial_name_approval", label: { en: "Trade Licence / Initial Name Approval" }, requirement: "conditional", condition: "product_family == 'CEP30'", salesforceType: "Trade Licence / Initial Name Approval" },
  { key: "trade_licence", label: { en: "Trade Licence" }, requirement: "conditional", condition: "product_family != 'CEP30'", salesforceType: "Trade Licence" },
  { key: "principal_licensee_contract", label: { en: "Principal Licensee Contract" }, requirement: "conditional", condition: "product_family == 'OUTSOURCE'", salesforceType: "Principal Licensee Contract" },
];

const CEP30 = { product_family: "CEP30", product_is_sme: true, partner_count: 2 };
const LOCKERS = { product_family: "LOCKERS", product_is_sme: false, partner_count: 2 };
const none = (_k: string) => false;
const twin = (key: string, data: Record<string, unknown> = CEP30, filled: (k: string) => boolean = none) =>
  catalogueTwinOf(SLOTS, key, data, filled);

console.log("\nthe trade licence, which is why this exists");
check("on CEP30 it fills the initial-approval slot", twin("trade_license") === "trade_licence_initial_name_approval", twin("trade_license"));
check("on any other product it fills the plain trade-licence slot",
  twin("trade_license", LOCKERS) === "trade_licence", twin("trade_license", LOCKERS));
check("and it works the other way round too",
  twin("trade_licence_initial_name_approval") === "trade_license", twin("trade_licence_initial_name_approval"));
check("a twin already filled is not filled again",
  twin("trade_license", CEP30, (k) => k === "trade_licence_initial_name_approval") === null);

console.log("\nwhat must never be twinned");
check("one partner's passport never satisfies another's", twin("partner_1_passport") === null, twin("partner_1_passport"));
check("...in either direction", twin("partner_2_passport") === null, twin("partner_2_passport"));
check("the SME licence is not a trade licence",
  twin("sme_licence_federal_or_local_government") === null, twin("sme_licence_federal_or_local_government"));
check("a contract that merely says 'Licensee' is not a licence",
  twin("principal_licensee_contract", { product_family: "OUTSOURCE" }) === null);
check("a slot already carrying EPGL's name has no twin to find",
  twin("moa") === null, twin("moa"));

console.log("\nand the conditions are respected");
check("a twin whose condition does not hold is skipped",
  twin("trade_license", { product_family: "CEP30", partner_count: 1 }) === "trade_licence_initial_name_approval");
check("a LOCKERS application never reaches the CEP30 slot",
  twin("trade_license", LOCKERS) !== "trade_licence_initial_name_approval");
check("an unknown slot has no twin", twin("something_else") === null);
check("two live candidates would be ambiguous, so neither is chosen", (() => {
  const both = SLOTS.map((s) => (s.key === "trade_licence" ? { ...s, condition: undefined } : s));
  return catalogueTwinOf(both, "trade_license", CEP30, none) === null;
})());

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
