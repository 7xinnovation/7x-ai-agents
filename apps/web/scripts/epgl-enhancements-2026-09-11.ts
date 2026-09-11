/**
 * EPGL's 11 September enhancements, all eight of them.
 *
 * The four that are wording, and the four that are not:
 *
 *  1. ONE business day, not two. Said in two places per journey.
 *  2. An old MOA has to be caught. Half of this is code (docIdentity now refuses
 *     a document naming a company we hold under neither of its two names); the
 *     half here is capturing the SECOND name, so that rule can ever fire. A
 *     new-licence application only ever held one company name, which is why the
 *     mismatch could only ever be asked about and never refused.
 *  3. "Which postal service are you applying for?" -- asked of a courier company
 *     whose trade licence prints the answer. Two rules in this prompt already
 *     contradicted each other on this: one said the activity codes are on the
 *     licence, the other (8 September) said they are the customer's answer and
 *     not to be read off it. Resolved in favour of the document, with the ask
 *     kept for the case the 8 September rule was written for -- a company whose
 *     licensed activities are something else entirely.
 *  4. The timeline belongs WITH the payment choice: card is same-day, Virtual
 *     IBAN is next business day. The applicant is choosing between them, so
 *     they need both lines in the message that offers the two buttons.
 *  5. Arabic values captured and shown. EPG_Partner__c has
 *     EPG_Partner_Name_Arabic__c and we have never sent it; the panel had no
 *     field to put it in. (The panel's bidi fix is in the widget.)
 *  6. The service is called the Postal Activity License. "Courier license" was
 *     in both intents and "New license" on the button.
 *  7. Non-resident partners. EPGL already model this exactly:
 *     EPG_Partner__c.EPG_Residence_Type__c is a picklist of
 *     Citizen | Resident | Non Resident, createable, and EPG_Emirates_ID__c is
 *     nillable. So the values here are theirs, spelled their way, and go
 *     straight through. The Emirates ID document is gated on the same field.
 *  8. A sole establishment has no MOA to upload. Account.Legal_Type__c is their
 *     picklist too -- fifteen values, of which exactly one is "Sole
 *     Establishment" -- so the legal form is captured under their vocabulary and
 *     the MOA slot is conditioned on it. ONLY "Sole Establishment" skips it:
 *     "Limited Liability Company - Single Owner(LLC - SO)" is a different legal
 *     form with a different answer, and guessing between them would drop a
 *     mandatory document from a company that needs one.
 *
 * Neither Legal_Type__c nor Account.Type is createable by our integration user,
 * so the legal form is captured and shown but not sent. It is EPGL's own field
 * and they can read it off the licence copy we upload; if they grant write
 * access it is already in the right vocabulary.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/epgl-enhancements-2026-09-11.ts --env <file> [--apply]
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
const changes: string[] = [];
const note = (s: string) => changes.push(s);

/* ── 1 & 4 ───────────────────────────────────────────── the timeline ── */

const ISSUANCE_RULE =
  "LICENCE ISSUANCE TIMELINE (2026-09-11): say how long it takes, and say it WITH the payment choice rather than after it — " +
  "the timeline is part of what the applicant is choosing between. CARD PAYMENT: the licence is issued the SAME DAY, normally " +
  "straight after the payment clears. VIRTUAL IBAN: the licence is issued by the NEXT BUSINESS DAY. Put both lines in the same " +
  "message as the two buttons, one line each, so the choice is made with them in view. In Arabic: الدفع بالبطاقة — تصدر الرخصة في " +
  "نفس اليوم؛ التحويل البنكي (آيبان افتراضي) — تصدر الرخصة في يوم العمل التالي. Everywhere else — the 'what happens next' bullets " +
  "after submission, and any question about how long it takes — the review and issuance figure is ONE business day. Never give a " +
  "time you were not given here, never promise an hour, and never turn 'same day' into 'within minutes'. ";

const TIMELINE_EDITS: [string, string][] = [
  // The "what happens next" bullets, both journeys.
  [
    "typically within 2 business days — in Arabic: خلال يومي عمل تقريباً",
    "typically within ONE business day — in Arabic: خلال يوم عمل واحد",
  ],
  ["typically within 2 business days", "typically within ONE business day (in Arabic: خلال يوم عمل واحد)"],
  // The timeline rule itself, immediately before the payment options it belongs to.
  ["PAYMENT OPTIONS (2026-09-08):", ISSUANCE_RULE + "PAYMENT OPTIONS (2026-09-08):"],
];

/* ── 3 ───────────────────────────────────────── the postal activities ── */

const ACTIVITIES_OLD =
  "POSTAL ACTIVITIES (2026-09-08): activity_codes is the customer's answer, not something to read off the trade licence. " +
  "Ask which postal services the company will provide and accept one or more of exactly these three: Letters & Post Items Delivery, " +
  "Documents Delivery, Parcels Delivery. The company's DED trade-licence activities are NOT the answer — a restaurant applying for a " +
  "postal licence still has to say which postal service it will carry out. Record what they chose by name; the numeric code is added for you. ";

const ACTIVITIES_NEW =
  "POSTAL ACTIVITIES (2026-09-11, replaces the 2026-09-08 rule): the application records which postal services the company will carry " +
  "out — Letters & Post Items Delivery, Documents Delivery, Parcels Delivery, one or more of the three. TAKE THEM FROM THE TRADE " +
  "LICENCE WHENEVER IT STATES THEM. A courier company's licence prints them, usually as names rather than numbers (\"Transport of " +
  "Documents\", \"Transport of Letters\", \"Transport of Parcels\"): map those onto the three above, record them with collect_field, and " +
  "DO NOT ASK. Asking for something the document in front of you already says is the one thing this journey is not allowed to do, and " +
  "EPGL reported it on 11 September against a company whose licence named all three. The value appears in the pre-submission summary " +
  "like every other extracted value, which is where the customer corrects it if you read it wrong. ASK ONLY when the licence names no " +
  "postal activity at all — a company whose licensed activities are something else entirely still has to say which postal service it " +
  "intends to carry out — and then ask once, as a ```buttons block offering the three plus \"All three\". Record what was chosen by " +
  "name; the numeric code is added for you. ";

/* ── 2 & 5 ──────────────────────────── both names, and both languages ── */

const namesRule = (journeyKey: string) =>
  "BOTH NAMES, AND BOTH LANGUAGES (2026-09-11): a UAE trade licence prints the company's name more than once — the registered / legal " +
  "name and the TRADE name, each in English and in Arabic — and it prints the address, the region and the owners' names in both " +
  "scripts too. Capture every one of them that the document actually shows: " +
  (journeyKey === "new_license"
    ? "company_name and company_name_ar for the registered name, trade_name_en and trade_name_ar for the trade name, " +
      "address_street_ar, region_ar, owner_name_ar, and partner_N_name_ar for each partner. "
    : "trade_name_en and trade_name_ar for the trade name, and partner_N_name_ar for each partner. ") +
  "NEVER TRANSLATE OR TRANSLITERATE ONE INTO THE OTHER YOURSELF — an Arabic name you invented is worse than an empty field, " +
  "because it looks like it was read off the document. Leave it blank if the document does not print it. " +
  "Two reasons this matters beyond the panel. The Arabic name is sent to EPGL (EPG_Company_Name_Arabic__c on the company, " +
  "EPG_Partner_Name_Arabic__c on each partner) and they have been receiving partners with no Arabic name at all. And holding the " +
  "registered name AND the trade name is what lets an OLD document be caught: with only one name on file, a document naming anything " +
  "else might always be the company's other name, so the system can only ask. With both, a third name is a name this company does not " +
  "use, the document is refused, and the reason says so. If a document IS refused that way, do not argue it away or ask the customer to " +
  "confirm it — ask for the current version, and say plainly that the one they sent names a company under a name this one does not use. ";

/* ── 7 ───────────────────────────────────────── non-resident partners ── */

const RESIDENCE_RULE =
  "NON-RESIDENT PARTNERS (2026-09-11): a partner who does not live in the UAE has no Emirates ID, and until today the application " +
  "stopped on a document that does not exist for them. Every partner is one of EPGL's three residence types — Citizen, Resident, " +
  "Non Resident — recorded in partner_N_residence, spelled exactly that way because it is their own picklist and goes straight to " +
  "them as EPG_Residence_Type__c. Read it off the paperwork when it is there; a UAE Emirates ID number or a family book makes them a " +
  "Citizen or Resident, and a partner the MOA gives an overseas address is a Non Resident. DO NOT INFER IT FROM NATIONALITY: most UAE " +
  "residents hold a foreign passport, and treating a Pakistani or British partner as non-resident would quietly drop a document they " +
  "do have. When you reach a partner's Emirates ID and it has not been provided, ASK — one short ```buttons block: \"Upload the " +
  "Emirates ID\" / \"Type the number\" / \"This partner lives outside the UAE\". On the third, set partner_N_residence to " +
  "'Non Resident' and the Emirates ID is no longer asked for or required: their PASSPORT stands in its place and is still mandatory. " +
  "Say so once, plainly, so they know the step was skipped deliberately and not missed. Never mark an application ready with a " +
  "partner who has neither an Emirates ID nor a residence type of 'Non Resident'. ";

/* ── 8 ──────────────────────────────────────────── sole establishments ── */

const LEGAL_FORM_RULE =
  "LEGAL FORM, AND WHEN THERE IS NO MOA (2026-09-11): every trade licence prints its legal form (\"Legal Form\" / \"الشكل القانوني\"). " +
  "Read it and record it in legal_form using EPGL's own wording, which is what the options list holds. It decides one thing here: " +
  "A SOLE ESTABLISHMENT HAS NO MEMORANDUM OF ASSOCIATION. One natural person owns it, there are no partners to contract with, and no " +
  "MOA is ever issued — so when legal_form is 'Sole Establishment' the MOA slot disappears on its own and you must NOT ask for one, " +
  "must not describe the application as incomplete without it, and must go straight on to the Emirates ID step. EPGL reported this on " +
  "11 September. Be exact about which form it is: 'Limited Liability Company - Single Owner(LLC - SO)' also has a single owner and " +
  "DOES have an MOA, as does a Civil Company and a Free Zone Company. Only 'Sole Establishment' skips it. If the licence does not " +
  "print a legal form, leave legal_form empty and ask for the MOA as usual — an unknown form is not a sole establishment. ";

/* ── field and document construction ───────────────────────────────────── */

const L = (en: string, ar: string) => ({ en, ar });

const RESIDENCE_OPTIONS = [
  { label: L("Citizen", "مواطن"), value: "Citizen" },
  { label: L("Resident", "مقيم"), value: "Resident" },
  { label: L("Non Resident", "غير مقيم"), value: "Non Resident" },
];

/** EPGL's Account.Legal_Type__c picklist, verbatim. */
const LEGAL_FORMS: [string, string][] = [
  ["Sole Establishment", "مؤسسة فردية"],
  ["Limited Liability Company (LLC)", "شركة ذات مسؤولية محدودة"],
  ["Limited Liability Company - Single Owner(LLC - SO)", "شركة ذات مسؤولية محدودة — مالك واحد"],
  ["Partnership Company", "شركة تضامن"],
  ["Simple Partnership Company", "شركة توصية بسيطة"],
  ["Private Joint Stock Company", "شركة مساهمة خاصة"],
  ["Public Joint Stock Company", "شركة مساهمة عامة"],
  ["Civil Company", "شركة مدنية"],
  ["Free Zone Company", "شركة منطقة حرة"],
  ["Free Zone Establishment", "مؤسسة منطقة حرة"],
  ["Branch of Foreign Company", "فرع شركة أجنبية"],
  ["Branch of Company Registered in other emirates", "فرع شركة مسجلة في إمارة أخرى"],
  ["Branch of Company Registered in free zone", "فرع شركة مسجلة في منطقة حرة"],
  ["Branch of a G.C.C Company", "فرع شركة خليجية"],
  ["Branch of a Dubai Company", "فرع شركة دبي"],
];

const textField = (key: string, en: string, ar: string) => ({
  key,
  type: "text",
  label: L(en, ar),
  validation: { required: false },
});

/** Fields to add, in order, after an existing field in a named step. */
function newFields(journeyKey: string): { step: string; after: string; fields: Record<string, unknown>[] }[] {
  const partnerAr = Array.from({ length: 8 }, (_, i) =>
    textField(
      `partner_${i + 1}_name_ar`,
      `Partner ${i + 1} — full name in Arabic, as printed`,
      `الشريك ${i + 1} — الاسم الكامل بالعربية كما هو مطبوع`
    )
  );
  const residence = Array.from({ length: 8 }, (_, i) => ({
    key: `partner_${i + 1}_residence`,
    type: "enum",
    label: L(`Partner ${i + 1} — residence status`, `الشريك ${i + 1} — حالة الإقامة`),
    options: RESIDENCE_OPTIONS,
    validation: { required: false },
  }));

  if (journeyKey === "new_license") {
    return [
      {
        step: "company_details",
        after: "company_name_ar",
        fields: [
          textField("trade_name_en", "Trade name (English)", "الاسم التجاري (بالإنجليزية)"),
          textField("trade_name_ar", "Trade name (Arabic)", "الاسم التجاري (بالعربية)"),
          {
            key: "legal_form",
            type: "enum",
            label: L("Legal form", "الشكل القانوني"),
            options: LEGAL_FORMS.map(([en, ar]) => ({ label: L(en, ar), value: en })),
            validation: { required: false },
          },
        ],
      },
      {
        step: "company_details",
        after: "address_street",
        fields: [
          textField("address_street_ar", "Street address (Arabic)", "العنوان (بالعربية)"),
          textField("region_ar", "Region / area (Arabic)", "المنطقة (بالعربية)"),
        ],
      },
      { step: "company_details", after: "partner_8_name", fields: [...partnerAr, ...residence] },
      {
        step: "owners_contacts",
        after: "owner_name",
        fields: [textField("owner_name_ar", "Owner / partner full name (Arabic)", "اسم المالك / الشريك (بالعربية)")],
      },
    ];
  }
  return [{ step: "license_review", after: "partner_8_name", fields: [...partnerAr, ...residence] }];
}

/* ── the run ───────────────────────────────────────────────────────────── */

function editGuidance(j: Record<string, any>) {
  let g = String(j.guidance ?? "");
  for (const [from, to] of TIMELINE_EDITS) {
    if (g.includes(from) && !g.includes(to)) {
      g = g.split(from).join(to);
      note(`${j.key}: timeline "${from.slice(0, 44)}…"`);
    }
  }
  if (g.includes(ACTIVITIES_OLD)) {
    g = g.split(ACTIVITIES_OLD).join(ACTIVITIES_NEW);
    note(`${j.key}: postal activities now read off the licence`);
  }
  for (const [label, rule] of [
    ["both names / both languages", namesRule(String(j.key))],
    ["non-resident partners", RESIDENCE_RULE],
    ...(j.key === "new_license" ? ([["legal form / sole establishment", LEGAL_FORM_RULE]] as [string, string][]) : []),
  ] as [string, string][]) {
    if (!g.includes(rule.trim())) {
      g = `${g.trimEnd()}\n\n${rule.trim()}`;
      note(`${j.key}: ${label}`);
    }
  }
  j.guidance = g;
}

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrlFrom(ENV!) });
  const db = drizzle(pool, { schema: { agents } });
  try {
    const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG));
    if (!row) throw new Error(`${SLUG} not found in this database`);
    const def = JSON.parse(JSON.stringify(row.definition)) as Record<string, any>;

    // 6 — the service names, everywhere a person reads them.
    const rename: [string, string][] = [
      ["- New license", "- Apply for Postal Activity License"],
      ["- Renew license", "- Renew Postal Activity License"],
      ["- رخصة جديدة", "- التقدّم بطلب رخصة نشاط بريدي"],
      ["- تجديد رخصة\n", "- تجديد رخصة النشاط البريدي\n"],
    ];
    for (const loc of ["en", "ar"] as const) {
      let g = String(def.greeting?.[loc] ?? "");
      for (const [from, to] of rename) if (g.includes(from) && !g.includes(to)) { g = g.split(from).join(to); note(`greeting.${loc}: ${from.trim()} -> ${to.trim()}`); }
      if (def.greeting) def.greeting[loc] = g;
    }
    for (const it of def.intents ?? []) {
      if (it.key === "new_license" && it.description?.en !== "Apply for a Postal Activity License") {
        it.description = L("Apply for a Postal Activity License", "التقدّم بطلب رخصة نشاط بريدي");
        note("intent new_license: description");
      }
      if (it.key === "renewal" && it.description?.en !== "Renew a Postal Activity License") {
        it.description = L("Renew a Postal Activity License", "تجديد رخصة النشاط البريدي");
        note("intent renewal: description");
      }
    }

    for (const j of def.journeys ?? []) {
      if (j.key === "new_license" && j.title?.en !== "Apply for Postal Activity License") {
        j.title = L("Apply for Postal Activity License", "التقدّم بطلب رخصة نشاط بريدي");
        note("journey new_license: title");
      }

      editGuidance(j);

      // 5 & 7 — the new fields, inserted beside the ones they belong with.
      for (const add of newFields(j.key)) {
        const step = (j.steps ?? []).find((s: any) => s.key === add.step);
        if (!step) continue;
        const have = new Set(step.fields.map((f: any) => f.key));
        const missing = add.fields.filter((f: any) => !have.has(f.key));
        if (!missing.length) continue;
        const at = step.fields.findIndex((f: any) => f.key === add.after);
        if (at === -1) throw new Error(`${j.key}/${add.step}: anchor field ${add.after} is gone`);
        step.fields.splice(at + 1, 0, ...missing);
        note(`${j.key}/${add.step}: +${missing.length} field(s) after ${add.after}`);
      }

      // 7 — the Emirates ID is not asked of someone who cannot have one.
      // 8 — and the MOA is not asked of a company that was never issued one.
      for (const step of j.steps ?? []) {
        for (const doc of step.documents ?? []) {
          const m = /^partner_(\d)_emirates_id$/.exec(String(doc.key));
          if (m) {
            const want = `partner_count >= ${m[1]} && partner_${m[1]}_residence != 'Non Resident'`;
            if (doc.condition !== want) { doc.condition = want; note(`${j.key}: ${doc.key} condition`); }
          }
          if (doc.key === "moa" && doc.condition !== "legal_form != 'Sole Establishment'") {
            doc.condition = "legal_form != 'Sole Establishment'";
            note(`${j.key}: moa condition`);
          }
        }
      }

      // The two Arabic fields EPGL receive but have never been sent, named in
      // the submission notes so they actually reach the payload.
      const notes = String(j.submission?.apiFlow?.notes ?? "");
      const extra =
        " PARTNER FIELDS (2026-09-11): each EPG_Partner__c also carries EPG_Partner_Name_Arabic__c (the partner's name in Arabic, when the document printed one) and EPG_Residence_Type__c (exactly 'Citizen', 'Resident' or 'Non Resident', from partner_N_residence). Send both whenever the case holds them. EPG_Emirates_ID__c is optional and must be OMITTED for a Non Resident partner rather than sent empty.";
      if (notes && !notes.includes("PARTNER FIELDS (2026-09-11)")) {
        j.submission.apiFlow.notes = notes.trimEnd() + extra;
        note(`${j.key}: apiFlow notes — partner Arabic name + residence type`);
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
