/**
 * The MOA box that followed the customer through the partner uploads.
 *
 * Reported 15 September, twice. The second report came with the "a message asks
 * for one thing" guard already live, and the screenshots showed why it had not
 * helped: the model calls a tool between almost every pair of sentences, the
 * chat route flushes every guard when a non-text event arrives, and flush() was
 * clearing the very fact the rule depends on.
 *
 * Run from apps/web:  npx tsx scripts/test-optional-upload-2026-09-15.ts
 */
import { collectedUploadGuard, namesDocument } from "../lib/uploadGuard";

const B = "```";
const MOA = { aliases: ["Memorandum of Association", "MOA", "مذكرة التأسيس"] };
const optional = (k: string) => (k === "moa" || k === "lease_contract" ? MOA : null);

let failed = 0;
function check(what: string, ok: boolean) {
  console.log(`${ok ? "  ok  " : "FAIL  "}${what}`);
  if (!ok) failed++;
}

/** One uninterrupted reply. */
function run(reply: string): string {
  const g = collectedUploadGuard(() => null, optional);
  let out = "";
  for (const ch of reply) out += g.push(ch);
  return out + g.flush();
}

/** A reply with a tool call in the middle of it, which is the normal case. */
function runInterrupted(before: string, after: string): string {
  const g = collectedUploadGuard(() => null, optional);
  let out = "";
  for (const ch of before) out += g.push(ch);
  out += g.flush(); // the case/citation event the route flushes on
  for (const ch of after) out += g.push(ch);
  return out + g.flush();
}

// THE REPORTED BUG. Buttons, a tool call, then the MOA slot underneath them.
check(
  "the offer does not survive a mid-turn flush",
  !/key:\s*moa/.test(
    runInterrupted(
      `Now I need his Emirates ID. You can either upload the card or type the number:\n\n${B}buttons\n- Upload the Emirates ID\n- Type the number\n- This partner lives outside the UAE\n${B}\n`,
      `\n${B}upload\nkey: moa\n${B}\n`
    )
  )
);

// AND THE RULE THAT STANDS ON ITS OWN: an offer has to be made in words.
check(
  "an optional document the message never names is dropped",
  !/key:\s*moa/.test(run(`Got that. What is your email address?\n\n${B}upload\nkey: moa\n${B}\n`))
);
check(
  "an optional document the message DOES name is kept",
  /key:\s*moa/.test(
    run(`Next, the Memorandum of Association (MOA), if you have it to hand:\n\n${B}upload\nkey: moa\n${B}\n`)
  )
);
check(
  "the short form counts as naming it",
  /key:\s*moa/.test(run(`Do you have the MOA?\n\n${B}upload\nkey: moa\n${B}\n`))
);
check(
  "so does the Arabic label",
  /key:\s*moa/.test(run(`التالي، مذكرة التأسيس إن وُجدت:\n\n${B}upload\nkey: moa\n${B}\n`))
);

// A MANDATORY document is outstanding whether the sentence remembers it or not.
check(
  "a mandatory document is never dropped for going unnamed",
  /key:\s*partner_1_passport/.test(run(`Let's continue.\n\n${B}upload\nkey: partner_1_passport\n${B}\n`))
);
check(
  "nor is a block that pairs one with an optional document",
  /key:\s*partner_1_passport/.test(
    run(`Here you go.\n\n${B}upload\nkey: moa\nkey: partner_1_passport\n${B}\n`)
  )
);

// Word boundaries, so a short alias cannot match inside another word.
check("MOA does not match inside 'moat'", !namesDocument("the moat was deep", ["MOA"]));
check("MOA does match on its own", namesDocument("send the MOA, please", ["MOA"]));
check(
  "an Arabic label does not match inside a longer word",
  !namesDocument("مذكرة التأسيسية", ["مذكرة التأسيس"])
);

// AND NEVER SECOND. The opening message of a new licence names every document
// in its preparation list, so naming is not enough once a block has gone out.
const PREP = `Here is what to have ready:\n- Trade License\n- Memorandum of Association (MOA)\n\nLet's start with your Trade Licence:\n\n${B}upload\nkey: trade_license\n${B}\n\n${B}upload\nkey: moa\n${B}\n`;
{
  const out = run(PREP);
  check("the document being asked for survives", /key:\s*trade_license/.test(out));
  check("...and the offer trailing it does not", !/key:\s*moa/.test(out));
  check("...even though the preparation list named it", /Memorandum of Association/.test(out));
}
// The same two the other way round is NOT this guard's to fix — it streams, and
// cannot know a required document is coming until it has already passed the
// offer through. The client decides that one, with the whole message in hand:
// see allowedUploads in Markdown.tsx, where mandatory documents claim the
// per-message cap first.
check(
  "an offer alone in its message is still made",
  /key:\s*moa/.test(run(`Next, the Memorandum of Association, if you have it:\n\n${B}upload\nkey: moa\n${B}\n`))
);

/**
 * THE SAFETY NET THAT WAS THE REAL LEAK.
 *
 * The chat route appends upload blocks when a reply talks about uploading and
 * carries none — FB-1425, the control that never appeared. It runs after this
 * guard, so it ran AROUND it, and it was the author of every stray box reported
 * on 15 September: the guard removed the model's block, the finished text then
 * contained no block, and the net put two back.
 *
 * It needs to tell "never mentioned a document" from "block deliberately
 * removed". These are the two signals it reads.
 */
{
  const g = collectedUploadGuard(() => null, optional);
  let out = "";
  for (const ch of `Now I need his Emirates ID:\n\n${B}buttons\n- Type the number\n${B}\n\n${B}upload\nkey: moa\n${B}\n`) out += g.push(ch);
  out += g.flush();
  check("a dropped block is still a block that was seen", g.sawBlock());
  check("...and the reply is marked as having asked something else", g.suppressed());
  check("...so the net must not fire", !/key:\s*moa/.test(out) && g.sawBlock());
}
{
  // "please upload his passport copy" — already in, rewritten, no block left in
  // the text. This is the 11:53 report: the net appended the MOA beneath it.
  const collected = (k: string) =>
    k === "partner_1_passport" ? { label: "Partner 1 — passport copy", fileName: "p.pdf" } : null;
  const g = collectedUploadGuard(collected, optional);
  let out = "";
  for (const ch of `Please upload his passport copy.\n\n${B}upload\nkey: partner_1_passport\n${B}\n`) out += g.push(ch);
  out += g.flush();
  check("an 'already uploaded' rewrite leaves no block in the text", !/```upload/.test(out));
  check("...but the guard reports it saw one", g.sawBlock());
  check("...and did not suppress anything", !g.suppressed());
}
{
  // A reply that genuinely never mentioned a document: the net is what it is for.
  const g = collectedUploadGuard(() => null, optional);
  let out = "";
  for (const ch of "Please upload your trade licence below.") out += g.push(ch);
  out += g.flush();
  check("no block seen when the model emitted none", !g.sawBlock());
  check("...and nothing was suppressed", !g.suppressed());
}

console.log(failed ? `\n${failed} failing` : "\nall good");
process.exit(failed ? 1 : 0);
