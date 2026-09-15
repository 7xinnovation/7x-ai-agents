/**
 * The quarterly figures follow the Form 9 out of the renewal.
 *
 * The Form 9 DOCUMENT came out on 15 September, at EPGL's request: it is a
 * quarterly revenue return filed on their own platform, not something that
 * changes hands in a chat. Emre's follow-up the same afternoon closed the gap
 * that left:
 *
 *   "regarding the quarterly leviable details. i believe you referring this to
 *    form9 basically which should be based on what i mentioned about removing
 *    the form 9 from the flow. once i receive the document from licensing we
 *    will upload it on admin where basically on the renewal flow based on the
 *    trade license number, it will check the document for the companies where
 *    they need to complete their form9 before going through the renewal flow."
 *
 * He is right, and the half-measure was ours. We stopped asking for the PDF and
 * kept asking for everything written on it — four quarters of leviable income,
 * the quarter the licence period starts at, the financial year — with a page of
 * guidance on how to walk calendar quarters forward and roll the year after Q4.
 * A customer was still filling in a Form 9, one question at a time, in a
 * conversation that had just told them the Form 9 is filed somewhere else.
 *
 * The figures belong to the returns EPGL already hold. Nothing in this journey
 * needs them: the licence fee is a flat AED 100,700, the levy is assessed by
 * EPGL from the filed returns and quoted in the payment request they issue
 * after the document review, and `EPG_Finance_Summary__c` rows are their record
 * of a filing we are not taking.
 *
 * WHAT REPLACES IT IS NOT BUILT YET, DELIBERATELY. The gate Emre describes —
 * a list of companies with returns outstanding, matched on trade licence number
 * and checked before a renewal can proceed — needs the list, and the list is
 * with Licensing. Guessing at somebody's compliance from a tool that may simply
 * have no rows for them is worse than saying we cannot see it, so the guidance
 * says exactly that and no gate is invented in the meantime.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/epgl-form9-out-of-renewal-2026-09-15.ts --env <file> [--apply]
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

/** The Form 9's own fields, which is all of these. */
const DROP_FIELDS = new Set([
  "license_period_start_quarter",
  "financial_year",
  "leviable_income_q1",
  "leviable_income_q2",
  "leviable_income_q3",
  "leviable_income_q4",
]);

/** Sentences to delete outright, matched on a distinctive opening. */
const DELETE = [
  "- QUARTERS ARE CALENDAR QUARTERS; THE LICENCE ONLY DECIDES WHICH ONE YOU START AT:",
  "- READ THE FIGURES, DO NOT DICTATE THEM:",
  "- THE QUARTERLY FIGURES ARE ALREADY FILED:",
];

/** Sentences to replace, old -> new. */
const REPLACE: [string, string][] = [
  [
    "and the owner's Emirates ID come from their Salesforce customer profile, and the quarterly leviable-income figures come from IDEP / company data.",
    "and the owner's Emirates ID come from their Salesforce customer profile.",
  ],
  [
    "3) The quarterly leviable-income figures come from IDEP / company data for a signed-in customer: present them as a ```cards summary for confirmation rather than asking the customer to enter them; only ask for figures that are genuinely missing, plus the accountant contact.",
    "3) DO NOT COLLECT ANY REVENUE FIGURES. The renewal does not ask for quarterly leviable income, a licence period start quarter or a financial year: those belong to the Form 9 returns filed on EPGL's own platform. Collect the applicant's contact details and the accountant's, and nothing financial.",
  ],
  [
    "- REVENUE DOCUMENTS ARE PART OF THE RENEWAL: the Form 9 and the Audited Financial Statements are MANDATORY,",
    "- REVENUE DOCUMENTS ARE PART OF THE RENEWAL: the Audited Financial Statements are MANDATORY,",
  ],
  [
    "You may REQUEST, RECEIVE and READ a Form 9 — the guardrail on Form 09 is about not advising on how to complete or interpret one, not about handling the document.",
    "Never ask for a Form 9 among them.",
  ],
  [
    "- PREPARATION LIST: at the start of a renewal, show once what the customer should have ready: the postal license number, the current trade / postal license (upload), optionally the quarterly financial statement, and the in-chat declaration & terms checkboxes at the end.",
    "- PREPARATION LIST: at the start of a renewal, show once what the customer should have ready: the postal license number, the current trade / postal license (upload), the audited financial statements (upload), each partner's passport and Emirates ID (upload), and the in-chat declaration & terms checkboxes at the end. No revenue figures are needed and none are asked for.",
  ],
  // The 15 September note kept a door open that is now closed.
  [
    "The FIGURES still matter and still come from Form 9 — from the returns already filed, through epgl_form9_history, not from a PDF.",
    "NEITHER ARE THE FIGURES ON IT. Do not ask for quarterly leviable income, a licence period start quarter or a financial year, do not present quarters for confirmation, and do not walk a customer through four revenue questions: EPGL assess the levy from the returns already filed with them and state the payable amount in the payment request they issue after the document review. The annual licence fee is a flat AED 100,700 and does not depend on any of it.",
  ],
];

/** Added if not already present. */
const NEW_LICENCE_MOA =
  " THE MOA IS OFFERED ONCE, IN WORDS (2026-09-15): the Memorandum of Association is OPTIONAL, so its upload control is an offer, not a demand — and an offer nobody made in the sentence above it reads as a demand. NAME it when you offer it ('next, the Memorandum of Association, if you have it') and emit its block in THAT message only. Never emit an MOA block in a message about anything else — not beside a partner's passport or Emirates ID, not under a ```buttons question, not 'in case they have it handy'. If they do not upload it, move on and do not raise it again: the application is complete without it and the panel still lists it for anyone who wants to come back. A control the customer did not ask for, beside a question about somebody's Emirates ID, is the only thing on the screen to press — which is exactly how a customer came to put their MOA into a slot for a passport.";

const RENEWAL_NO_FIGURES =
  " NO REVENUE FIGURES ARE COLLECTED ON A RENEWAL (2026-09-15): there are no leviable-income fields, no licence period start quarter and no financial year on this journey, and there is nothing to derive, walk forward or roll over. Do not ask for them, do not present quarters for confirmation, and do not tell the customer the renewal is incomplete without them. If they volunteer figures, thank them and explain that EPGL take the revenue from the Form 9 returns filed on their platform. If they ask whether their own returns are outstanding: that is completed on the EPGL platform, outside this chat, a renewal cannot be processed while returns are missing, and you cannot see their filing status from here — say so rather than guessing.";

function guidanceOf(j: Record<string, any>): string {
  const g = j.guidance;
  return typeof g === "string" ? g : String(g?.en ?? "");
}
function setGuidance(j: Record<string, any>, text: string) {
  if (typeof j.guidance === "string") j.guidance = text;
  else j.guidance = { ...j.guidance, en: text };
}

/** Remove one sentence-or-bullet, from its opening to the end of its line. */
function deleteRun(text: string, opening: string): { text: string; hit: boolean } {
  const at = text.indexOf(opening);
  if (at === -1) return { text, hit: false };
  let end = text.indexOf("\n", at);
  if (end === -1) end = text.length;
  // Take the newline with it so no blank line is left behind.
  const cut = text.slice(0, at) + text.slice(Math.min(end + 1, text.length));
  return { text: cut, hit: true };
}

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrlFrom(ENV!) });
  const db = drizzle(pool, { schema: { agents } });
  try {
    const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG));
    if (!row) throw new Error(`${SLUG} not found in this database`);
    const def = JSON.parse(JSON.stringify(row.definition)) as Record<string, any>;
    const changes: string[] = [];

    for (const j of def.journeys ?? []) {
      if (j.key === "renewal") {
        for (const step of j.steps ?? []) {
          const before = (step.fields ?? []).length;
          step.fields = (step.fields ?? []).filter((f: any) => !DROP_FIELDS.has(String(f?.key)));
          if (step.fields.length !== before)
            changes.push(`renewal/${step.key}: removed ${before - step.fields.length} Form 9 field(s)`);
          // The step is no longer a financial summary; it is who to contact and
          // what they are agreeing to.
          if (step.key === "finance" && step.title?.en === "Financial summary") {
            step.title = { en: "Contacts & confirmation", ar: "جهات الاتصال والإقرارات" };
            changes.push("renewal/finance: retitled");
          }
        }
        let g = guidanceOf(j);
        for (const opening of DELETE) {
          const r = deleteRun(g, opening);
          if (r.hit) {
            g = r.text;
            changes.push(`renewal guidance: deleted "${opening.slice(0, 44)}…"`);
          }
        }
        for (const [from, to] of REPLACE) {
          if (!g.includes(from)) continue;
          g = g.replace(from, to);
          changes.push(`renewal guidance: rewrote "${from.slice(0, 44)}…"`);
        }
        if (!g.includes("NO REVENUE FIGURES ARE COLLECTED ON A RENEWAL")) {
          g = `${g.trimEnd()}\n${RENEWAL_NO_FIGURES.trim()}`;
          changes.push("renewal guidance: + no revenue figures");
        }
        setGuidance(j, g);
      }

      if (j.key === "new_license") {
        let g = guidanceOf(j);
        if (!g.includes("THE MOA IS OFFERED ONCE, IN WORDS")) {
          g = `${g.trimEnd()}\n${NEW_LICENCE_MOA.trim()}`;
          changes.push("new_license guidance: + the MOA is offered once");
        }
        setGuidance(j, g);
      }
    }

    if (!changes.length) {
      console.log("nothing to do — already applied.");
      return;
    }
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
