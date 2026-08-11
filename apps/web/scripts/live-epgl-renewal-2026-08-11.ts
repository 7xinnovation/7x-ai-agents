/**
 * Live behavioural check for the "Renewal AI Process Feedback" round.
 *
 * Replays the exact exchange from the feedback screenshot — a company whose
 * licensing period starts at Q3, being asked over and over for "Q1" — plus the
 * batch-upload and phone-format behaviour.
 *
 * Needs the app running:  npx tsx scripts/live-epgl-renewal-2026-08-11.ts [baseUrl]
 */
const BASE = process.argv[2] ?? "http://localhost:3000";

async function chat(userMessage: string, conversationId?: string, locale = "en") {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentSlug: "epgl-dialog", userMessage, conversationId, locale }),
  });
  if (!res.ok || !res.body) throw new Error(`chat failed: ${res.status}`);
  let text = "";
  let convId = conversationId;
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
        if (typeof ev.delta === "string") text += ev.delta;
        if (ev.conversationId) convId = ev.conversationId;
      } catch { /* keepalive */ }
    }
  }
  if (!text.trim()) throw new Error("empty reply");
  return { text, conversationId: convId };
}

let pass = 0, fail = 0;
const check = (item: string, name: string, ok: boolean, detail = "") => {
  if (ok) { pass++; console.log(`  ✓ [${item}] ${name}`); }
  else { fail++; console.log(`  ✗ [${item}] ${name}${detail ? ` — ${detail}` : ""}`); }
};

async function main() {
  console.log(`\nLive renewal checks against ${BASE}\n`);

  console.log("Turn 1 — starting a renewal");
  const t1 = await chat("I want to renew my postal activity licence");
  console.log(`\n${t1.text}\n`);
  const uploads = (t1.text.match(/```\s*upload/g) ?? []).length;
  check("1", "offers the documents as a batch, not one at a time", uploads >= 2, `${uploads} upload block(s)`);
  check("8", "asks for the Form 9", /form\s*0?9/i.test(t1.text));
  check("8", "asks for the audited financial statements",
    /audited|AFS/i.test(t1.text));

  console.log("Turn 2 — the licence period does not start in January");
  const t2 = await chat(
    "My licence period runs from July 2023. The financial year is 2023-2024.",
    t1.conversationId
  );
  console.log(`\n${t2.text}\n`);
  check("6", "recognises the period starts at Q3", /Q3/.test(t2.text));
  check("6", "does not label the first quarter as Q1 of a calendar year",
    !/\bQ1\s*[—-]\s*2023\b/.test(t2.text), "still mapped the period's first quarter to Q1 2023");

  console.log("Turn 3 — the exact exchange from the screenshot");
  const t3 = await chat("my first quarter is Q3 2023, revenue 2000000", t2.conversationId);
  console.log(`\n${t3.text}\n`);
  check("6", "does not keep asking for \"Q1\" after being told",
    !/what was the leviable income for \*?\*?Q1\*?\*?\s*\(AED\)/i.test(t3.text),
    "re-asked for Q1 verbatim");
  check("6", "names the next quarter with its calendar label and year",
    /Q4\s*20\d\d|Q1\s*2024/.test(t3.text));

  console.log("Turn 4 — a non-UAE phone number");
  const t4 = await chat("The accountant is Sara Nasser, sara@example.ae, phone +44 7700 900123", t3.conversationId);
  console.log(`\n${t4.text}\n`);
  check("4", "refuses a foreign number and asks for a UAE one",
    /UAE|971|05\d/.test(t4.text) && !/thanks.*recorded.*\+44/i.test(t4.text));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });

export {};
