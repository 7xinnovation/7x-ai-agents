/**
 * Per-ROUND profile of a real turn, with the real agent definition.
 *
 * diagnose-latency.ts measures what the customer feels; this measures WHY, by
 * wrapping the Anthropic client and recording, for every model round: wall
 * time, input tokens, cache writes and cache READS. A cache_read of 0 on a
 * round that should have been warm is the difference between a ~1.5s round and
 * a ~3s one, so this is the number that decides where the time goes.
 *
 * Usage (from apps/web):
 *   npx tsx scripts/profile-turn.ts nxn-dialog "I want to rent a personal PO Box"
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";
import { AgentDefinition, emptyCase } from "@dialog/config";
import { getAnthropic, resolveModel, runTurn, resolveAdapters } from "@dialog/core";
import { ensureAdapters } from "../lib/registry";
import { buildApiTools } from "../lib/integrations";

const SLUG = process.argv[2] ?? "nxn-dialog";
const MESSAGES = process.argv.slice(3);
if (!MESSAGES.length) MESSAGES.push("I want to rent a personal PO Box");

interface RoundStat { ms: number; input: number; write: number; read: number; output: number; tools: string[] }

/** Wrap client.messages.stream so every round's usage + timing is recorded. */
function instrument(): RoundStat[] {
  const stats: RoundStat[] = [];
  const client = getAnthropic() as unknown as { messages: { stream: (...a: unknown[]) => unknown } };
  const original = client.messages.stream.bind(client.messages);
  client.messages.stream = (...args: unknown[]) => {
    const t0 = Date.now();
    const stream = original(...args) as { finalMessage: () => Promise<{ usage: Record<string, number> }> };
    const originalFinal = stream.finalMessage.bind(stream);
    stream.finalMessage = async () => {
      const msg = await originalFinal();
      const u = (msg.usage ?? {}) as Record<string, number>;
      const content = (msg as unknown as { content?: { type: string; name?: string }[] }).content ?? [];
      stats.push({
        ms: Date.now() - t0,
        input: u.input_tokens ?? 0,
        write: u.cache_creation_input_tokens ?? 0,
        read: u.cache_read_input_tokens ?? 0,
        output: u.output_tokens ?? 0,
        tools: content.filter((c) => c.type === "tool_use").map((c) => c.name ?? "?"),
      });
      return msg;
    };
    return stream;
  };
  return stats;
}

async function main() {
  ensureAdapters();
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`${SLUG} not found`);
  const def = AgentDefinition.parse(row.definition);
  const adapters = resolveAdapters(def);
  const api = await buildApiTools(row.id, def.activeEnvironment ?? "production", { mockSimulate: true });

  console.log(`agent: ${SLUG}   model: ${resolveModel(def.model)}   integration tools: ${api.tools.length}\n`);
  const stats = instrument();

  let state = emptyCase();
  const history: { role: "user" | "assistant"; content: string }[] = [];

  for (const message of MESSAGES) {
    const before = stats.length;
    const t0 = Date.now();
    let text = "";
    let firstMs: number | null = null;
    for await (const ev of runTurn({
      agent: def, agentId: row.id, caseId: "profile-case", history, userMessage: message,
      case: state, locale: "en", authenticated: true, adapters,
      extraTools: api.tools, runExtraTool: api.exec,
    })) {
      if (ev.type === "text") { firstMs ??= Date.now() - t0; text += ev.delta; }
      else if (ev.type === "case") state = ev.state;
      else if (ev.type === "done") state = ev.state;
    }
    const total = Date.now() - t0;
    history.push({ role: "user", content: message }, { role: "assistant", content: text });

    const rounds = stats.slice(before);
    console.log(`▸ "${message}"   total ${total}ms   first token ${firstMs ?? "-"}ms   rounds: ${rounds.length}`);
    rounds.forEach((r, i) => {
      const cached = r.read > 0;
      console.log(
        `    round ${i + 1}: ${String(r.ms).padStart(5)}ms   ` +
        `in:${String(r.input).padStart(5)}  write:${String(r.write).padStart(6)}  read:${String(r.read).padStart(6)}  out:${String(r.output).padStart(4)}   ` +
        `${cached ? "CACHE HIT" : r.write > 0 ? "cache write (cold)" : "NO CACHE"}` +
        (r.tools.length ? `   tools: ${r.tools.join(", ")}` : "   (final text)")
      );
    });
    const billed = rounds.reduce((n, r) => n + r.input + r.write + r.read, 0);
    console.log(`    → ${rounds.length} model round(s), ${billed} prompt tokens moved, ${rounds.reduce((n, r) => n + r.ms, 0)}ms in the model\n`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
