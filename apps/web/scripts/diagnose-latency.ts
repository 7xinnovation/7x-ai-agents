/**
 * Latency diagnosis for the live agents (NXN + EPGL).
 *
 * Answers, with measurements rather than intuition:
 *   1. How big is the per-ROUND payload each agent sends? The system prompt and
 *      the tool schemas are re-sent on every tool round, so their size is paid
 *      once per round, not once per turn.
 *   2. How many tool rounds does a typical turn take?
 *   3. Where does wall-clock actually go — time to first token, streaming, and
 *      the TAIL after the last token (the part the customer experiences as a
 *      spinner that will not stop).
 *
 * Usage (from apps/web):
 *   npx tsx scripts/diagnose-latency.ts [baseUrl]
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";
import { AgentDefinition, emptyCase } from "@dialog/config";
import { buildSystemPrompt } from "@dialog/core";
import { buildApiTools } from "../lib/integrations";

const BASE = process.argv[2] ?? "https://7xagents.7x-lab.com";
const TOK = (chars: number) => Math.round(chars / 3.7); // rough chars→tokens

async function payloadProfile(slug: string) {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, slug)).limit(1);
  if (!row) throw new Error(`${slug} not found`);
  const def = AgentDefinition.parse(row.definition);

  const api = await buildApiTools(row.id, def.activeEnvironment ?? "production", {});
  const toolJson = JSON.stringify(api.tools);

  // Prompt with the biggest journey active — the realistic mid-journey case.
  const biggest = [...def.journeys].sort(
    (a, b) => (b.guidance?.length ?? 0) - (a.guidance?.length ?? 0)
  )[0];
  const state = { ...emptyCase(), journeyKey: biggest?.key ?? null };
  const p = buildSystemPrompt(def, state as never, "en", true, true, undefined, undefined);

  const perRound = toolJson.length + p.stable.length + p.volatile.length;
  return {
    slug,
    integrationTools: api.tools.length,
    toolChars: toolJson.length,
    stableChars: p.stable.length,
    volatileChars: p.volatile.length,
    biggestJourney: biggest?.key,
    guidanceChars: biggest?.guidance?.length ?? 0,
    perRound,
    perRoundTokens: TOK(perRound),
  };
}

interface Timing {
  label: string;
  conversationId?: string;
  totalMs: number;
  firstTokenMs: number | null;
  lastTokenMs: number | null;
  tailMs: number | null;
  toolRounds: number;
  integrationCalls: string[];
  chars: number;
}

async function turn(slug: string, message: string, conversationId?: string, extra: Record<string, unknown> = {}): Promise<Timing> {
  const t0 = Date.now();
  let firstTokenMs: number | null = null;
  let lastTokenMs: number | null = null;
  let chars = 0;
  const integrationCalls: string[] = [];
  let id = conversationId;

  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentSlug: slug, userMessage: message, conversationId, locale: "en", ...extra }),
  });
  if (!res.ok || !res.body) throw new Error(`chat ${slug} failed: ${res.status}`);

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      try {
        const ev = JSON.parse(line.slice(5).trim());
        if (ev.conversationId) id = ev.conversationId;
        if (ev.type === "text") {
          firstTokenMs ??= Date.now() - t0;
          lastTokenMs = Date.now() - t0;
          chars += (ev.delta as string).length;
        } else if (ev.type === "integration") {
          integrationCalls.push(ev.tool as string);
        }
      } catch { /* partial */ }
    }
  }
  const totalMs = Date.now() - t0;
  return {
    label: message.slice(0, 44),
    conversationId: id,
    totalMs,
    firstTokenMs,
    lastTokenMs,
    tailMs: lastTokenMs === null ? null : totalMs - lastTokenMs,
    toolRounds: integrationCalls.length,
    integrationCalls,
    chars,
  };
}

const ms = (v: number | null) => (v === null ? "   n/a" : `${String(v).padStart(6)}`);

async function main() {
  console.log(`base: ${BASE}\n`);
  console.log("── Per-ROUND payload (re-sent on every tool round) ──");
  for (const slug of ["nxn-dialog", "epgl-dialog"]) {
    const p = await payloadProfile(slug);
    console.log(
      `  ${p.slug.padEnd(12)} tools:${String(p.integrationTools).padStart(3)}  ` +
      `toolSchema:${String(Math.round(p.toolChars / 1024)).padStart(3)}KB  ` +
      `stable:${String(Math.round(p.stableChars / 1024)).padStart(2)}KB  ` +
      `volatile:${String(Math.round(p.volatileChars / 1024)).padStart(2)}KB  ` +
      `=> ~${String(p.perRoundTokens).padStart(6)} tok/round   (biggest journey ${p.biggestJourney}, guidance ${p.guidanceChars}c)`
    );
  }

  console.log("\n── Live turns ──");
  console.log("  agent        turn                                          total  1st tok  lastTok    TAIL  toolcalls");
  const scenarios: [string, string[], Record<string, unknown>][] = [
    ["nxn-dialog", ["hi", "I want to rent a personal PO Box", "Dubai"], { mock: true }],
    ["epgl-dialog", ["hi", "Apply for a new courier license"], {}],
  ];
  for (const [slug, msgs, extra] of scenarios) {
    let cid: string | undefined;
    for (const m of msgs) {
      try {
        const t = await turn(slug, m, cid, extra);
        cid = t.conversationId;
        console.log(
          `  ${slug.padEnd(12)} ${t.label.padEnd(45)} ${ms(t.totalMs)} ${ms(t.firstTokenMs)} ${ms(t.lastTokenMs)} ${ms(t.tailMs)}   ${t.toolRounds}` +
          (t.integrationCalls.length ? `  [${t.integrationCalls.map((c) => c.split("__").pop()).join(", ")}]` : "")
        );
      } catch (e) {
        console.log(`  ${slug.padEnd(12)} ${m.padEnd(45)} FAILED: ${e instanceof Error ? e.message : e}`);
      }
    }
  }
  console.log("\n  TAIL = stream held open after the last token (pure dead time for the customer).");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
