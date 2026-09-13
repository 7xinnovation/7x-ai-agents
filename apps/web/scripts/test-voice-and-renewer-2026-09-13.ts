/**
 * Emirates Post, 13 September: a random tone under the voice, a voice that says
 * "dot dot dot", and "who is renewing?" asked of somebody signed in with UAE
 * PASS renewing their own box.
 *
 * Run from apps/web:  npx tsx scripts/test-voice-and-renewer-2026-09-13.ts
 */
import { forSpeech } from "../app/embed/[agent]/useVoiceChat";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : `\n         ${JSON.stringify(got)}`}`); }
};

console.log("\nThe voice does not read our punctuation back");
{
  // The reported shape: a sentence, a card, a sentence.
  const reported = "Your PO Box is rented until 31-12-2027.\n\n```summary\nrow: Total | AED 745.00\n```\n\nWould you like a receipt?";
  const said = forSpeech(reported);
  check("no run of dots survives", !/\.\s*\./.test(said), said);
  check("the card does not become speech", !/row:|AED 745/.test(said), said);
  check("both sentences do", /rented until 31-12-2027/.test(said) && /Would you like a receipt\?/.test(said), said);

  check("an ellipsis becomes one full stop", forSpeech("Renewing... one moment.") === "Renewing. one moment.", forSpeech("Renewing... one moment."));
  check("a unicode ellipsis too", !/…/.test(forSpeech("Renewing… one moment.")));
  check("a reply that is only a card says nothing", forSpeech("```cards\ntitle: 452538\n```") === "", forSpeech("```cards\ntitle: 452538\n```"));
  check("stray dots between two cards collapse", !/\. \./.test(forSpeech("```a\nx\n```\n\n```b\ny\n```\n\nDone.")));

  check("markdown emphasis is not spoken", !/[*_`]/.test(forSpeech("**Al Barsha** has `3` boxes")), forSpeech("**Al Barsha** has `3` boxes"));
  check("a table rule is not spoken", !/---/.test(forSpeech("| a | b |\n|---|---|\n| 1 | 2 |")));
  check("an em dash becomes a comma, not a word", /,/.test(forSpeech("AED 695 — plus AED 50")) && !/—/.test(forSpeech("AED 695 — plus AED 50")));

  const link = forSpeech("Read the terms at https://www.emiratespost.ae/terms-individual before paying.");
  check("a URL is not spelled out", !/https|emiratespost\.ae/.test(link), link);
  check("...but the sentence still parses", /the link below/.test(link), link);
  check("in Arabic it says so in Arabic", /الرابط أدناه/.test(forSpeech("اقرأ الشروط على https://www.emiratespost.ae/ar/terms-individual", "ar")));

  check("ordinary Arabic prose is untouched", forSpeech("صندوق البريد مؤجّر حتى 31-12-2027.") === "صندوق البريد مؤجّر حتى 31-12-2027.");
  check("an empty reply stays empty", forSpeech("") === "");
  check("whitespace only stays empty", forSpeech("\n\n  \n") === "");
}

console.log("\nThe tone: nothing is resampled");
{
  const src = readFileSync(new URL("../app/embed/[agent]/useVoiceChat.ts", import.meta.url), "utf8");
  check("the context is opened at the audio's own rate", /new AC\(\{ sampleRate: 24000 \}\)/.test(src));
  check("...with a fallback for a browser that refuses", /catch \{ ctx = new AC\(\); \}/.test(src));
  check("buffers are still declared at 24 kHz", /ctx\.createBuffer\(1, n, 24000\)/.test(src));
  check("an underrun restarts with a lead instead of butt-joining", /ctx\.currentTime \+ 0\.03/.test(src) && !/Math\.max\(scheduled, ctx\.currentTime\)/.test(src));
  check("the gain node is released with the reply", (src.match(/gain\.disconnect\(\)/g) ?? []).length >= 2);

  // The scheduler itself: a continuous stream must produce no gaps and no overlaps.
  const RATE = 24000;
  let scheduled = 0.12;
  const starts: number[] = [];
  let now = 0;
  for (let i = 0; i < 40; i++) {
    const frames = 480; // 20 ms of audio per chunk
    const startAt = scheduled >= now ? scheduled : now + 0.03;
    starts.push(startAt);
    scheduled = startAt + frames / RATE;
    now += 0.02; // the stream keeps up
  }
  const gaps = starts.slice(1).map((s, i) => s - (starts[i]! + 480 / RATE));
  check("back-to-back chunks leave no gap at all", gaps.every((g) => Math.abs(g) < 1e-9), gaps.slice(0, 3));

  // And a stall must not splice two waveforms onto the same instant.
  scheduled = 0.12; now = 0;
  const afterStall: number[] = [];
  for (let i = 0; i < 3; i++) {
    const startAt = scheduled >= now ? scheduled : now + 0.03;
    afterStall.push(startAt - now);
    scheduled = startAt + 480 / RATE;
    now += 2; // a two-second stall
  }
  check("after a stall the next chunk is scheduled ahead, not on the playhead", afterStall.slice(1).every((lead) => lead >= 0.03 - 1e-9), afterStall);
}

console.log("\nWho is renewing is not asked of someone we can already see");
{
  const src = readFileSync(new URL("../lib/integrations.ts", import.meta.url), "utf8");
  const block = src.slice(src.indexOf("renewedBy: if (!res.isError"), src.indexOf("renewedBy: if (!res.isError") + 4200);
  check("the box comes from the case, not only the call", /boxNumberIn\(input\) \?\? \(opts\.caseBoxNumber\?\.\(\) \?\? undefined\)/.test(block));
  check("...and caseBoxNumber is a declared option", /caseBoxNumber\?: \(\) => string \| null;/.test(src));
  check("a guest is still asked", /Boolean\(opts\.authenticated\) &&/.test(block));
  check("a box that is not theirs is still asked", /owned\.some\(\(b\) =>/.test(block));
  check("a failed ownership lookup does not assume ownership", /Array\.isArray\(owned\) &&/.test(block));
  check("and every time it DOES ask, it records why", /action: "renewed_by_asked"/.test(block) && /owned-box lookup failed/.test(block));

  const route = readFileSync(new URL("../app/api/chat/route.ts", import.meta.url), "utf8");
  check("a renewal's box key is wired up", /str\(liveState\.data\.po_box_number\) \?\? str\(liveState\.data\.box_number\)/.test(route));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
