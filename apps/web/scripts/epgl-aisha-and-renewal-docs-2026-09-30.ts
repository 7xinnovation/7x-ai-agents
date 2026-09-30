/**
 * EPGL: the assistant is called Aisha, and a renewal needs two more documents.
 *
 * 1. "Update the current greeting from 'Hi, I'm EPG Dialog' to 'Hi, I'm Aisha'
 *    and ensure the old name is replaced throughout the customer conversation."
 *    The wordmark in the header has said Aisha for weeks; only the words did
 *    not. "EPGL Dialog" is our name for the deployment, not a name to introduce
 *    yourself with.
 *
 * 2. "Add the Memorandum of Association (MOA) and Trial Balance as required
 *    upload documents in the renewal process, as these will be required for all
 *    renewal applications." Mandatory, both — not offered, required.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/epgl-aisha-and-renewal-docs-2026-09-30.ts --env <file> [--dry-run]
 */
import { databaseUrlFrom } from "./lib/envFile";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { agents } from "@dialog/db";
import { eq } from "drizzle-orm";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const ENV = arg("--env");
if (!ENV) throw new Error("--env <envfile> is required");
const DRY = process.argv.includes("--dry-run");
const SLUG = "epgl-dialog";

/** The name the assistant introduces itself with, in the customer's language. */
const OLD_NAMES = ["EPGL Dialog", "EPG Dialog"];
const NEW_NAME = { en: "Aisha", ar: "عائشة" };

/**
 * Both mandatory, on the documents step of the renewal.
 *
 * Shaped like the documents already there — same keys, same limits — so the
 * readiness panel, the upload route and the Salesforce attachment all treat
 * them as they treat every other file.
 */
const DOCS = [
  {
    key: "moa",
    label: { en: "Memorandum of Association (MOA)", ar: "عقد التأسيس" },
    description: {
      en: "The company's MOA, as filed with the licensing authority.",
      ar: "عقد تأسيس الشركة كما هو مُودع لدى جهة الترخيص.",
    },
  },
  {
    key: "trial_balance",
    label: { en: "Trial Balance", ar: "ميزان المراجعة" },
    description: {
      en: "The trial balance for the financial year being reported.",
      ar: "ميزان المراجعة للسنة المالية المشمولة بالتقرير.",
    },
  },
];

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrlFrom(ENV!) });
  const db = drizzle(pool, { schema: { agents } });
  try {
    const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG));
    if (!row) throw new Error(`No agent ${SLUG} in this database`);
    const def = JSON.parse(JSON.stringify(row.definition)) as Record<string, any>;
    let changes = 0;

    // 1. The name, wherever it is said to a customer.
    for (const loc of ["en", "ar"] as const) {
      const before = String(def.greeting?.[loc] ?? "");
      let after = before;
      for (const old of OLD_NAMES) after = after.split(old).join(NEW_NAME[loc]);
      if (after !== before) {
        def.greeting[loc] = after;
        console.log(`  ~ greeting.${loc}: renamed`);
        changes++;
      }
    }
    for (const j of def.journeys ?? []) {
      const before = String(j.guidance ?? "");
      let after = before;
      for (const old of OLD_NAMES) after = after.split(old).join(NEW_NAME.en);
      if (after !== before) {
        j.guidance = after;
        console.log(`  ~ ${j.key}.guidance: renamed`);
        changes++;
      }
    }
    /**
     * `name` is the DEPLOYMENT's name — it is on the admin console, in ops
     * emails and in audit rows, and renaming it would rewrite our own records
     * of what sent what. The customer never sees it. Left alone deliberately.
     */
    console.log(`  (left alone) definition.name = ${JSON.stringify(def.name)} — internal, never shown to a customer`);

    // 2. The two documents, on the renewal's documents step.
    const renewal = (def.journeys ?? []).find((j: any) => j.key === "renewal");
    if (!renewal) throw new Error("no renewal journey here");
    const step = (renewal.steps ?? []).find((s: any) => s.key === "documents") ?? (renewal.steps ?? [])[0];
    if (!step) throw new Error("the renewal has no step to put a document on");
    step.documents = step.documents ?? [];
    // Copy the shape of a document already there, so nothing about these two is
    // special: same accepted formats, same size limit, same everything.
    const model = step.documents.find((d: any) => d.key === "updated_trade_license") ?? step.documents[0];
    for (const doc of DOCS) {
      const at = step.documents.findIndex((d: any) => d.key === doc.key);
      const next = {
        ...(model ? JSON.parse(JSON.stringify(model)) : {}),
        key: doc.key,
        label: doc.label,
        description: doc.description,
        requirement: "mandatory",
        condition: undefined,
      };
      delete next.condition;
      if (at === -1) {
        step.documents.push(next);
        console.log(`  + renewal/${step.key}: ${doc.key} (mandatory)`);
        changes++;
      } else if (step.documents[at].requirement !== "mandatory") {
        step.documents[at] = { ...step.documents[at], requirement: "mandatory", label: doc.label, description: doc.description };
        console.log(`  ~ renewal/${step.key}: ${doc.key} -> mandatory`);
        changes++;
      } else {
        console.log(`  (already) renewal/${step.key}: ${doc.key}`);
      }
    }

    if (!changes) { console.log("\nAlready applied — nothing to change."); return; }
    if (DRY) { console.log(`\n--dry-run: ${changes} change(s) NOT written.`); return; }
    await db.update(agents).set({ definition: def as any }).where(eq(agents.id, row.id));
    console.log(`\n${changes} change(s) written.`);
  } finally {
    await pool.end();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
