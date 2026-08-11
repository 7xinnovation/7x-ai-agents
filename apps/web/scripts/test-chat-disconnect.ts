/**
 * Regression test for `chat_stream_failed: Invalid state: Controller is already
 * closed` (production, NXN, Aug 2026).
 *
 * When the browser drops the SSE connection mid-turn, the stream is cancelled and
 * its controller closes. The route tracked only its OWN close flag, so the next
 * send() threw — aborting the turn before appendMessage()/saveCase() ran. The
 * customer lost the assistant's reply and everything collected that turn, and had
 * to repeat it, which reads as "the chat is slow".
 *
 * This starts a real turn, hangs up as soon as the first token arrives, then
 * checks the server still finished and persisted the turn.
 *
 * Needs the app running:  npx tsx scripts/test-chat-disconnect.ts [baseUrl]
 */
const BASE = process.argv[2] ?? "http://localhost:3000";
const AGENT = process.env.AGENT_SLUG ?? "nxn-dialog";

async function conversationMessages(id: string): Promise<number> {
  const res = await fetch(`${BASE}/api/conversations/${id}`);
  if (!res.ok) return -1;
  const json = (await res.json()) as { messages?: unknown[] };
  return json.messages?.length ?? -1;
}

async function main() {
  const ctrl = new AbortController();
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentSlug: AGENT, userMessage: "I want to rent a new PO box in Dubai", locale: "en" }),
    signal: ctrl.signal,
  });
  if (!res.ok || !res.body) throw new Error(`chat failed: ${res.status}`);

  let conversationId = "";
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";

  // Read until the first token, then hang up exactly like a closed tab.
  outer: for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    for (const part of buf.split("\n\n")) {
      const line = part.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      let ev: any;
      try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }
      if (ev.conversationId) conversationId = ev.conversationId;
      if (ev.type === "text" && conversationId) {
        console.log(`  first token received — dropping the connection (conversation ${conversationId})`);
        ctrl.abort();
        break outer;
      }
    }
  }

  if (!conversationId) throw new Error("never received a conversation id");

  // The turn keeps running server-side; give it room to finish and persist.
  const deadline = Date.now() + 120_000;
  let count = -1;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    count = await conversationMessages(conversationId);
    if (count >= 2) break;
  }

  // user message + assistant reply
  const ok = count >= 2;
  console.log(
    ok
      ? `  PASS  turn survived the disconnect — ${count} messages persisted`
      : `  FAIL  turn was lost — ${count} message(s) persisted, expected the assistant reply too`
  );
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });

export {};
