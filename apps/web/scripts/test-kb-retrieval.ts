/**
 * KB retrieval test (FB-1433 NXN corporate enrichment, FB-1424 EPGL FAQs):
 * runs the real knowledge adapter (Neon FTS / pgvector) for the questions the
 * reviewers said had no answers, and asserts the new documents surface.
 * Run from apps/web: npx tsx scripts/test-kb-retrieval.ts
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import { resolveAdapters, adapterContext } from "@dialog/core";
import { ensureAdapters } from "../lib/registry";
import { getAgentBySlug } from "../lib/agents";

const CASES: { agent: string; query: string; locale: "en" | "ar"; expect: RegExp; fb: string }[] = [
  { agent: "nxn-dialog", query: "What documents are required for a corporate PO Box?", locale: "en", expect: /trade license|UAE PASS|owner/i, fb: "FB-1433 corporate documents" },
  { agent: "nxn-dialog", query: "Who is eligible for a corporate PO Box and how long does it take?", locale: "en", expect: /registered in the UAE|owner|business days|active immediately/i, fb: "FB-1433 eligibility/timelines" },
  { agent: "nxn-dialog", query: "corporate PO Box fees", locale: "en", expect: /Basic, Premium|key delivery|AED 25/i, fb: "FB-1433 fees" },
  { agent: "epgl-dialog", query: "When is payment requested and how do I pay?", locale: "en", expect: /payment request|secure|gateway/i, fb: "FB-1424 payment trigger/methods" },
  { agent: "epgl-dialog", query: "How long does the review of my application take?", locale: "en", expect: /2 business days/i, fb: "FB-1424 review timeline" },
  { agent: "epgl-dialog", query: "What happens after I submit my application?", locale: "en", expect: /review|payment|issued/i, fb: "FB-1424 post-submission steps" },
];

async function main() {
  ensureAdapters();
  let fail = 0;
  for (const c of CASES) {
    const agent = await getAgentBySlug(c.agent);
    if (!agent) throw new Error(`${c.agent} not found`);
    const adapters = resolveAdapters(agent.definition);
    const actx = adapterContext(agent.definition, agent.definition.integrations.knowledge);
    const hits = await adapters.knowledge!.search(actx, { agentId: agent.id, query: c.query, locale: c.locale, limit: 4 });
    const joined = hits.map((h) => h.content).join("\n");
    const ok = hits.length > 0 && c.expect.test(joined);
    console.log(` ${ok ? "PASS" : "FAIL"}  ${c.fb} — "${c.query}" (${hits.length} hits)`);
    if (!ok) { fail++; console.log(`         top: ${joined.slice(0, 160)}`); }
  }
  console.log(fail ? `\n${fail}/${CASES.length} FAILED` : `\nAll ${CASES.length} KB retrieval checks passed.`);
  if (fail) process.exit(1);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
