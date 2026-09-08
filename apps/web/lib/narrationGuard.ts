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
 * NOT a ban on saying what it is doing. "Let me fetch the branches for you" is
 * a useful progress note and the journeys ask for it. What goes is the sentence
 * that could only have been addressed to itself: the third-person customer, and
 * the internal names for things.
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
        out += isInternalNarration(sentence) ? "" : sentence + m[2];
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
