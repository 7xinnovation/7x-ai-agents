/**
 * Speaks through a running deployment and reports what came back: which
 * engine, which voice, how long to the first byte, how much audio.
 *
 *   npx tsx scripts/probe-voice-speak-2026-11-02.ts                       # staging
 *   npx tsx scripts/probe-voice-speak-2026-11-02.ts https://agent.7x.ae    # production
 *   npx tsx scripts/probe-voice-speak-2026-11-02.ts http://localhost:3000 --engine realtime
 *
 * Exits 1 if any utterance fails, or if an engine was asked for and a
 * different one answered.
 */
const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:\/\//.test(a)) ?? "https://7xagents.7x-lab.com").replace(/\/$/, "");
const engineAt = args.indexOf("--engine");
const engine = engineAt >= 0 ? args[engineAt + 1] : undefined;

const EN_SHORT = "Of course. Your PO Box renewal for one year is AED 695 including VAT.";
const EN_LONG = "Your PO Box number twelve thousand three hundred and forty-five at the Deira Main branch in Dubai expired on the thirtieth of September, and it is currently in its grace period, which means your mail is still being held for you but no new items can be delivered after the fifteenth of November.";
const AR = "بالتأكيد. رسوم تجديد صندوق البريد لسنة واحدة هي 695 درهماً شاملة ضريبة القيمة المضافة.";

interface Row { label: string; status: number; engine: string; voice: string; cache: string; firstByteMs: number; totalMs: number; seconds: number; error?: string }

async function speak(label: string, text: string, locale: "en" | "ar"): Promise<Row> {
  const t0 = performance.now();
  let res: Response;
  try {
    res = await fetch(`${base}/api/nxn/voice/speak`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, locale, ...(engine ? { engine } : {}) }),
      signal: AbortSignal.timeout(90000),
    });
  } catch (e) {
    return { label, status: 0, engine: "", voice: "", cache: "", firstByteMs: 0, totalMs: 0, seconds: 0, error: e instanceof Error ? e.message : String(e) };
  }
  const first = performance.now();
  const row: Row = {
    label, status: res.status,
    engine: res.headers.get("x-voice-engine") ?? "",
    voice: res.headers.get("x-voice-name") ?? "",
    cache: res.headers.get("x-voice-cache") ?? "",
    firstByteMs: Math.round(first - t0), totalMs: 0, seconds: 0,
  };
  if (!res.ok || !res.body) { row.error = (await res.text().catch(() => "")).slice(0, 160); return row; }
  const reader = res.body.getReader();
  let bytes = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; bytes += value.length; }
  row.totalMs = Math.round(performance.now() - t0);
  row.seconds = +(bytes / 48000).toFixed(1);
  return row;
}

console.log(`speak probe → ${base}${engine ? ` (engine asked: ${engine})` : ""}\n`);
const rows: Row[] = [];
rows.push(await speak("en short", EN_SHORT, "en"));
rows.push(await speak("en short again (cache?)", EN_SHORT, "en"));
rows.push(await speak("en long", EN_LONG, "en"));
rows.push(await speak("ar", AR, "ar"));
console.table(rows.map(({ label, status, engine: e, voice, cache, firstByteMs, totalMs, seconds, error }) => ({ label, status, engine: e, voice, cache, firstByteMs, totalMs, seconds, ...(error ? { error } : {}) })));

const bad = rows.filter((r) => r.status !== 200 || r.seconds <= 0 || (engine && r.engine !== engine));
if (bad.length) { console.log(`\n${bad.length} utterance(s) did not come back as expected.`); process.exit(1); }
console.log("\nall utterances spoke.");
