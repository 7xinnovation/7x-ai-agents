/**
 * A FENCE MUST OPEN AT THE START OF A LINE, whatever a guard removed above it.
 *
 * 18 September, from the app. The reply reached the customer as
 *
 *   How long would you like to rent the box? ```cards
 *     • title: 1 Year
 *       price: AED 370.00
 *
 * — the fence in the middle of a line, so it never opened a block, so the
 * duration cards arrived as literal text and bullets.
 *
 * The model had written it correctly. What it wrote was:
 *
 *   "How long would you like to rent the box? Let me fetch the prices for each
 *    option.\n\n```cards\n…"
 *
 * The second sentence is an announcement of work the widget already shows, so
 * the narration guard drops it — and it dropped the "\n\n" with it, because a
 * sentence has always been removed together with its trailing whitespace. That
 * was harmless while the sentences being dropped sat mid-paragraph. Announcing
 * a lookup is not mid-paragraph: its natural home is the line immediately
 * before the block the lookup produced.
 *
 * So this is the invariant, tested across both streaming guards and every chunk
 * size: whatever they take out, a fence still starts a line.
 *
 * Run from apps/web:  npx tsx scripts/test-fence-survives-2026-09-18.ts
 */
import { narrationGuard, keptSeparator } from "../lib/narrationGuard";
import { echoGuard } from "../lib/echoGuard";
import { openFencesOnTheirOwnLine } from "../app/embed/[agent]/Markdown";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : ` — ${JSON.stringify(got)}`}`); }
};

const GUARDS = [
  ["narration", narrationGuard as () => { push(s: string): string; flush(): string }],
  ["echo", echoGuard as () => { push(s: string): string; flush(): string }],
] as const;

const stream = (mk: () => { push(s: string): string; flush(): string }, text: string, chunk: number) => {
  const g = mk();
  let out = "";
  for (let i = 0; i < text.length; i += chunk) out += g.push(text.slice(i, i + chunk));
  return out + g.flush();
};

/** Every ``` in the output begins a line. */
const fencesAreBlocks = (s: string) => {
  for (let i = s.indexOf("```"); i !== -1; i = s.indexOf("```", i + 3)) {
    if (i !== 0 && s[i - 1] !== "\n") return false;
  }
  return true;
};

const CARDS =
  "```cards\n- title: 1 Year\n  price: AED 370.00\n  badge: Expires 17-09-2027\n- title: 2 Years\n  price: AED 670.00\n```\n";

console.log("\nThe reply from the screenshot");
for (const [name, mk] of GUARDS) {
  const said = `How long would you like to rent the box? Let me fetch the prices for each option.\n\n${CARDS}`;
  for (const chunk of [1, 4, 37, 5000]) {
    const out = stream(mk, said, chunk);
    check(`${name}, chunk ${chunk}: the fence still opens a block`, fencesAreBlocks(out), out.slice(0, 120));
  }
  const out = stream(mk, said, 4);
  check(`${name}: the question survives`, /How long would you like to rent the box\?/.test(out), out);
  check(`${name}: and every card with it`, (out.match(/- title:/g) ?? []).length === 2, out);
}

console.log("\nEvery place a dropped sentence can sit next to a block");
const DROPPABLE = [
  "Let me fetch the prices for each option.",
  "I'll pull up the details for box 566300 right away.",
  "Let me check the renewal price.",
];
for (const [name, mk] of GUARDS) {
  for (const drop of DROPPABLE) {
    for (const [where, said] of [
      ["before a fence, same paragraph", `Here are your options. ${drop}\n\n${CARDS}`],
      ["before a fence, own paragraph", `Here are your options.\n\n${drop}\n\n${CARDS}`],
      ["immediately before, one newline", `Here are your options.\n${drop}\n${CARDS}`],
      ["between two fences", `${CARDS}\n${drop}\n\n${CARDS}`],
      ["after a fence", `${CARDS}\nHere are your options. ${drop}\n`],
      ["twice over", `A summary follows. ${drop}\n\n${CARDS}\nAnd the prices. ${drop}\n\n${CARDS}`],
    ] as const) {
      for (const chunk of [3, 5000]) {
        const out = stream(mk, said, chunk);
        check(`${name} / ${where} / chunk ${chunk}`, fencesAreBlocks(out), out.slice(0, 160));
      }
    }
  }
}

console.log("\nAnd a paragraph break is not turned into a run-on");
// Each guard needs a sentence IT would drop: the narration guard removes an
// announcement, the echo guard removes a repeat. A sentence one drops the other
// keeps, which is the point of having both.
for (const [name, mk, said] of [
  ["narration", narrationGuard, "Your box is reserved. Let me fetch the prices for each option.\n\nChoose a renewal period below."],
  ["echo", echoGuard, "Your box expired on 21-08-2026, so the renewal runs from the current date forward. Your box expired on 21-08-2026, so the renewal runs from today forward.\n\nChoose a renewal period below."],
] as const) {
  const out = stream(mk as () => { push(s: string): string; flush(): string }, said, 5);
  check(`${name}: the sentence went`, out.length < said.length, out);
  check(`${name}: the two paragraphs stay two`, /\n\n\s*Choose a renewal period/.test(out), out);
}

console.log("\nkeptSeparator itself");
for (const [ws, want] of [
  [" ", ""],
  ["  ", ""],
  ["\t", ""],
  ["\n", "\n"],
  ["\n\n", "\n\n"],
  ["\n\n\n", "\n\n"],
  [" \n", "\n"],
  ["\n \n", "\n\n"],
  ["\n\t\n", "\n\n"],
] as const) {
  check(`${JSON.stringify(ws)} → ${JSON.stringify(want)}`, keptSeparator(ws) === want, keptSeparator(ws));
}

console.log("\nA reply with nothing removed is still byte-identical");
for (const [name, mk] of GUARDS) {
  const said = `Here are your options.\n\n${CARDS}\nWhich would you like?`;
  for (const chunk of [1, 6, 5000]) {
    check(`${name}, chunk ${chunk}: untouched`, stream(mk, said, chunk) === said, stream(mk, said, chunk));
  }
}

console.log("\nAnd the renderer recovers one that slips through anyway");
{
  const split = (t: string) => openFencesOnTheirOwnLine(t.split("\n"));
  check("the reported line is split in two", (() => {
    const l = split("How long would you like to rent the box? ```cards");
    return l.length === 2 && l[0] === "How long would you like to rent the box?" && l[1] === "```cards";
  })(), split("How long would you like to rent the box? ```cards"));

  for (const name of ["cards", "buttons", "summary", "pay", "upload", "toggles", "map", "locate", "select"]) {
    const l = split(`Here you go. \`\`\`${name}`);
    check(`a trailing ${name} opener is split out`, l.length === 2 && l[1] === "```" + name, l);
  }

  // A bare ``` mid-line could be something the writer meant; leave it.
  check("a bare fence mid-line is left alone", split("run ``` to quote").length === 1);
  check("an unknown block name is left alone", split("see ```mermaid").length === 1);
  // A fence already on its own line must not be touched.
  check("a correct block is untouched", (() => {
    const t = "Here you go.\n\n```cards\n- title: 1 Year\n```";
    return split(t).join("\n") === t;
  })());
  // Inside a block, the body is data — a line there that happens to end in
  // "```pay" is content, not an opener.
  check("block contents are never re-split", (() => {
    const t = "```summary\n- Note: the tester wrote ```pay\n```";
    return split(t).join("\n") === t;
  })(), split("```summary\n- Note: the tester wrote ```pay\n```"));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
