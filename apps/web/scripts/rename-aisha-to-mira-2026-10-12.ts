/**
 * The assistant is Mira (ميره), not Aisha — FB-1889, Post Live Feedback Round.
 *
 * "Update the name of the voice and the brand to Mira ميره." The wordmark, the
 * alt text, the voice's own instruction and the code's comments are changed in
 * the repository; this changes what the DATABASE says to a customer — the
 * greeting that introduces the assistant, the persona, and any journey guidance
 * that names it — for every agent in the environment it is run against.
 *
 * Whole words only: "Aisha" → "Mira", "AISHA" → "MIRA", "عائشة" → "ميره". The
 * deployment's internal `name` is left alone, as the 30 September rename left
 * it: it is on the console, in ops emails and in audit rows, and never shown.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/rename-aisha-to-mira-2026-10-12.ts --env <file> [--dry-run]
 */
import { pathToFileURL } from "node:url";
import dns from "node:dns/promises";
import pg from "pg";
import { databaseUrlFrom } from "./lib/envFile";

export const RULES: [RegExp, string][] = [
  [/\bAISHA\b/g, "MIRA"],
  [/\bAisha\b/g, "Mira"],
  [/عائشة/g, "ميره"],
];

export function renameText(s: string): string {
  let out = s;
  for (const [re, to] of RULES) out = out.replace(re, to);
  return out;
}

/** Rename in the places a customer reads; count what changed. */
export function renameDefinition(def: Record<string, any>): { def: Record<string, any>; changes: string[] } {
  const next = JSON.parse(JSON.stringify(def)) as Record<string, any>;
  const changes: string[] = [];
  const fix = (path: string, get: () => unknown, set: (v: string) => void) => {
    const v = get();
    if (typeof v !== "string") return;
    const after = renameText(v);
    if (after !== v) {
      set(after);
      changes.push(path);
    }
  };
  for (const loc of ["en", "ar"] as const) {
    fix(`greeting.${loc}`, () => next.greeting?.[loc], (v) => { next.greeting[loc] = v; });
    fix(`theme.brandName.${loc}`, () => next.theme?.brandName?.[loc], (v) => { next.theme.brandName[loc] = v; });
  }
  fix("theme.brandName", () => next.theme?.brandName, (v) => { next.theme.brandName = v; });
  fix("persona", () => next.persona, (v) => { next.persona = v; });
  for (const j of next.journeys ?? []) {
    fix(`${j.key}.guidance`, () => j.guidance, (v) => { j.guidance = v; });
    for (const loc of ["en", "ar"] as const) {
      fix(`${j.key}.title.${loc}`, () => j.title?.[loc], (v) => { j.title[loc] = v; });
      fix(`${j.key}.summary.${loc}`, () => j.summary?.[loc], (v) => { j.summary[loc] = v; });
    }
  }
  for (const i of next.intents ?? []) {
    for (const loc of ["en", "ar"] as const) {
      fix(`intent ${i.key}.description.${loc}`, () => i.description?.[loc], (v) => { i.description[loc] = v; });
    }
  }
  for (const key of Object.keys(next.guardrails ?? {})) {
    const g = next.guardrails[key];
    if (typeof g === "string") fix(`guardrails.${key}`, () => g, (v) => { next.guardrails[key] = v; });
    else if (g && typeof g === "object") for (const loc of ["en", "ar"] as const) fix(`guardrails.${key}.${loc}`, () => g[loc], (v) => { g[loc] = v; });
  }
  return { def: next, changes };
}

async function poolFor(url: string): Promise<pg.Pool> {
  const u = new URL(url);
  let host = u.hostname;
  try { dns.setServers(["1.1.1.1", "8.8.8.8"]); host = (await dns.resolve4(u.hostname))[0] ?? host; } catch { /* hostname */ }
  return new pg.Pool({ host, port: Number(u.port || 5432), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: u.pathname.slice(1), ssl: { servername: u.hostname, rejectUnauthorized: false } });
}

async function main() {
  const arg = (n: string) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : undefined; };
  const ENV = arg("--env"); if (!ENV) throw new Error("--env <envfile> is required");
  const DRY = process.argv.includes("--dry-run");
  const pool = await poolFor(databaseUrlFrom(ENV));
  try {
    const { rows } = await pool.query(`select id, slug, definition from agents order by slug`);
    let total = 0;
    for (const r of rows) {
      const { def, changes } = renameDefinition(r.definition as Record<string, any>);
      console.log(`\n${r.slug} — ${changes.length ? changes.join(", ") : "nothing to rename"}`);
      if (!changes.length) continue;
      total += changes.length;
      if (!DRY) await pool.query(`update agents set definition = $1::jsonb where id = $2`, [JSON.stringify(def), r.id]);
    }
    // The knowledge base, should any chunk name the assistant.
    const kb = await pool.query(`select id, content from kb_chunks where content ~ 'Aisha|AISHA|عائشة'`);
    for (const c of kb.rows) {
      const next = renameText(c.content);
      if (next === c.content) continue;
      total++;
      console.log(`  ~ kb chunk ${c.id}`);
      if (!DRY) await pool.query(`update kb_chunks set content = $1 where id = $2`, [next, c.id]);
    }
    if (!total) { console.log("\nAlready applied — nothing to change."); return; }
    console.log(DRY ? `\n--dry-run: ${total} change(s) NOT written.` : `\n${total} change(s) written.`);
  } finally { await pool.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(() => process.exit(0)).catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
}
