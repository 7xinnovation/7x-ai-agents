/**
 * Regression test for the "spinner keeps going after the answer" bug (QA,
 * 2026-08-11).
 *
 * The reply finished streaming in ~2.7s and the stream was then held open for
 * ~118 more seconds, so the customer watched a typing indicator for two minutes.
 * Cause: the turn awaited the concurrently-running intent classifier, which
 * competes with the customer's own turn for quota — when it was rate-limited the
 * SDK honoured a 60s retry-after twice.
 *
 * What matters to the customer is the TAIL: how long the stream stays open after
 * the last token. This measures exactly that, over the turns where the classifier
 * runs (before a journey is active).
 *
 * Needs the app running:  npx tsx scripts/test-turn-latency.ts [baseUrl]
 */
const BASE = process.argv[2] ?? "http://localhost:3000";
// The reply is complete; anything beyond this is the customer staring at "…".
const MAX_TAIL_MS = 15_000;

interface TurnTiming { id: string; totalMs: number; firstMs: number | null; lastTokenMs: number | null }

async function turn(message: string, conversationId?: string): Promise<TurnTiming> {
  const t0 = Date.now();
  let firstMs: number | null = null;
  let lastTokenMs: number | null = null;
  let id = conversationId;

  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentSlug: "epgl-dialog", userMessage: message, conversationId, locale: "en" }),
  });
  if (!res.ok || !res.body) throw new Error(`chat failed: ${res.status}`);

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const p of parts) {
      const line = p.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      try {
        const ev = JSON.parse(line.slice(5).trim());
        if (ev.conversationId) id = ev.conversationId;
        if (ev.type === "text") {
          if (firstMs === null) firstMs = Date.now() - t0;
          lastTokenMs = Date.now() - t0;
        }
      } catch { /* keepalive */ }
    }
  }
  return { id: id!, totalMs: Date.now() - t0, firstMs, lastTokenMs };
}

async function main() {
  console.log(`\nTurn latency against ${BASE}\n`);
  // Two turns before any journey exists — exactly when the classifier fires.
  const steps = ["I want to apply for a new courier licence", "Emre Karayalcin, emre.karayalcin@7x.ae"];
  let cid: string | undefined;
  let worstTail = 0;

  for (let i = 0; i < steps.length; i++) {
    const r = await turn(steps[i]!, cid);
    cid = r.id;
    const tail = r.lastTokenMs === null ? r.totalMs : r.totalMs - r.lastTokenMs;
    worstTail = Math.max(worstTail, tail);
    console.log(
      `  turn ${i + 1}: first token ${((r.firstMs ?? 0) / 1000).toFixed(1)}s` +
      `  reply done ${((r.lastTokenMs ?? 0) / 1000).toFixed(1)}s` +
      `  stream closed ${(r.totalMs / 1000).toFixed(1)}s` +
      `  → tail ${(tail / 1000).toFixed(1)}s`
    );
  }

  const ok = worstTail <= MAX_TAIL_MS;
  console.log(
    ok
      ? `\n  PASS  worst tail ${(worstTail / 1000).toFixed(1)}s (limit ${MAX_TAIL_MS / 1000}s)`
      : `\n  FAIL  the stream stayed open ${(worstTail / 1000).toFixed(1)}s after the reply finished`
  );
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });

export {};
