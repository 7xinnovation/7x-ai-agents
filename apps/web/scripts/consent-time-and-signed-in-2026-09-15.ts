/**
 * The moment of consent, and the applicant who has already told us who they are.
 *
 * Two asks from 15 September, one per agent:
 *
 *  - Emirates Post: "stamp the server time alongside each acceptance so the
 *    moment of consent is auditable", and a timestamp on each part of the
 *    conversation. The stamping is code — collect_field writes <key>_at itself
 *    now, rather than the model writing what it believed the time to be. This
 *    adds the FIELDS, so the panel labels them instead of showing a bare key.
 *    NXN had none: terms_accepted, save_card_consent and auto_renew_consent
 *    across four journeys, every one a bare true with no moment attached.
 *
 *  - EPGL: a customer signed in with UAE PASS was still asked for their name and
 *    email on the first turn. Both are handed to us at sign-in. The seeding and
 *    the prompt note are code; this gives the RENEWAL somewhere to put them —
 *    it had no applicant contact fields at all, only the accountant's, so the
 *    portal user on the submission had no source but the model's memory.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/consent-time-and-signed-in-2026-09-15.ts --env <file> [--apply]
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

const L = (en: string, ar: string) => ({ en, ar });

/** The label for a consent field's companion timestamp. */
const STAMP_LABEL: Record<string, { en: string; ar: string }> = {
  terms_accepted_at: L("Terms accepted at (date & time, UTC)", "تاريخ ووقت قبول الشروط (UTC)"),
  save_card_consent_at: L("Card-saving consent given at (date & time, UTC)", "تاريخ ووقت الموافقة على حفظ البطاقة (UTC)"),
  auto_renew_consent_at: L("Auto-renewal consent given at (date & time, UTC)", "تاريخ ووقت الموافقة على التجديد التلقائي (UTC)"),
};

const CONSENT = /(_accepted|_consent|_acknowledged)$/;

const APPLICANT_FIELDS = [
  {
    key: "contact_name",
    type: "text",
    label: L("Applicant name", "اسم مقدّم الطلب"),
    validation: { required: true },
  },
  {
    key: "contact_email",
    type: "text",
    label: L("Applicant email", "البريد الإلكتروني لمقدّم الطلب"),
    validation: { required: true },
  },
  {
    key: "contact_phone",
    type: "text",
    label: L("Applicant phone", "هاتف مقدّم الطلب"),
    validation: { required: false },
  },
];

const CONSENT_RULE =
  "THE TIME OF AN ACCEPTANCE IS NOT YOURS TO WRITE (2026-09-15): when the customer accepts something — the terms, the declaration, saving their card, auto-renewal — record ONLY the acceptance itself with collect_field. The server stamps the moment it happened, to the second, in UTC, and a `<field>_at` you try to set is refused. Do not state a time back to the customer, do not guess one, and do not repeat one you see on the case: if they ask when they agreed, the panel shows it. Emirates Post asked for this so the moment of consent is auditable, and a time the assistant remembered is a record of what the assistant thought, not of when somebody agreed. ";

const SIGNED_IN_RULE =
  "A SIGNED-IN APPLICANT HAS ALREADY TOLD US WHO THEY ARE (2026-09-15): UAE PASS hands over their name and their email at sign-in, and both are on the application before you say a word. NEVER open by asking for them. Show what you have, once, as a single confirmation — \"I have you as <name>, <email> — is that right for this application?\" — and move on from the answer. If they correct one, record the correction with collect_field and use it from then on; if they confirm, say nothing further about it. The applicant is the person signing in, which on a renewal is NOT the accountant: contact_name / contact_email / contact_phone are the applicant, accountant_name / accountant_email / accountant_phone are the accountant, and the two are collected separately even when they turn out to be the same person. ";

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrlFrom(ENV!) });
  const db = drizzle(pool, { schema: { agents } });
  const changes: string[] = [];
  try {
    for (const slug of ["nxn-dialog", "epgl-dialog"]) {
      const [row] = await db.select().from(agents).where(eq(agents.slug, slug));
      if (!row) { console.log(`   ! ${slug} not in this database — skipped`); continue; }
      const def = JSON.parse(JSON.stringify(row.definition)) as Record<string, any>;
      let touched = false;

      for (const j of def.journeys ?? []) {
        for (const step of j.steps ?? []) {
          const have = new Set((step.fields ?? []).map((f: any) => f.key));
          // A timestamp beside every acceptance, in the order the consents appear.
          for (let i = step.fields.length - 1; i >= 0; i--) {
            const f = step.fields[i];
            if (!CONSENT.test(String(f.key))) continue;
            const stampKey = `${f.key}_at`;
            if (have.has(stampKey)) continue;
            const label = STAMP_LABEL[stampKey];
            if (!label) { console.log(`   ! no label for ${stampKey} (${slug}/${j.key}) — skipped`); continue; }
            step.fields.splice(i + 1, 0, {
              key: stampKey,
              type: "text",
              label,
              editable: false,
              validation: { required: false },
            });
            have.add(stampKey);
            changes.push(`${slug}/${j.key}: + ${stampKey}`);
            touched = true;
          }
        }

        // The EPGL renewal's applicant, who is not its accountant.
        if (slug === "epgl-dialog" && j.key === "renewal") {
          const step = (j.steps ?? []).find((s: any) => s.key === "finance");
          if (step) {
            const have = new Set(step.fields.map((f: any) => f.key));
            const missing = APPLICANT_FIELDS.filter((f) => !have.has(f.key));
            if (missing.length) {
              const at = step.fields.findIndex((f: any) => f.key === "accountant_name");
              step.fields.splice(at === -1 ? 0 : at, 0, ...JSON.parse(JSON.stringify(missing)));
              changes.push(`epgl-dialog/renewal: +${missing.length} applicant contact field(s)`);
              touched = true;
            }
          }
        }

        const rules: [string, string][] = [["the time of an acceptance", CONSENT_RULE]];
        if (slug === "epgl-dialog") rules.push(["a signed-in applicant", SIGNED_IN_RULE]);
        for (const [label, rule] of rules) {
          const g = String(j.guidance ?? "");
          if (g.includes(rule.trim())) continue;
          j.guidance = `${g.trimEnd()}\n\n${rule.trim()}`;
          changes.push(`${slug}/${j.key}: ${label}`);
          touched = true;
        }
      }

      if (touched && APPLY) {
        await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
      }
    }

    if (!changes.length) { console.log("nothing to do — already applied."); return; }
    console.log(`${changes.length} change(s):`);
    for (const c of changes) console.log(`   ~ ${c}`);
    console.log(APPLY ? "\nwritten." : "\nDry run — nothing written. Add --apply to write.");
  } finally {
    await pool.end();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
