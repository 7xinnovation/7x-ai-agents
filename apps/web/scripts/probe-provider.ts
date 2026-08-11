/**
 * Is the model endpoint itself the bottleneck?
 *
 * Turn latency swings 2-3x between identical runs, which prompt or tool changes
 * cannot explain. This measures the provider directly, with our own code out of
 * the way:
 *   1. SEQUENTIAL identical calls  → baseline latency and its spread.
 *   2. CONCURRENT calls            → whether parallel requests (a real chat has
 *      the customer's turn plus the intent classifier in flight at once) get
 *      throttled or serialised.
 * Any 429 / retry-after is reported: that is a quota ceiling, and no amount of
 * prompt engineering moves it — it needs a bigger deployment.
 *
 * Usage (from apps/web):  npx tsx scripts/probe-provider.ts [n]
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import { getAnthropic, resolveModel } from "@dialog/core";

const N = Number(process.argv[2] ?? 6);

async function one(tag: string): Promise<{ ms: number; err?: string; status?: number; retryAfter?: string }> {
  const client = getAnthropic();
  const t0 = Date.now();
  try {
    await client.messages.create(
      {
        model: resolveModel(),
        max_tokens: 32,
        messages: [{ role: "user", content: `Count to three. (${tag})` }],
      },
      { maxRetries: 0, timeout: 60_000 }
    );
    return { ms: Date.now() - t0 };
  } catch (e) {
    const err = e as { status?: number; message?: string; headers?: Record<string, string> };
    return {
      ms: Date.now() - t0,
      err: (err.message ?? String(e)).slice(0, 90),
      status: err.status,
      retryAfter: err.headers?.["retry-after"],
    };
  }
}

const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return {
    min: s[0] ?? 0,
    med: s.length % 2 ? s[(s.length - 1) / 2]! : Math.round((s[s.length / 2 - 1]! + s[s.length / 2]!) / 2),
    max: s[s.length - 1] ?? 0,
  };
};

async function main() {
  console.log(`provider: ${process.env.AZURE_ANTHROPIC_ENDPOINT ? "Azure AI Foundry" : "direct Anthropic"}`);
  console.log(`model:    ${resolveModel()}\n`);

  console.log(`── ${N} SEQUENTIAL minimal calls ──`);
  const seq: number[] = [];
  for (let i = 0; i < N; i++) {
    const r = await one(`seq${i}`);
    seq.push(r.ms);
    console.log(`  ${String(i + 1).padStart(2)}: ${String(r.ms).padStart(6)}ms` +
      (r.err ? `   ERROR ${r.status ?? ""} ${r.err}${r.retryAfter ? ` (retry-after ${r.retryAfter}s)` : ""}` : ""));
  }
  const s = stats(seq);
  console.log(`  min ${s.min}ms  median ${s.med}ms  max ${s.max}ms   spread ${(s.max / Math.max(s.min, 1)).toFixed(1)}x`);

  console.log(`\n── ${N} CONCURRENT calls (all at once) ──`);
  const t0 = Date.now();
  const results = await Promise.all(Array.from({ length: N }, (_, i) => one(`par${i}`)));
  const wall = Date.now() - t0;
  const errs = results.filter((r) => r.err);
  const par = stats(results.map((r) => r.ms));
  results.forEach((r, i) =>
    console.log(`  ${String(i + 1).padStart(2)}: ${String(r.ms).padStart(6)}ms` +
      (r.err ? `   ERROR ${r.status ?? ""} ${r.err}${r.retryAfter ? ` (retry-after ${r.retryAfter}s)` : ""}` : ""))
  );
  console.log(`  wall ${wall}ms for ${N} in parallel   min ${par.min}ms  median ${par.med}ms  max ${par.max}ms`);
  console.log(`  errors: ${errs.length}${errs.length ? "  ← throttling / quota ceiling" : ""}`);

  console.log("\n  Read: if concurrent latency is much worse than sequential, or any call 429s,");
  console.log("  the deployment's throughput is the ceiling — prompt/tool changes cannot fix that.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
