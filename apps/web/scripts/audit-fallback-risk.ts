/**
 * Where could the agent fill a failed lookup with something plausible?
 *
 * Three times this week the same shape has bitten: a tool that cannot answer,
 * plus a convincing-looking value within reach, and the model uses the value.
 * Invented issuing authorities, invented box numbers, and a duration card priced
 * from the bundle's list rate when Pricing was failing.
 *
 * The risk is never the tool alone — it is the PAIR. So this looks for the
 * second half: static values living in the agent definition that mirror
 * something a backend is supposed to provide. Those are the answers a model
 * reaches for when the real one is unavailable.
 *
 * Run from apps/web:  npx tsx scripts/audit-fallback-risk.ts [--env <file>]
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

import { getDb, agents, kbChunks, kbDocuments } from "@dialog/db";
import { and, eq, sql } from "drizzle-orm";

interface Finding { agent: string; where: string; what: string; why: string }
const findings: Finding[] = [];

async function main() {
  const db = getDb();
  for (const row of await db.select().from(agents)) {
    const def = row.definition as Record<string, any>;
    const slug = def.slug as string;

    for (const j of def.journeys ?? []) {
      const sub = j.submission ?? {};

      // A price in the definition is the exact thing a model quotes when the
      // pricing tool fails — that is what produced "1 Year, AED 995".
      if (typeof sub.amount === "number") {
        findings.push({
          agent: slug, where: `journey ${j.key}`, what: `submission.amount = ${sub.amount} ${sub.currency ?? ""}`.trim(),
          why: "a static price sitting next to a live pricing tool",
        });
      }
      for (const s of sub.surcharges ?? []) {
        if (typeof s.amount === "number") {
          findings.push({
            agent: slug, where: `journey ${j.key}`, what: `surcharge ${s.key} = ${s.amount}`,
            why: "static add-on fee; correct only while the real fee never changes",
          });
        }
      }

      // An enum whose values mirror backend identifiers goes stale silently and
      // is always available as an answer — the MYBOX/IN bug in another guise.
      for (const st of j.steps ?? []) {
        for (const f of st.fields ?? []) {
          if (f.type !== "enum" || !Array.isArray(f.options)) continue;
          const values: string[] = f.options.map((o: any) => String(o.value));
          const looksLikeBackendId = values.some((v) => /^[A-Z0-9_]{2,12}$/.test(v)) && values.length >= 2;
          if (looksLikeBackendId) {
            findings.push({
              agent: slug, where: `journey ${j.key} / field ${f.key}`, what: values.join(", "),
              why: "hardcoded options that mirror backend data; drift is invisible until a write fails",
            });
          }
        }
      }
    }

    // Knowledge-base text carrying figures. Retrieval always succeeds, so these
    // are quotable even when the system of record is unreachable.
    const rows = await db
      .select({ title: kbDocuments.title, content: kbChunks.content })
      .from(kbChunks)
      .innerJoin(kbDocuments, eq(kbDocuments.id, kbChunks.documentId))
      .where(and(eq(kbChunks.agentId, row.id), sql`${kbChunks.content} ~ '(AED|درهم)\\s*[0-9]'`));
    for (const r of rows) {
      const m = String(r.content).match(/(AED|درهم)\s*[0-9][0-9,.]*/g) ?? [];
      if (m.length) {
        findings.push({
          agent: slug, where: `knowledge: ${r.title}`, what: [...new Set(m)].slice(0, 6).join(", "),
          why: "figures in retrievable text; quotable when the pricing tool cannot answer",
        });
      }
    }
  }

  const byAgent = new Map<string, Finding[]>();
  for (const f of findings) byAgent.set(f.agent, [...(byAgent.get(f.agent) ?? []), f]);
  for (const [agent, fs] of byAgent) {
    console.log(`\n=== ${agent} — ${fs.length} place(s) with a ready-made answer`);
    for (const f of fs) console.log(`  ${f.where}\n     ${f.what}\n     ^ ${f.why}`);
  }
  console.log(`\n${findings.length} total. Each is only a risk where the matching tool can fail — see the tool tiers.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
