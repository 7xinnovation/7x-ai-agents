/**
 * Benchmark: model ROUNDS per turn, repeated, with medians.
 *
 * Round count is what actually drives wall-clock — each round is a full model
 * call (~3-5s on the current deployment) — and unlike wall time it is stable
 * enough to compare runs. Wall time is reported too, as a median over N runs,
 * because single samples on a shared endpoint vary by 2-3x.
 *
 * Usage (from apps/web):
 *   npx tsx scripts/bench-rounds.ts [runs]
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";
import { AgentDefinition, emptyCase } from "@dialog/config";
import { getAnthropic, runTurn, resolveAdapters } from "@dialog/core";
import { ensureAdapters } from "../lib/registry";
import { buildApiTools } from "../lib/integrations";

const RUNS = Number(process.argv[2] ?? 3);

const SCENARIOS: { slug: string; label: string; messages: string[] }[] = [
  { slug: "nxn-dialog", label: "NXN rental start", messages: ["I want to rent a personal PO Box", "Dubai"] },
  { slug: "nxn-dialog", label: "NXN renewal", messages: ["I want to renew my PO Box 33417 in Abu Dhabi"] },
  { slug: "epgl-dialog", label: "EPGL new licence", messages: ["Apply for a new courier license"] },
];

function countRounds(): { n: number; reset: () => void } {
  const box = { n: 0 };
  const client = getAnthropic() as unknown as { messages: { stream: (...a: unknown[]) => unknown } };
  const original = client.messages.stream.bind(client.messages);
  client.messages.stream = (...args: unknown[]) => { box.n++; return original(...args); };
  return { get n() { return box.n; }, reset: () => { box.n = 0; } } as { n: number; reset: () => void };
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : Math.round((s[s.length / 2 - 1]! + s[s.length / 2]!) / 2);
};

async function main() {
  ensureAdapters();
  const db = getDb();
  const counter = countRounds();
  console.log(`runs per scenario: ${RUNS}\n`);
  console.log("  scenario                      rounds (per turn)      median total      each run");

  for (const sc of SCENARIOS) {
    const [row] = await db.select().from(agents).where(eq(agents.slug, sc.slug)).limit(1);
    if (!row) continue;
    const def = AgentDefinition.parse(row.definition);
    const adapters = resolveAdapters(def);

    const totals: number[] = [];
    const roundSets: number[][] = [];
    for (let r = 0; r < RUNS; r++) {
      // Fresh tools per run so the lookup cache starts cold, as a real first
      // conversation would; the second turn then exercises the warm path.
      const api = await buildApiTools(row.id, def.activeEnvironment ?? "production", { mockSimulate: true });
      let state = emptyCase();
      const history: { role: "user" | "assistant"; content: string }[] = [];
      const rounds: number[] = [];
      const t0 = Date.now();
      for (const message of sc.messages) {
        counter.reset();
        let text = "";
        for await (const ev of runTurn({
          agent: def, agentId: row.id, caseId: "bench", history, userMessage: message,
          case: state, locale: "en", authenticated: true, adapters,
          extraTools: api.tools, runExtraTool: api.exec,
        })) {
          if (ev.type === "text") text += ev.delta;
          else if (ev.type === "case" || ev.type === "done") state = ev.state;
        }
        history.push({ role: "user", content: message }, { role: "assistant", content: text });
        rounds.push(counter.n);
      }
      totals.push(Date.now() - t0);
      roundSets.push(rounds);
    }
    const roundStr = roundSets[0]!.map((_, i) => median(roundSets.map((rs) => rs[i]!))).join(" + ");
    console.log(
      `  ${sc.label.padEnd(28)} ${roundStr.padEnd(22)} ${String(median(totals) + "ms").padStart(9)}      ` +
      `[${totals.map((t) => `${(t / 1000).toFixed(1)}s`).join(", ")}]`
    );
  }
  console.log("\n  rounds = model calls per turn. Each round is a full round-trip to the model.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
