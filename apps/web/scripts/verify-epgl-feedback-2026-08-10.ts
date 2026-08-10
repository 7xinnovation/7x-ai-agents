/**
 * Verifies the four EPGL feedback items exported 2026-08-10 are actually in
 * effect — the stored agent definition AND the code paths that enforce them.
 *
 * Run from apps/web:  npx tsx scripts/verify-epgl-feedback-2026-08-10.ts
 *   prod: DATABASE_URL=<Railway DATABASE_PUBLIC_URL> npx tsx scripts/verify-epgl-feedback-2026-08-10.ts
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(HERE, "../../../.env") });

import { readFileSync } from "node:fs";
import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";

const SLUG = "epgl-dialog";
const src = (p: string) => readFileSync(resolve(HERE, "..", p), "utf8");

let pass = 0;
let fail = 0;
function check(item: string, name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  ✓ [${item}] ${name}`); }
  else { fail++; console.log(`  ✗ [${item}] ${name}${detail ? ` — ${detail}` : ""}`); }
}

interface Field { key: string; editable?: boolean }
interface Step { key: string; fields: Field[] }
interface Journey { key: string; guidance?: string; steps: Step[] }
interface Definition { persona: string; journeys: Journey[] }

const CONTACT_KEYS = [
  "contact_name", "contact_email", "contact_phone", "contact_designation",
  "owner_contact_no", "accountant_name", "accountant_email", "accountant_phone",
];

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`${SLUG} not found`);
  const def = row.definition as unknown as Definition;
  const journeys = def.journeys.filter((j) => ["new_license", "renewal"].includes(j.key));
  const g = (k: string) => journeys.find((j) => j.key === k)?.guidance ?? "";

  console.log("\nFB-1564 — the AI communication needs to be more human");
  check("FB-1564", "persona no longer describes a government tone",
    !/government-grade/i.test(def.persona), def.persona.slice(0, 60));
  check("FB-1564", "persona describes a person, not an institution",
    /like a capable colleague/i.test(def.persona));
  for (const j of journeys)
    check("FB-1564", `"${j.key}" carries the HOW YOU SOUND rule`,
      /HOW YOU SOUND/.test(j.guidance ?? "") && /Use contractions/.test(j.guidance ?? ""));
  check("FB-1564", "banned bureaucratic filler is named explicitly",
    /Kindly be informed/.test(g("new_license")) && /Please be advised/.test(g("new_license")));
  check("FB-1564", "human tone is not licence to over-promise",
    /never soften a requirement, invent a timeline/i.test(g("new_license")));
  check("FB-1564", "Arabic gets its own naturalness instruction",
    journeys.every((j) => /natural Modern Standard Arabic/i.test(j.guidance ?? "")));

  console.log("\nFB-1565 — next steps should be clear, not prompted by the applicant");
  for (const j of journeys)
    check("FB-1565", `"${j.key}" carries the ALWAYS SAY WHAT HAPPENS NEXT rule`,
      /ALWAYS SAY WHAT HAPPENS NEXT/.test(j.guidance ?? ""));
  check("FB-1565", "every message must end by naming the next action",
    /Every message you send ends by naming what happens now/.test(g("new_license")));
  check("FB-1565", "journey opens with its stages",
    /say in one short sentence what the stages are/.test(g("new_license")));
  check("FB-1565", "waits on EPGL are explained, not left to be asked about",
    /tell them what will happen, roughly when, and what they will receive/.test(g("renewal")));
  check("FB-1565", "choices are offered as buttons rather than open questions",
    journeys.every((j) => /put it in a ```buttons block instead of asking an open question/.test(j.guidance ?? "")));

  console.log("\nFB-1566 — only the client's preferred contact details are editable");
  for (const j of journeys) {
    const fields = j.steps.flatMap((s) => s.fields);
    const editable = fields.filter((f) => f.editable === true).map((f) => f.key).sort();
    const expected = CONTACT_KEYS.filter((k) => fields.some((f) => f.key === k)).sort();
    check("FB-1566", `"${j.key}" marks every field's editability`,
      fields.every((f) => typeof f.editable === "boolean"),
      fields.filter((f) => typeof f.editable !== "boolean").map((f) => f.key).join(", "));
    check("FB-1566", `"${j.key}" editable set is exactly the contact fields`,
      JSON.stringify(editable) === JSON.stringify(expected), `got ${editable.join(", ")}`);
    check("FB-1566", `"${j.key}" document-sourced values are locked`,
      fields.filter((f) => /company_name|trade_license_number|owner_name|owner_emirates_id|license_expiry_date/.test(f.key))
        .every((f) => f.editable === false));
  }
  const routeSrc = src("app/api/case/field/route.ts");
  check("FB-1566", "the edit API enforces the allowlist server-side (not just the UI)",
    /curated && field\.editable !== true/.test(routeSrc));
  const expSrc = src("app/embed/[agent]/Experience.tsx");
  check("FB-1566", "the panel pencil honours the same allowlist",
    /const curated = fields\.some\(\(f\) => f\.editable !== undefined\)/.test(expSrc));
  check("FB-1566", "uncurated agents keep the original behaviour",
    /curated \? f\.editable === true : true/.test(expSrc));
  check("FB-1566", "the flag reaches the browser through both projections",
    /editable: f\.editable/.test(src("app/embed/[agent]/page.tsx")) &&
    /editable: f\.editable/.test(src("app/api/agents/[agent]/route.ts")));
  for (const j of journeys)
    check("FB-1566", `"${j.key}" forbids overwriting document values on request alone`,
      /Never silently change a document-sourced value on the customer's word alone/.test(j.guidance ?? ""));
  check("FB-1566", "a genuine misread is still correctable",
    /If we simply misread the document, correct the field to what the document actually says/.test(g("new_license")));

  console.log("\nFB-1567 — pin the applicant's physical address on a map");
  const companyStep = def.journeys.find((j) => j.key === "new_license")?.steps.find((s) => s.key === "company_details");
  check("FB-1567", "address_geo field exists on the company step",
    !!companyStep?.fields.some((f) => f.key === "address_geo"));
  check("FB-1567", "the pinned location is not itself hand-editable",
    companyStep?.fields.find((f) => f.key === "address_geo")?.editable === false);
  check("FB-1567", "guidance tells the agent to emit a ```locate block",
    /PIN THE PHYSICAL ADDRESS ON A MAP/.test(g("new_license")) && /`locate`/.test(g("new_license")));
  check("FB-1567", "the coordinates are recorded into address_geo",
    /record the coordinates and link with collect_field into address_geo/.test(g("new_license")));
  check("FB-1567", "pinning never blocks the application",
    /accept the typed address and move on/.test(g("new_license")));
  const locSrc = src("app/embed/[agent]/ChatLocate.tsx");
  check("FB-1567", "the confirmed pin carries a Google Maps link",
    /https:\/\/www\.google\.com\/maps\?q=/.test(locSrc));
  check("FB-1567", "the picker is localized (Arabic + English)",
    /const LOC_STR = \{/.test(locSrc) && /حدّد الموقع على الخريطة/.test(locSrc));
  check("FB-1567", "reverse geocoding follows the session language",
    /language=\$\{locale === "ar" \? "ar" : "en"\}/.test(locSrc));
  check("FB-1567", "the session locale is threaded from the chat",
    /locale=\{uploadCtx\?\.locale\}/.test(src("app/embed/[agent]/Markdown.tsx")));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
