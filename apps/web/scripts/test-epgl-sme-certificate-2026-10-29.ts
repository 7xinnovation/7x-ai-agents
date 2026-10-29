/**
 * The SME certificate (29 October 2026).
 *
 * EPGL's four SME products ask for an "SME Licence (federal or local
 * government)", and the classifier had no name for it. That is not the quiet
 * failure the lease and the insurance certificate were -- the readiness guard
 * of 28 October already holds any undated `validityRequired` slot outstanding,
 * so nothing was being dropped in silence. It is a louder one: the slot's own
 * type gate matched on the word "licence" and handed the slot the
 * trade-licence family, so the only file that satisfies the slot was also the
 * file it refused.
 *
 * These checks pin the three things that fixes it -- the taxonomy has a name,
 * the gate tests for it BEFORE the generic licence test, and a certificate
 * whose validity has run out is refused rather than sent -- and the two
 * neighbours a careless edit would break: the trade-licence slot must keep
 * taking an initial approval, and must stop taking an SME certificate.
 *
 * Run from apps/web:  npx tsx scripts/test-epgl-sme-certificate-2026-10-29.ts
 */
import { acceptedDocTypes, expiredForSlot } from "@/lib/documentSlots";
import { DOC_TYPES, DOC_TYPE_LABELS, type DocType } from "@dialog/core";
import { recomputeReadiness } from "@dialog/core";
import type { AgentDefinition, CaseState } from "@dialog/config";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => {
  console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : (extra ?? ""));
  ok ? pass++ : fail++;
};

/**
 * The slot exactly as the generator makes it: the key is EPGL's English name
 * slugged, which is what the gate is matched on in every locale.
 */
const SME_KEY = "SME Licence (federal or local government)"
  .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const SME_LABEL = "SME Licence (federal or local government)";
const SME_LABEL_AR = "رخصة المنشآت الصغيرة والمتوسطة (اتحادية أو محلية)";

// ---- the taxonomy has a name for it ------------------------------------------
check("sme_licence is in the classification taxonomy",
  (DOC_TYPES as readonly string[]).includes("sme_licence"), DOC_TYPES);
check("and it has a label in both languages, for the refusal text",
  Boolean(DOC_TYPE_LABELS.sme_licence?.en && DOC_TYPE_LABELS.sme_licence?.ar),
  DOC_TYPE_LABELS.sme_licence);
check("every type in the taxonomy has a label — the rejection reason indexes it blind",
  (DOC_TYPES as readonly DocType[]).every((t) => Boolean(DOC_TYPE_LABELS[t]?.en)));

// ---- the generator's key is the one the gate sees ----------------------------
check("the generated slot key is what this test assumes",
  SME_KEY === "sme_licence_federal_or_local_government", SME_KEY);

// ---- the gate claims the slot for the right family ---------------------------
const sme = acceptedDocTypes(SME_KEY, SME_LABEL);
check("the SME slot accepts an SME licence", sme?.includes("sme_licence") === true, sme);
check("and accepts NOTHING else — one slot, one document", sme?.length === 1, sme);
/**
 * The failure this was all about. The gate ran `/trade|postal|licen[cs]e/`
 * first, so the slot was handed the trade-licence family: a correctly
 * classified SME certificate came back "This file looks like an Unrecognised
 * document, not the requested SME Licence" and there was no file that worked.
 */
check("a real trade licence does NOT satisfy the SME slot",
  sme?.includes("trade_license") === false, sme);
check("the Arabic label reaches the same answer",
  JSON.stringify(acceptedDocTypes(SME_KEY, SME_LABEL_AR)) === JSON.stringify(sme),
  acceptedDocTypes(SME_KEY, SME_LABEL_AR));
check("and so does the label alone, for a slot whose key is hand-named",
  acceptedDocTypes("sme_certificate", "SME licence")?.includes("sme_licence") === true);

// ---- and the neighbours it sits between --------------------------------------
const trade = acceptedDocTypes("trade_license", "Trade Licence");
check("the trade licence slot still takes a trade licence", trade?.includes("trade_license") === true, trade);
check("and still takes an initial approval — the pre-incorporation path",
  trade?.includes("initial_approval") === true, trade);
check("but an SME certificate no longer satisfies it",
  trade?.includes("sme_licence") === false, trade);
const combined = acceptedDocTypes("trade_licence_initial_name_approval", "Trade Licence / Initial Name Approval");
check("the CEP30 combined slot is untouched",
  combined?.includes("trade_license") === true && combined?.includes("initial_approval") === true, combined);
check("an Emirates ID slot is still claimed before anything else",
  JSON.stringify(acceptedDocTypes("partner_1_emirates_id", "Copy of Emirates ID")) === JSON.stringify(["emirates_id"]));
check("a passport slot too", JSON.stringify(acceptedDocTypes("partner_1_passport", "Copy of Passport")) === JSON.stringify(["passport"]));
check("a Form 9 slot is not caught by the new test", JSON.stringify(acceptedDocTypes("form_9", "Form 9")) === JSON.stringify(["form_9"]));
check("a slot naming no family is still ungated", acceptedDocTypes("vehicle_inventory", "Vehicle list") === null);
/**
 * `\bsme\b` does not match `sme_licence_...` — an underscore is a word
 * character — which is why the rule is written the long way. If somebody
 * "tidies" it to \b the slot silently falls back to the trade-licence family
 * and we are back where we started, so the shape is pinned here.
 */
check("the word test survives the underscore in the generated key",
  acceptedDocTypes("sme_licence_federal_or_local_government", "")?.includes("sme_licence") === true);
check("and does not fire on a word that merely contains those letters",
  acceptedDocTypes("business_smes_x", "Businessmen register")?.includes("sme_licence") !== true,
  acceptedDocTypes("business_smes_x", "Businessmen register"));

// ---- a certificate that has run out is refused, not sent ---------------------
const TODAY = "2026-10-29";
check("an SME certificate that expired yesterday is refused",
  expiredForSlot({ validityRequired: true, expiry: "2026-10-28", today: TODAY }) === "2026-10-28");
check("one expiring today is still good — a licence is valid through its last day",
  expiredForSlot({ validityRequired: true, expiry: TODAY, today: TODAY }) === null);
check("one expiring tomorrow is good", expiredForSlot({ validityRequired: true, expiry: "2026-10-30", today: TODAY }) === null);
/**
 * Scoped to validityRequired on purpose: those are the slots EPGL refuse
 * without a date, which is the same as saying they are the slots where the
 * date is load-bearing. A slot that owes no date is not refused for being old.
 */
check("a slot that owes EPGL no date is not refused for an old expiry",
  expiredForSlot({ validityRequired: false, expiry: "2020-01-01", today: TODAY }) === null);
check("nor is one where validityRequired is simply absent",
  expiredForSlot({ expiry: "2020-01-01", today: TODAY }) === null);
check("no expiry read off the file means no refusal — the customer is asked instead",
  expiredForSlot({ validityRequired: true, today: TODAY }) === null);
check("a half-read date is not evidence of anything",
  expiredForSlot({ validityRequired: true, expiry: "2026-10", today: TODAY }) === null);
check("nor is a date in the wrong format",
  expiredForSlot({ validityRequired: true, expiry: "28/10/2026", today: TODAY }) === null);
check("an empty string is not a date either",
  expiredForSlot({ validityRequired: true, expiry: "", today: TODAY }) === null);

// ---- and an undated one is still OUTSTANDING, through the real engine --------
/**
 * The 28 October guard, re-driven here because the SME slot depends on it:
 * when the certificate prints a range the extractor cannot read, the slot must
 * stay owed so the customer is asked for the date rather than the file.
 */
const agent = {
  journeys: [
    {
      key: "new_license",
      steps: [
        {
          key: "declarations",
          fields: [],
          documents: [
            { key: SME_KEY, label: { en: SME_LABEL }, requirement: "mandatory", salesforceType: SME_LABEL, validityRequired: true, acceptedFormats: ["pdf"], maxSizeMb: 10 },
          ],
        },
      ],
    },
  ],
} as unknown as AgentDefinition;

const withDoc = (validTo?: string): CaseState =>
  recomputeReadiness(agent, {
    journeyKey: "new_license",
    data: {},
    documents: [{ key: SME_KEY, status: "uploaded", fileName: "sme.pdf", ...(validTo ? { validTo } : {}) }],
    readiness: { complete: false, missing: [] },
  } as unknown as CaseState);

const undated = withDoc();
check("an uploaded SME certificate with no readable date is still OUTSTANDING",
  undated.readiness.missing.some((m) => m.key === SME_KEY), undated.readiness.missing);
check("so the application cannot read as complete", undated.readiness.complete === false);
const dated = withDoc("2030-01-01");
check("and once the date is on it the slot is satisfied",
  !dated.readiness.missing.some((m) => m.key === SME_KEY), dated.readiness.missing);
check("which completes the application", dated.readiness.complete === true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
