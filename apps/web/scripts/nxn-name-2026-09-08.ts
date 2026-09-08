/**
 * The customer is buying from Emirates Post, not from NXN (2026-09-08).
 *
 * NXN is the project's own name for this agent. The English greeting was
 * corrected in September; the Arabic one still opened "مرحباً بك في NXN", the
 * launcher button on emiratespost.ae read "NXN", and the callback offer said
 * "NXN support" in both languages.
 *
 * The SLUG stays nxn-dialog and so do the integration names and tool prefixes —
 * those are addresses, not words anyone reads. Only what a person sees changes,
 * plus the name shown in the admin console, which reviewers now use.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/nxn-name-2026-09-08.ts [--env <file>] [--dry-run]
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const envArg = process.argv.indexOf("--env");
config({
  path:
    envArg !== -1 && process.argv[envArg + 1]
      ? resolve(process.argv[envArg + 1]!)
      : resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env"),
});

import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";

const SLUG = "nxn-dialog";
const DRY = process.argv.includes("--dry-run");
const EN = "Emirates Post";
const AR = "بريد الإمارات";

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`${SLUG} not found`);
  const def = row.definition as unknown as Record<string, any>;
  const changes: string[] = [];
  const set = (label: string, get: () => unknown, put: (v: string) => void, want: string) => {
    const now = get();
    if (typeof now !== "string" || now === want || !/NXN/i.test(now)) return;
    put(want);
    changes.push(`${label}: "${String(now).slice(0, 60)}" -> "${want.slice(0, 60)}"`);
  };

  // The name, in the console and in the definition.
  const nameWas = row.name;
  const newName = /NXN/i.test(row.name) ? EN : row.name;
  if (newName !== nameWas) changes.push(`agents.name: "${nameWas}" -> "${newName}"`);
  set("definition.name", () => def.name, (v) => (def.name = v), EN);

  // The launcher button, which sits on Emirates Post's own home page.
  if (def.theme?.launcher) {
    set("theme.launcher.label", () => def.theme.launcher.label, (v) => (def.theme.launcher.label = v), EN);
  }

  // The greeting, in both languages.
  for (const [lang, want] of [["en", EN], ["ar", AR]] as const) {
    const g = def.greeting?.[lang];
    if (typeof g === "string" && /NXN/.test(g)) {
      def.greeting[lang] = g.replace(/NXN/g, want);
      changes.push(`greeting.${lang}: NXN -> ${want}`);
    }
  }

  // The callback offer, which the customer reads when we hand them to a human.
  for (const [lang, want] of [["en", EN], ["ar", AR]] as const) {
    const e = def.escalationOffer?.[lang];
    if (typeof e === "string" && /NXN/.test(e)) {
      def.escalationOffer[lang] = e.replace(/NXN/g, want);
      changes.push(`escalationOffer.${lang}: NXN -> ${want}`);
    }
  }

  // The persona shapes how it speaks about itself.
  if (typeof def.persona === "string" && /NXN/.test(def.persona)) {
    def.persona = def.persona.replace(/NXN Dialog/g, `the ${EN} assistant`).replace(/NXN/g, EN);
    changes.push("persona: NXN -> Emirates Post");
  }

  // Intent descriptions are read by the classifier, not the customer, but a
  // label naming a company nobody uses is a label that ages badly.
  for (const i of def.intents ?? []) {
    for (const lang of ["en", "ar"] as const) {
      const d = i?.description?.[lang];
      if (typeof d === "string" && /NXN/.test(d)) {
        i.description[lang] = d.replace(/NXN/g, lang === "ar" ? AR : EN);
        changes.push(`intent ${i.key}.${lang}: NXN -> ${lang === "ar" ? AR : EN}`);
      }
    }
  }

  // A journey's `service` names the backend and is written into records
  // Emirates Post reads. "(staging)" in it on production would be worse than the
  // name — flag it rather than change it silently.
  for (const j of def.journeys ?? []) {
    const svc = j?.submission?.apiFlow?.service;
    if (typeof svc === "string" && /staging/i.test(svc)) {
      console.log(`  ! ${j.key}.submission.apiFlow.service is "${svc}" — names the environment. Left alone; decide deliberately.`);
    }
  }

  if (!changes.length) { console.log("nothing to do — no customer-facing NXN left."); return; }
  for (const c of changes) console.log(`  ~ ${c}`);
  if (!DRY) {
    await db.update(agents).set({ name: newName, definition: def as never }).where(eq(agents.id, row.id));
    console.log(`\n${changes.length} written.`);
  } else {
    console.log(`\n--dry-run: ${changes.length} not written.`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
