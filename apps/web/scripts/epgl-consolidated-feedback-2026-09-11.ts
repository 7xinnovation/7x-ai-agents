/**
 * "Agentic AI Testing Feedback — Consolidated 11 Sept", the parts that are text.
 *
 * Taken item by item. What is NOT here, and why, is as much of the answer as
 * what is:
 *
 *  - SAVE AND RESUME is a feature, not a wording change. A case already
 *    survives a page reload on the same browser; resuming from another device,
 *    or a week later, needs the applicant to be identifiable, which means the
 *    sign-in question below. Flagged, not guessed at.
 *  - PAY-THEN-REVIEW FOR RENEWALS, REVIEW-THEN-PAY FOR NEW LICENCES reverses
 *    the order the whole submission is built around and contradicts the
 *    "Payment Process with Agentic" map we built from. It is also the question
 *    still open with Salesforce since 9 September, and the reason Amount (Paid)
 *    reads 0.00. Not changed on a line in a feedback document.
 *  - WEBSITE REQUIREMENTS ALIGNMENT needs the website's list beside ours.
 *  - LAPTOP VS PHONE UPLOADS: one-at-a-time in chat is FB-1565, EPGL's own
 *    request from 10 August. Reversing it needs them to say which they want.
 *  - THE DUPLICATE-APPLICATION LOOP needs reproducing before it is touched.
 *
 * The fee: AED 150,000, not 100,000. Confirmed as current on 11 September.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/epgl-consolidated-feedback-2026-09-11.ts --env <file> [--apply]
 */
import { databaseUrlFrom } from "./lib/envFile";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const ENV = arg("--env");
const APPLY = process.argv.includes("--apply");
if (!ENV) throw new Error("--env <envfile> is required");

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { agents } from "@dialog/db";
import { eq } from "drizzle-orm";

const SLUG = "epgl-dialog";
const L = (en: string, ar: string) => ({ en, ar });

/* ── straight substitutions, applied to every journey's guidance ─────────── */

const GUIDANCE_EDITS: [string, string][] = [
  // The fee. Six knowledge-base answers and both journeys carried 100,000.
  ["An annual licensing fee of AED 100,000", "An annual licensing fee of AED 150,000"],
  // The SLA, in EPGL's own words: one business day is eight working hours.
  [
    "typically within ONE business day — in Arabic: خلال يوم عمل واحد",
    "typically within ONE business day (8 working hours) — in Arabic: خلال يوم عمل واحد (8 ساعات عمل)",
  ],
  [
    "typically within ONE business day (in Arabic: خلال يوم عمل واحد)",
    "typically within ONE business day (8 working hours) (in Arabic: خلال يوم عمل واحد (8 ساعات عمل))",
  ],
];

/* ── whole rules appended once ───────────────────────────────────────────── */

const PAYMENT_ORDER_RULE =
  "OFFER THE CARD FIRST (2026-09-11): both payment options are live, and they are not equivalent — a card payment has the licence issued the SAME DAY and a Virtual IBAN transfer has it issued the next business day. So present CARD FIRST, as the recommended option, saying plainly that it is the one that gets the licence issued today, and offer the Virtual IBAN second as the alternative. Both must always be offered and the customer's choice is theirs; recommending is not deciding for them, and never imply the transfer is unavailable, slower to set up, or in any way a lesser route. " +
  "AND SAY WHERE THE IBAN WILL APPEAR: a customer who picks the transfer is told, in the same message that confirms the submission, that their Virtual IBAN will be added to their workspace (and emailed to them by EPGL Finance), so they know where to look for it and are not waiting on an email alone. ";

const IDENTITY_PRIVACY_RULE =
  "IDENTITY NUMBERS ARE NOT REPEATED IN FULL (2026-09-11): an Emirates ID or passport number read off a document is confirmed by its LAST FOUR characters and never written out in full in the chat — \"the Emirates ID ending 131-4\", not the whole card number. The panel masks them the same way. The value itself is held on the application and goes to EPGL complete; this is about what sits on a screen in an office. If the customer types one themselves, do not echo it back. ";

const NON_RESIDENT_NUMBER_RULE =
  "AND NOT THE NUMBER EITHER (2026-09-11): a partner recorded as 'Non Resident' is asked for neither the Emirates ID DOCUMENT nor the Emirates ID NUMBER. Leave partner_N_emirates_id empty, do not ask for it, do not describe the application as incomplete without it, and omit EPG_Emirates_ID__c from that partner in the submission rather than sending it empty. The same applies to the OWNER when the owner is the non-resident partner: owner_emirates_id is left empty and their passport carries the identification. ";

const ASK_A_QUESTION_RULE =
  "ASK-A-QUESTION DOES NOT START AN APPLICATION (2026-09-11): when a customer arrives through \"Ask a question\" and then says something like \"applying for a new licence\" or \"renewal\", they are naming a TOPIC, not starting one. Do not open the journey, do not ask for their name and email, and do not put an upload control in front of them. Ask what they would like to know about it first — a short ```buttons block: what documents are needed, what the steps are, how long it takes, what it costs — answer that, and then offer to start the application as a separate, explicit choice (\"Shall I start the application now?\"). A customer who came to ask a question and finds themselves three fields into a form has been ambushed. If they say outright \"I want to apply\" or press the opening \"Apply for Postal Activity License\" button, that IS the journey and it starts as normal. ";

const RENEWAL_CHECKBOX_RULE =
  "THE RENEWAL'S THREE ACKNOWLEDGMENTS (2026-09-11): a renewal requires THREE separate acknowledgments, not one combined tick. EPGL reported seeing one where three were expected. The checkbox block at the end of a renewal carries FOUR lines — the Declaration & Undertaking, and then these three, each its own line and each ticked separately:\n" +
  "- terms_accepted: EPGL's postal licensing terms and conditions\n" +
  "- commitment_form_accepted: the approved commitment form\n" +
  "- idep_integration_accepted: the mandatory integration with IDEP\n" +
  "Each is recorded with its own date and time, and each maps to its own field on the licence request (EPG_Terms_and_Conditions__c, Approved_Commitment_Form__c, Mandatory_integration_with_IDEP__c). Do not merge them back into one line, do not set one from another, and do not submit while any of the three is unticked — a customer who ticked one box has agreed to one thing. ";

const SIGNIN_RULE =
  "SIGNING IN IS OPTIONAL HERE, AND YOU DO NOT ASK FOR IT (2026-09-11): EPGL asked us to clarify the login requirement, so it was measured on staging. Neither of these journeys requires authentication — not the intent, not any step, and not the submission, which for a licence application goes through signed in or not. The only thing that genuinely needs a sign-in is CHECKING THE STATUS of an existing application, because that reads someone's records back to them. " +
  "What the applicant saw instead was a sign-in prompt on the first turn of a new licence about half the time, because request_authentication was being called on judgement. So: NEVER call request_authentication during a new licence or a renewal. Mention signing in ONCE, in the opening message, as the plain benefit it is — it links the application to their account so they can track it afterwards — and then carry on regardless of what they do about it. If they ASK to sign in, or ask to check a status, that is when the prompt is surfaced. An optional step offered as a gate is a gate. ";

const LEASE_RULE =
  "THE LEASE CONTRACT (2026-09-11): EPGL check the licensed premises, so the company's lease contract (Ejari or the emirate's equivalent) now has a slot. It is OPTIONAL for now, deliberately: it appears in EPGL's published requirements but making it mandatory mid-UAT would block applications that are otherwise complete. Offer it once, at the end of the document collection, as a document that helps EPGL verify the address — do not chase it, and never describe the application as incomplete without it. ";

const INITIAL_APPROVAL_RULE =
  "A LICENCE NUMBER OR AN APPROVAL NUMBER, NOT BOTH (2026-09-11): a company whose trade licence has not been issued yet has an INITIAL APPROVAL number and no trade licence number, and the readiness list used to ask for the trade licence number regardless — a requirement that applicant could never meet. The trade licence number is now required only while initial_approval_number is empty. So: read whichever the document carries into its own field, never put one in the other's, and if the customer has only an initial approval say plainly that the trade licence number is not needed until the licence is issued. ";

/* ── documents and fields ────────────────────────────────────────────────── */

const LEASE_DOC = {
  key: "lease_contract",
  label: L("Lease contract (Ejari or equivalent)", "عقد الإيجار (إيجاري أو ما يعادله)"),
  description: L(
    "The tenancy contract for the licensed premises, used to verify the address.",
    "عقد إيجار مقر الشركة المرخّص، ويُستخدم للتحقق من العنوان."
  ),
  requirement: "optional",
  acceptedFormats: ["pdf", "png", "jpg"],
  maxSizeMb: 10,
};

const RENEWAL_CHECKBOXES = [
  {
    key: "commitment_form_accepted",
    type: "boolean",
    label: L("Approved commitment form accepted", "الموافقة على نموذج التعهد المعتمد"),
    editable: false,
    validation: { required: true },
  },
  {
    key: "commitment_form_accepted_at",
    type: "text",
    label: L("Commitment form accepted at (date & time, UTC)", "تاريخ ووقت قبول نموذج التعهد (UTC)"),
    editable: false,
    validation: { required: false },
  },
  {
    key: "idep_integration_accepted",
    type: "boolean",
    label: L("Mandatory IDEP integration accepted", "الموافقة على التكامل الإلزامي مع IDEP"),
    editable: false,
    validation: { required: true },
  },
  {
    key: "idep_integration_accepted_at",
    type: "text",
    label: L("IDEP integration accepted at (date & time, UTC)", "تاريخ ووقت قبول التكامل مع IDEP (UTC)"),
    editable: false,
    validation: { required: false },
  },
];

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrlFrom(ENV!) });
  const db = drizzle(pool, { schema: { agents } });
  const changes: string[] = [];
  try {
    const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG));
    if (!row) throw new Error(`${SLUG} not found in this database`);
    const def = JSON.parse(JSON.stringify(row.definition)) as Record<string, any>;

    // The persona still called it a courier licence, which is where the
    // "Ask a question" welcome gets its wording.
    const personaEdits: [string, string][] = [
      ["apply for and renew courier licenses with Emirates Post Group Licensing (EPGL)", "apply for and renew Postal Activity Licenses with Emirates Post Group Licensing (EPGL)"],
    ];
    let persona = String(def.persona ?? "");
    for (const [from, to] of personaEdits) if (persona.includes(from)) { persona = persona.split(from).join(to); changes.push("persona: postal activity licence, not courier licence"); }
    if (!persona.includes("ASK-A-QUESTION DOES NOT START AN APPLICATION")) {
      persona = `${persona.trimEnd()}\n\n${ASK_A_QUESTION_RULE.trim()}`;
      changes.push("persona: a question is not an application");
    }
    def.persona = persona;

    for (const j of def.journeys ?? []) {
      let g = String(j.guidance ?? "");
      for (const [from, to] of GUIDANCE_EDITS) {
        if (g.includes(from)) { g = g.split(from).join(to); changes.push(`${j.key}: ${from.slice(0, 48)}…`); }
      }
      const rules: [string, string][] = [
        ["card first, and where the IBAN appears", PAYMENT_ORDER_RULE],
        ["identity numbers are not repeated", IDENTITY_PRIVACY_RULE],
        ["non-resident: not the number either", NON_RESIDENT_NUMBER_RULE],
        ["signing in is optional and not asked for", SIGNIN_RULE],
        ...(j.key === "new_license"
          ? ([["the lease contract", LEASE_RULE], ["a licence number or an approval number", INITIAL_APPROVAL_RULE]] as [string, string][])
          : ([["the renewal's three acknowledgments", RENEWAL_CHECKBOX_RULE]] as [string, string][])),
      ];
      for (const [label, rule] of rules) {
        if (!g.includes(rule.trim())) { g = `${g.trimEnd()}\n\n${rule.trim()}`; changes.push(`${j.key}: ${label}`); }
      }
      j.guidance = g;

      for (const step of j.steps ?? []) {
        // The MOA is optional now. The sole-establishment condition stays: for a
        // company that was never issued one the slot should not appear at all,
        // which is a different thing from "you may skip it".
        for (const doc of step.documents ?? []) {
          if (doc.key === "moa" && doc.requirement !== "optional") {
            doc.requirement = "optional";
            changes.push(`${j.key}: MOA is optional`);
          }
        }
        // The lease contract, once per journey, at the end of the document step.
        if (step.key === "documents" && !(step.documents ?? []).some((d: any) => d.key === "lease_contract")) {
          step.documents.push(JSON.parse(JSON.stringify(LEASE_DOC)));
          changes.push(`${j.key}: + lease contract (optional)`);
        }
        // Required only while there is no initial approval number.
        for (const f of step.fields ?? []) {
          if (f.key === "trade_license_number" && j.key === "new_license" && f.condition !== "initial_approval_number == ''") {
            f.condition = "initial_approval_number == ''";
            changes.push(`${j.key}: trade licence number required only without an initial approval`);
          }
        }
        // The renewal's other two acknowledgments, beside the one that exists.
        if (j.key === "renewal" && step.key === "finance") {
          const have = new Set(step.fields.map((f: any) => f.key));
          const missing = RENEWAL_CHECKBOXES.filter((f) => !have.has(f.key));
          if (missing.length) {
            const at = step.fields.findIndex((f: any) => f.key === "terms_accepted_at");
            if (at === -1) throw new Error("renewal/finance: terms_accepted_at anchor is gone");
            step.fields.splice(at + 1, 0, ...JSON.parse(JSON.stringify(missing)));
            changes.push(`renewal: +${missing.length} acknowledgment field(s)`);
          }
        }
      }

      // The terms checkbox line, split into three.
      const OLD_LINE =
        "For renewal, the same checkbox block must carry a SECOND line `- terms_accepted: <'I accept the terms and conditions and the mandatory IDEP integration' in the session language>` so both acknowledgments are captured together (both are recorded with date and time).";
      const NEW_LINE =
        "For renewal, the same checkbox block must carry THREE MORE lines after the declaration, each ticked separately: `- terms_accepted: <'I accept EPGL's postal licensing terms and conditions' in the session language>`, `- commitment_form_accepted: <'I accept the approved commitment form' in the session language>` and `- idep_integration_accepted: <'I accept the mandatory integration with IDEP' in the session language>`. All four acknowledgments are captured together and each is recorded with its own date and time.";
      if (j.key === "renewal" && j.guidance.includes(OLD_LINE)) {
        j.guidance = j.guidance.split(OLD_LINE).join(NEW_LINE);
        changes.push("renewal: the checkbox block carries three acknowledgments");
      }

      // The three flags are sent from three fields now, not one.
      const notes = String(j.submission?.apiFlow?.notes ?? "");
      const extra =
        " ACKNOWLEDGMENTS (2026-09-11): EPG_Terms_and_Conditions__c, Approved_Commitment_Form__c and Mandatory_integration_with_IDEP__c are set from terms_accepted, commitment_form_accepted and idep_integration_accepted RESPECTIVELY — three separate customer acknowledgments, never one copied into three fields.";
      if (j.key === "renewal" && notes && !notes.includes("ACKNOWLEDGMENTS (2026-09-11)")) {
        j.submission.apiFlow.notes = notes.trimEnd() + extra;
        changes.push("renewal: apiFlow notes — three acknowledgments, three fields");
      }
    }

    if (!changes.length) { console.log("nothing to do — already applied."); return; }
    console.log(`${changes.length} change(s):`);
    for (const c of changes) console.log(`   ~ ${c}`);
    if (APPLY) {
      await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
      console.log("\nwritten.");
    } else console.log("\nDry run — nothing written. Add --apply to write.");
  } finally {
    await pool.end();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
