/**
 * A contract is not a licence (2026-11-02).
 *
 * The outsourcing pack could not be filed at all: "Principal Licensee Contract"
 * contains "Licensee", the slot gate handed it the trade-licence family, the
 * classifier had no name for a contract and said `other`, and the correct file
 * came back as "This file looks like a Unrecognised document". That is the
 * second time the same shape has bitten — the SME certificate was the first.
 *
 * Run from apps/web:  npx tsx scripts/test-document-slot-contracts-2026-11-02.ts
 */
import { acceptedDocTypes } from "@/lib/documentSlots";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : ` — ${JSON.stringify(got)}`}`); }
};

console.log("\nthe contracts EPGL 2.0 asks for");
const principal = acceptedDocTypes("principal_licensee_contract", "Principal Licensee Contract");
check("a Principal Licensee Contract is not gated as a licence", principal === null, principal);
const operator = acceptedDocTypes("operator_contracts_sample", "Operator Contracts (sample)");
check("nor are operator contracts", operator === null, operator);
const sites = acceptedDocTypes("locker_pudo_site_locations_and_contracts", "Locker / PUDO Site Locations and Contracts");
check("nor site locations and contracts", sites === null, sites);

console.log("\nand the licences still are");
check("a trade licence slot keeps its family",
  JSON.stringify(acceptedDocTypes("trade_licence", "Trade Licence")) === JSON.stringify(["trade_license", "initial_approval", "postal_license"]),
  acceptedDocTypes("trade_licence", "Trade Licence"));
check("the SME slot keeps its own type", acceptedDocTypes("sme_licence_federal_or_local_government", "SME Licence (federal or local government)")?.includes("sme_licence") === true);
check("a passport slot still means a passport", JSON.stringify(acceptedDocTypes("partner_2_passport", "Partner 2 — passport copy")) === JSON.stringify(["passport"]));
check("a lease keeps whatever it had — a contract in name, a lease in fact",
  acceptedDocTypes("lease_contract", "Lease Contract / Ejari") === null || Array.isArray(acceptedDocTypes("lease_contract", "Lease Contract / Ejari")));

console.log("\nthe Arabic labels an Arabic session shows");
check("عقد المرخص له الرئيسي is not a licence either", acceptedDocTypes("principal_licensee_contract", "عقد المرخص له الرئيسي") === null,
  acceptedDocTypes("principal_licensee_contract", "عقد المرخص له الرئيسي"));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
