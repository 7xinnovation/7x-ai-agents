/**
 * What the duration cards actually say, through the real chat.
 *
 * Those prices are the one thing a customer checks against emiratespost.ae, and
 * they are assembled from three sources: the bundle's published annual rate,
 * what past reservations have been seen to charge, and — for a term with
 * neither — nothing at all. This drives a conversation as far as the duration
 * question and prints what came back, so the ladder can be read against the
 * reservations that priced it.
 *
 * Reserves nothing and pays nothing. Staging.
 *
 * Run from apps/web:
 *   npx tsx scripts/nxn-duration-cards-2026-09-06.ts --host <url> --token <jwt> --bundle "MyHome Instant"
 */
const arg = (n: string) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : undefined; };
const HOST = (arg("--host") ?? "").replace(/\/$/, "");
const TOKEN = arg("--token")!;
const BUNDLE = arg("--bundle") ?? "MyHome Instant";
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
    "I'd like to rent a new personal PO Box.",
    "Rent a new box.",
    `${BUNDLE} please.`,
    "Dubai.",
    "Dubai Central Post Office.",
    "__BOX__",
    "How long can I rent it for, and what does each option cost?",
  ];
  let box: string | null = null;
  for (const raw of steps) {
    const t = await say(raw === "__BOX__" ? (box ?? "914555") : raw);
    const offered = [...t.matchAll(/\b([49]\d{5})\b/g)].map((m) => m[1]!);
    if (offered.length) box = offered[0]!;
    const cards = /```cards[\s\S]*?```/.exec(t)?.[0] ?? "";
    // A card TITLED as a term, not merely a bundle card quoting a yearly rate.
    if (/^[ \t]*-[ \t]+title[ \t]*:[ \t]*\d{1,2}\s*(?:-|\s)?\s*year/im.test(cards)) {
      console.log(`\n${BUNDLE} — the durations as the customer sees them:\n${cards}`);
      console.log(`\nconversation ${conversationId}`);
      return;
    }
  }
  console.log(`\nNo duration cards were reached. conversation ${conversationId}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
