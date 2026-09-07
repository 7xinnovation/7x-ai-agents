/**
 * What the chat offers when a personal box is upgraded at renewal.
 *
 * Emirates Post prices two different things and their portal leads with the
 * first: change the bundle and keep the expiry, or change it and extend. This
 * drives the conversation to the point where the choice should appear and
 * prints what came back.
 *
 * Prices only — it stops before the save, so no order and no payment.
 *
 * Run from apps/web:
 *   npx tsx scripts/nxn-renewal-upgrade-live-2026-09-07.ts --host <url> --token <jwt> --box 911933
 */
const arg = (n: string) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : undefined; };
const HOST = (arg("--host") ?? "").replace(/\/$/, "");
const TOKEN = arg("--token")!;
const BOX = arg("--box") ?? "911933";
if (!HOST || !TOKEN) throw new Error("--host and --token are both required");
let conversationId: string | undefined;

async function say(userMessage: string): Promise<string> {
  const res = await fetch(`${HOST}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentSlug: "nxn-dialog", userMessage, conversationId, locale: "en", authenticated: true, uaePassToken: TOKEN }),
  });
  if (!res.ok || !res.body) throw new Error(`chat ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, i); buf = buf.slice(i + 2);
      const line = frame.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      try {
        const ev = JSON.parse(line.slice(5));
        if (ev.type === "text") text += ev.delta;
        if (ev.conversationId) conversationId = ev.conversationId;
      } catch { /* not ours */ }
    }
  }
  return text;
}

async function main() {
  const steps = [
    "I want to renew my PO Box.",
    `Box ${BOX}, Dubai.`,
    "I'd like to upgrade to MyHome Instant.",
    "What are my options and what does each cost?",
  ];
  for (const s of steps) {
    const t = await say(s);
    console.log(`\n>>> ${s}\n${t.trim().slice(0, 1800)}`);
    // Stop the moment money is on screen: this must never reach a payment.
    if (/```\s*pay/i.test(t)) { console.log("\n(stopping: a payment block appeared)"); break; }
  }
  console.log(`\nconversation ${conversationId}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
