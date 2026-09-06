/**
 * The whole PO Box rental journey, driven through the real chat endpoint.
 *
 * Not a unit test and not a mock: it posts to /api/chat on the deployed site,
 * reads the SSE stream back, and checks what the customer would actually see at
 * each step against the Phase 1 list Emirates Post signed off. Everything up to
 * the card can be verified this way — the card itself needs a human, and the
 * order it leaves behind is real and unpaid, so run it on staging only.
 *
 * Run from apps/web:
 *   npx tsx scripts/nxn-e2e-rental-2026-09-05.ts --host <url> --token <ep jwt> [--journey personal|corporate]
 */
export {}; // a module, so its locals do not collide with the other scripts

const cliArg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const HOST = (cliArg("--host") ?? "").replace(/\/$/, "");
const VERBOSE = process.argv.includes("--verbose");
/** Which bundle to walk. MyHome is delivered, so it exercises the address path. */
const BUNDLE = cliArg("--bundle") ?? "MyBox";
const KEY_COURIER = BUNDLE.toLowerCase().startsWith("mybox");
const TOKEN = cliArg("--token");
if (!HOST) throw new Error("--host <https://…> is required");
if (!TOKEN) throw new Error("--token <the customer's Emirates Post session jwt> is required");

let conversationId: string | undefined;
let pass = 0;
let fail = 0;
const failures: string[] = [];

/** One turn. Returns everything the customer would have seen. */
async function say(userMessage: string, extra: Record<string, unknown> = {}): Promise<string> {
  const res = await fetch(`${HOST}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agentSlug: "nxn-dialog",
      userMessage,
      conversationId,
      locale: "en",
      authenticated: true,
      uaePassToken: TOKEN,
      ...extra,
    }),
  });
  if (!res.ok || !res.body) throw new Error(`chat ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const line = frame.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      let ev: Record<string, any>;
      try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }
      if (ev.type === "session" && ev.conversationId) conversationId = ev.conversationId;
      else if (ev.type === "text") text += ev.delta;
      else if (ev.type === "error") text += `\n[ERROR] ${ev.message}\n`;
    }
  }
  return text;
}

const check = (name: string, ok: boolean, detail = "") => {
  if (ok) { pass++; console.log(`    ok   ${name}`); }
  else { fail++; failures.push(name); console.log(`    FAIL ${name}${detail ? `\n         ${detail}` : ""}`); }
};

/**
 * What a customer would say next.
 *
 * A fixed script breaks the moment the agent asks the same things in a
 * different order — which it legitimately may — and then the run reports
 * failures that are the script's, not the product's. So the reply is chosen
 * from what was actually asked, most specific first, and each line is used at
 * most once so a repeated question ends the run rather than looping.
 */
const REPLIES: { when: RegExp; say: string; once?: boolean }[] = [
  { when: /rent a new box|not renew or manage|add another one/i, say: "Yes, rent a new box.", once: true },
  { when: /saved visa|different card|how would you like to pay/i, say: "Pay with my saved Visa ending 1111." },
  { when: /```\s*toggles/i, say: "Save my card for future payments: Yes. Renew my box automatically next year: Yes. I accept the Terms and Conditions: Yes. Proceed to payment." },
  { when: /which plan|bundle|mybox/i, say: `${BUNDLE} please.`, once: true },
  { when: /which emirate|emirate of the/i, say: "Dubai.", once: true },
  { when: /branch|post office/i, say: "Al Barsha Post Office.", once: true },
  { when: /box number|pick (a|another) number|available box/i, say: "__BOX__", once: true },
  { when: /how long|duration|rental period/i, say: cliArg("--years") ? `${cliArg("--years")} Years.` : "2 Years.", once: true },
  { when: /authoris?ed agent|add an agent/i, say: "No agent, thank you.", once: true },
  { when: /key.*(collect|courier|deliver)/i, say: KEY_COURIER ? "Please deliver the key by courier." : "Collect it at the branch, thanks.", once: true },
  { when: /area|address|street|villa|apartment/i, say: "Apt 2, 17d Street, Garhoud, Dubai. That area is correct.", once: true },
  { when: /phone|mobile|email/i, say: "0553708434 and emre.karayalcin@7x.ae.", once: true },
  { when: /does (that|everything) look|confirm|correct\?|proceed/i, say: "Yes, that is correct. Please proceed." },
];

/** Money as the customer reads it: "AED 1,234.00" or "AED 1234". */
function amounts(text: string): number[] {
  return [...text.matchAll(/AED\s*([\d,]+(?:\.\d{1,2})?)/gi)].map((m) => Number(m[1]!.replace(/,/g, "")));
}

async function main() {
  console.log(`\n${HOST} · nxn-dialog · ${BUNDLE}, driven end to end\n`);

  const used = new Set<number>();
  const turns: string[] = [];
  let box: string | null = null;

  let t = await say("I'd like to rent a new personal PO Box.");
  turns.push(t);
  if (VERBOSE) console.log(`\n  --- agent (opening) ---\n${t.trim().slice(0, 1200)}`);

  for (let turn = 0; turn < 16; turn++) {
    if (/paypage\.|```\s*pay/i.test(t)) break;
    const offered = [...t.matchAll(/\b([49]\d{5})\b/g)].map((m) => m[1]!);
    if (offered.length) box = offered[0]!;
    const idx = REPLIES.findIndex((r, n) => r.when.test(t) && !(r.once && used.has(n)));
    if (idx === -1) { console.log(`\n  [no scripted reply for]\n${t.slice(-500)}`); break; }
    if (REPLIES[idx]!.once) used.add(idx);
    const reply = REPLIES[idx]!.say.replace("__BOX__", box ?? "450571");
    if (VERBOSE) console.log(`\n  --- agent ---\n${t.trim().slice(0, 900)}\n  --- customer ---\n  ${reply}`);
    t = await say(reply);
    turns.push(t);
  }

  const all = turns.join("\n");
  const last = turns[turns.length - 1] ?? "";
  // The bundle cards may not be the first reply — a customer who already holds
  // boxes is asked about those first — so the card checks find their own turn.
  const cards = turns.find((x) => /```\s*cards/i.test(x) && /\/\s*year/i.test(x)) ?? "";

  console.log("  the plans");
  check("the plans were offered as cards", Boolean(cards), "no bundle cards in the whole run");
  check("the registration fee is named on them", /registration fee/i.test(cards), cards.slice(0, 400));
  check("...with its amount, AED 70", amounts(cards).includes(70), `saw ${amounts(cards).join(", ") || "no amounts"}`);

  console.log("\n  the journey");
  check("durations were priced, not just dated", /\d\s*year/i.test(all) && amounts(all).some((a) => a === 670 || a === 370));
  if (KEY_COURIER) check("the courier fee was shown", amounts(all).includes(30), "AED 30 never appeared");
  else check("no courier was charged on a delivered bundle", !/key (courier|delivery).*AED\s*30/i.test(all));
  check("the box was reserved", /reserv|held/i.test(all));

  console.log("\n  before payment");
  check("one toggles block, not two", (all.match(/```\s*toggles/gi) ?? []).length <= 1);
  check("the Terms rode with it as a checkbox", /checkboxes:\s*terms_accepted/i.test(all) || /terms and conditions/i.test(all));
  check("a payment page was reached", /paypage\.|```\s*pay/i.test(last), last.slice(-400));
  // The card's footer against the button's figure — NOT every amount in the
  // reply, which legitimately includes each line of the breakdown.
  const totalLine = /^[ \t]*total[ \t]*:[ \t]*AED\s*([\d,]+(?:\.\d{1,2})?)/im.exec(last);
  const payLine = /^[ \t]*amount[ \t]*:[ \t]*AED\s*([\d,]+(?:\.\d{1,2})?)/im.exec(last);
  const num = (m: RegExpExecArray | null) => (m ? Number(m[1]!.replace(/,/g, "")) : null);
  check("the card carries a total", num(totalLine) !== null, last.slice(-400));
  check("the summary total and the pay button are the same number",
    num(totalLine) !== null && num(totalLine) === num(payLine),
    `card ${num(totalLine)}, button ${num(payLine)}`);
  const want = Number(cliArg("--expect") ?? (KEY_COURIER ? 700 : 0));
  if (want) check(`that total is the expected AED ${want}`, num(totalLine) === want, `card total ${num(totalLine)}`);

  console.log("\n  what a customer must never see");
  check("no internal identifier", !/officeid|uniqueboxid|bundle_id|entcode/i.test(all));
  check("no claim that the payment already happened", !/payment (went through|was successful|has been taken)/i.test(all));
  check("no invented invoice link", !/users\/api\/Invoice/i.test(all));

  const url = /https:\/\/paypage\.[^\s)"']+/.exec(last)?.[0];
  console.log(`\n${pass} passed, ${fail} failed`);
  if (failures.length) console.log(`failed: ${failures.join(" · ")}`);
  console.log(`conversation ${conversationId}`);
  if (url) console.log(`\nPAY HERE TO FINISH THE RUN:\n  ${url}`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
