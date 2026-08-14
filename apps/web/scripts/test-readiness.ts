/**
 * Smoke-test the UAE readiness assessment against the live configuration.
 * Run from apps/web:  npx tsx scripts/test-readiness.ts
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import { assessReadiness, CRITERIA } from "../lib/readiness";

const bar = (n: number) => "█".repeat(Math.round(n / 5)).padEnd(20, "·");

async function main() {
  const t0 = Date.now();
  const r = await assessReadiness();
  console.log(`\n  OVERALL  ${r.overall}%  — ${r.band}   (assessed in ${Date.now() - t0}ms)\n`);

  console.log("  BY SERVICE");
  for (const s of r.services) console.log(`    ${bar(s.score)} ${String(s.score).padStart(3)}%  ${s.service.entity}  ${s.service.name}`);

  console.log("\n  BY CRITERION");
  for (const c of r.byCriterion) {
    console.log(`    ${bar(c.score)} ${String(c.score).padStart(3)}%  ${c.status.padEnd(8)} ${c.criterion.domain}  (${c.servicesComplete}/${r.services.length} services complete)`);
  }

  console.log("\n  TOP IMPROVEMENTS");
  for (const s of r.suggestions.slice(0, 8)) {
    console.log(`    [${s.severity}] +${s.impact} pts · ${s.domain} · ${s.services.length} service(s)`);
    console.log(`         ${s.fix}`);
  }

  console.log("\n  SIGNALS");
  for (const [k, v] of Object.entries(r.signals)) console.log(`    ${k.padEnd(22)} ${v}`);

  // Sanity assertions — the assessment must be complete and evidence-shaped.
  const problems: string[] = [];
  if (r.services.length !== 6) problems.push(`expected 6 services, assessed ${r.services.length}`);
  for (const s of r.services) {
    if (s.criteria.length !== CRITERIA.length) problems.push(`${s.service.id}: ${s.criteria.length}/${CRITERIA.length} criteria`);
    for (const c of s.criteria) if (!c.checks.length) problems.push(`${s.service.id}/${c.criterionId}: no checks`);
  }
  if (r.overall === 100) problems.push("overall is 100% — the assessment is not discriminating");
  if (!r.suggestions.length) problems.push("no improvement suggestions derived");

  console.log(problems.length ? `\n  ✗ ${problems.length} problem(s):\n${problems.map((p) => `      ${p}`).join("\n")}` : "\n  ✓ assessment structurally sound");
  process.exit(problems.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
