/**
 * The assistant thinking out loud, in front of the customer.
 *
 * From the 8 September UAT screenshots, verbatim:
 *
 *   "The customer chose MyHome. I need to price both options: upgrade only
 *    (keeping current expiry 2031-09-05) and also prepare for upgrade + extend.
 *    Let me price the upgrade-only option first, and also fetch the renewed-by
 *    options."
 *
 *   "Let me get the pricing confirmed and the renewed-by options."
 *
 * The customer is being told about "the customer" in the third person, and
 * about "the renewed-by options", which is the name of one of our tools. This
 * is the model narrating its plan to itself and forgetting who is reading.
 *
 * NOT a ban on saying what it is doing, at the time. "Let me fetch the branches
 * for you" was a useful progress note and the journeys asked for it; what went
 * was the sentence that could only have been addressed to itself — the
 * third-person customer, and the internal names for things. See ANNOUNCED_WORK
 * for why the progress note went too, once the widget started making it.
 */

/** Sentences that are the model talking about the reader as a third party. */
const THIRD_PERSON = /\b(the|this) (customer|user|applicant)\b/i;

/** Names only we use: tools, fields, and the shapes of our own plumbing. */
const INTERNAL_NAMES =
  /\brenewed-?by options?\b|\bpricing tool\b|\bsave tool\b|\bsubmit tool\b|\bthe (details|confirm) tool\b|\bapiFlow\b|\btool call\b|\bcollect_field\b|\brequest_payment\b|\bsubmit_case\b/i;

/** Planning aloud: what it intends to call, and in what order. */
const PLANNING =
  /\bI need to (price|fetch|call|get|run|prepare)\b|\blet me (price|prepare)\b.{0,40}\b(first|and also)\b|\bI'?ll (call|invoke) \w+\b/i;

/**
 * A PLAN WITHDRAWN IN FRONT OF THE PERSON IT WAS ANNOUNCED TO.
 *
 * 16 September, an EPGL sole establishment, verbatim: "Since this is a Sole
 * Establishment, there's no MOA needed. Next, I'll need the Memorandum of
 * Association — actually, scratch that, no MOA for a sole establishment."
 *
 * The right answer was in the first sentence. The second asks for a document,
 * takes it back, and gives the reason a third time — the model correcting
 * itself out loud, which reads as an assistant that does not know what it
 * needs. A reversal has nothing in it for the customer: whatever survives the
 * correction was already said, or is about to be.
 */
const RETRACTION =
  /\b(scratch that|ignore that|disregard that|strike that|never ?mind that)\b|\bactually,? no\b|\bwait,? no\b|\bon second thought/i;

/**
 * Announcing a question instead of asking it.
 *
 * "Let me ask about the region." followed by "Which area of Dubai is the office
 * in?" — the first sentence is the model telling itself what to do next, and
 * the customer reads a preamble to a question that is right there.
 */
const ANNOUNCED_QUESTION = /\blet me (ask|check with you|confirm with you|clarify)\b/i;

/**
 * Announcing the lookup, when the widget is already showing it.
 *
 * "Let me fetch the branches for you" used to be allowed here, on purpose, and
 * the note above still says why: it reports work being done on the customer's
 * behalf, and a silent multi-second tool round with nothing on screen is worse
 * than a sentence about it.
 *
 * That stopped being true on 16 September, when the status line beside a tool
 * round was extended past the integration calls to cover every silent stretch
 * in a turn. The customer now watches "Checking pricing…" or "Looking up your
 * box…" appear and disappear on its own. The model saying it too is the same
 * information twice, in the slower of the two places.
 *
 * And it is not free. From the mobile app, 11 September, one bubble:
 *
 *   "…How long would you like to renew for? Let me fetch the prices for each
 *    option."
 *   "Your box expired on 21-08-2026, so the renewal runs from today forward…"
 *
 * The announcement is what splits the reply in half. The model says what it is
 * about to do, does it, and comes back to a paragraph it no longer remembers
 * finishing — so it starts again. Reported as a duplicate message, and
 * [[echoGuard]] catches the repeat, but this is where the repeat comes from.
 *
 * Capped at 80 characters so it stays an ANNOUNCEMENT. The longest one in the
 * reports is 62 — "Let me pull up the details for box 566300 in Dubai right
 * away." — and a sentence appreciably longer than that is carrying something
 * besides the preamble. "Let me check the price, though it depends on which
 * emirate the box is in and how long you renew for" answers a question, and
 * losing it would cost the customer more than the preamble does.
 */
/** Longer than this and the sentence is carrying something besides the preamble. */
const ANNOUNCEMENT_MAX = 80;
const ANNOUNCED_WORK =
  /\b(let me|i'?ll|i will|i'?m going to|i am going to)\s+(go (?:and )?)?(fetch|pull up|pull|look up|retrieve|bring up|check|get|find|price|calculate|work out)\b/i;
/** "I'll get back to you" is a promise about later, not a lookup happening now. */
const NOT_A_LOOKUP = /\bget back to you\b|\bget in touch\b/i;

/**
 * WHAT SURVIVES WHEN THE SENTENCE IN FRONT OF IT DOES NOT.
 *
 * A dropped sentence used to take its trailing whitespace with it, and on 18
 * September that whitespace was a paragraph break:
 *
 *   "How long would you like to rent the box? Let me fetch the prices for each
 *    option.\n\n```cards\n- title: 1 Year …"
 *
 * The second sentence goes — it is an announcement of work the widget already
 * shows — and the "\n\n" went with it, so the reply reached the customer as
 * "…rent the box? ```cards" with the fence in the middle of a line. A fence
 * only opens a block at the start of one, so the card renderer never saw a
 * block: the customer got a literal "```cards" and the card body as bullets.
 *
 * The hazard has been here since this guard was written and nothing hit it,
 * because the sentences it dropped sat in the middle of paragraphs. Announcing
 * a lookup is different — that sentence's natural home is the line immediately
 * before the cards the lookup produced, which is exactly the position where
 * losing the break breaks the block.
 *
 * So the SEPARATION survives even when the words do not: a newline means the
 * next thing starts on its own line, a blank line means its own paragraph, and
 * a plain space between two sentences leaves nothing behind.
 *
 * The space after the sentence BEFORE the dropped one is left where it is. It
 * has usually been sent to the customer already — this runs in a stream and
 * bytes do not come back — so trimming it would only work when a whole reply
 * arrives in one chunk, and a guard that behaves differently at different
 * chunk sizes is worse than a trailing space that renders as nothing.
 */
export function keptSeparator(whitespace: string): string {
  if (!whitespace.includes("\n")) return "";
  return /\n[ \t]*\n/.test(whitespace) ? "\n\n" : "\n";
}

/**
 * Split on sentence ends, keeping the delimiters so rejoining is lossless.
 * Deliberately simple: this runs on chat prose, not on prose with citations.
 */
function sentences(block: string): string[] {
  return block.split(/(?<=[.!?])\s+/);
}

/** Is this one sentence the model talking to itself? */
export function isInternalNarration(sentence: string): boolean {
  const s = sentence.trim();
  if (!s) return false;
  if (INTERNAL_NAMES.test(s)) return true;
  if (THIRD_PERSON.test(s) && !/\byou\b|\byour\b/i.test(s)) return true;
  if (RETRACTION.test(s)) return true;
  if (ANNOUNCED_QUESTION.test(s)) return true;
  if (s.length <= ANNOUNCEMENT_MAX && ANNOUNCED_WORK.test(s) && !NOT_A_LOOKUP.test(s)) return true;
  return PLANNING.test(s);
}

/**
 * Drop the internal sentences from a finished reply.
 *
 * Fenced blocks are left completely alone — a ```summary row or a card title is
 * not prose and must not be resentenced. If removing everything would leave the
 * reply empty, the original is kept: a stripped-to-nothing turn is worse than an
 * over-explained one.
 */
export function stripInternalNarration(text: string): string {
  if (!text.trim()) return text;
  const parts = text.split(/(```[\s\S]*?```)/g);
  const out = parts.map((part, i) => {
    if (i % 2 === 1) return part; // a fenced block
    return part
      .split(/\n/)
      .map((line) => {
        if (!line.trim() || line.trim().startsWith("-") || line.trim().startsWith("#")) return line;
        const kept = sentences(line).filter((s) => !isInternalNarration(s));
        return kept.length === sentences(line).length ? line : kept.join(" ").trim();
      })
      .join("\n");
  });
  const result = out.join("").replace(/\n{3,}/g, "\n\n").trim();
  return result ? result : text;
}

/**
 * The same rule, applied while the reply is still being written.
 *
 * Stripping a finished reply is no use here: the customer reads it as it
 * arrives, so a sentence removed afterwards is a sentence they have already
 * seen. Text is held until a sentence is complete, then that sentence is either
 * emitted or dropped.
 *
 * Fenced blocks pass through untouched and un-buffered — a ```cards block is not
 * prose, and holding it back would stall the card rendering the customer is
 * waiting for.
 */
export function narrationGuard() {
  let buf = "";
  let inFence = false;

  /** Emit whatever is decidable; keep the rest. */
  const drain = (final: boolean): string => {
    let out = "";
    for (;;) {
      if (inFence) {
        const end = buf.indexOf("```");
        if (end === -1) { out += buf; buf = ""; return out; }
        out += buf.slice(0, end + 3);
        buf = buf.slice(end + 3);
        inFence = false;
        continue;
      }
      const start = buf.indexOf("```");
      const upto = start === -1 ? buf : buf.slice(0, start);
      // Complete sentences within the prose we hold.
      const m = /^([\s\S]*?[.!?])(\s+)/.exec(upto);
      if (m) {
        const sentence = m[1]!;
        // The words may go; the line break they sat on does not. See keptSeparator.
        // The words may go; the line break they sat on does not. See keptSeparator.
        out += isInternalNarration(sentence) ? keptSeparator(m[2]!) : sentence + m[2];
        buf = buf.slice(m[0].length);
        continue;
      }
      // A newline also ends a unit: headings and list rows have no full stop.
      const nl = upto.indexOf("\n");
      if (nl !== -1) {
        const line = upto.slice(0, nl + 1);
        const bare = line.trim();
        const keep = !bare || bare.startsWith("-") || bare.startsWith("#") || !isInternalNarration(bare);
        out += keep ? line : "";
        buf = buf.slice(nl + 1);
        continue;
      }
      if (start !== -1) {
        // Prose before a fence is finished by the fence itself.
        out += upto;
        buf = buf.slice(start);
        inFence = true;
        continue;
      }
      if (final && buf) {
        out += isInternalNarration(buf) ? "" : buf;
        buf = "";
      }
      return out;
    }
  };

  return {
    push(delta: string): string {
      buf += delta;
      return drain(false);
    },
    flush(): string {
      return drain(true);
    },
  };
}
