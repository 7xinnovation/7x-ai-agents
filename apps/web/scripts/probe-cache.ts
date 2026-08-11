/**
 * Does prompt caching actually work through the configured provider?
 *
 * The orchestrator marks the big system prefix and the tool schema
 * `cache_control: ephemeral`, which is only worth anything if the provider
 * honours it. This sends the same large prefix twice and reads the usage
 * counters: a second call reporting cache_read_input_tokens > 0 proves caching
 * is live; all-input-tokens-again proves we are paying full price every round.
 *
 * Usage (from apps/web):
 *   npx tsx scripts/probe-cache.ts            # provider from .env (Azure first)
 *   npx tsx scripts/probe-cache.ts direct     # force the direct Anthropic API
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

if (process.argv[2] === "direct") {
  delete process.env.AZURE_ANTHROPIC_ENDPOINT;
  delete process.env.AZURE_ANTHROPIC_API_KEY;
}

import { getAnthropic, resolveModel } from "@dialog/core";

// Big enough to beat the 1024-token minimum for caching, and stable across calls.
const PREFIX =
  "You are a meticulous assistant for a postal services company. Follow these operating rules exactly.\n" +
  Array.from({ length: 320 }, (_, i) =>
    `Rule ${i + 1}: when handling request type ${i + 1}, confirm the customer's identity, read the record from the system of record, quote only figures returned by a tool, and never invent a reference number.`
  ).join("\n");

async function call(label: string) {
  const client = getAnthropic();
  const t0 = Date.now();
  const res = await client.messages.create({
    model: resolveModel(),
    max_tokens: 16,
    system: [{ type: "text", text: PREFIX, cache_control: { type: "ephemeral" } }] as never,
    messages: [{ role: "user", content: "Reply with the single word: ok" }],
  });
  const u = res.usage as unknown as Record<string, number>;
  console.log(
    `  ${label.padEnd(8)} ${String(Date.now() - t0).padStart(5)}ms   ` +
    `input:${String(u.input_tokens ?? 0).padStart(6)}  ` +
    `cache_write:${String(u.cache_creation_input_tokens ?? 0).padStart(6)}  ` +
    `cache_read:${String(u.cache_read_input_tokens ?? 0).padStart(6)}  ` +
    `output:${String(u.output_tokens ?? 0).padStart(4)}`
  );
  return u;
}

async function main() {
  const provider = process.env.AZURE_ANTHROPIC_ENDPOINT ? "AZURE AI Foundry passthrough" : "direct Anthropic API";
  console.log(`provider: ${provider}\nmodel:    ${resolveModel()}\nprefix:   ~${Math.round(PREFIX.length / 3.7)} tokens\n`);
  await call("warm-up");   // may create the cache entry
  const second = await call("repeat");
  const read = second.cache_read_input_tokens ?? 0;
  console.log();
  if (read > 0) {
    console.log(`  RESULT: prompt caching IS working — ${read} tokens served from cache on the repeat call.`);
  } else {
    console.log("  RESULT: prompt caching is NOT working through this provider.");
    console.log("          Every tool round re-pays the full system prompt + tool schema.");
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error("probe failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
