/**
 * The assistant saying the same thing twice in one reply.
 *
 * Reported from the mobile app, 11 September: "Renewal flow — a duplicate
 * message is displayed; the same renewal explanation and renewal-period options
 * appear to be repeated back-to-back in the chat." Verbatim, in one bubble:
 *
 *   "Your box expired on 21-08-2026, so the renewal runs from the current date
 *    forward. How long would you like to renew for? Let me fetch the prices for
 *    each option."
 *
 *   "Your box expired on 21-08-2026, so the renewal runs from today forward.
 *    The longer options carry a discount. Choose your renewal period:"
 *
 * This is what a tool round does to a reply. The model explains the situation
 * and asks the question, calls the pricing tool, and then — with the prices in
 * hand and its own half-finished paragraph now several thousand tokens back —
 * writes the explanation again before it writes the cards. Not the same string
 * twice, which is why nothing caught it: "the current date forward" and "today
 * forward" are the same sentence written twice by something that had forgotten
 * it had already written it.
 *
 * So the test is what the customer would call the same sentence, not what
 * `===` would: the words it is made of, ignoring order, punctuation and
 * capitalisation. A sentence that is mostly the words of one already said in
 * this reply is a sentence the customer has already read.
 *
 * SCOPE, deliberately narrow:
 *  - one reply only. A new guard per turn; repeating yourself across turns is
 *    often the right thing to do, because the customer asked again.
 *  - prose only. Fenced blocks pass through untouched — five duration cards are
 *    five near-identical rows and every one of them belongs there — and so do
 *    list items and headings, where "Dubai — AED 300" under "Dubai — AED 600"
 *    is a price list, not an echo.
 *  - long sentences only. "Yes." and "Which one?" and "Thank you." repeat in
 *    ordinary writing and carry nothing when they do.
 */

/** Below this a repeat is a turn of phrase, not a duplicated paragraph. */
const MIN_CHARS = 36;
const MIN_WORDS = 6;

/**
 * How much of a sentence has to be the words of an earlier one.
 *
 * 0.7 keeps the pair above — they share fourteen words of nineteen — and
 * separates them from sentences that merely share a subject: "Your box expires
 * on 21-08-2027." and "Your box is at the Dubai Sorting Centre." overlap on
 * four short words out of a dozen and both survive.
 */
const SAME = 0.7;

/** The words of a sentence, lowercased, with everything else dropped. */
function bag(sentence: string): Set<string> {
  return new Set(
    sentence
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter(Boolean)
  );
}

/** How much two bags of words have in common, 0 to 1. */
function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/** Is this sentence long enough to be worth remembering? */
function substantial(sentence: string): boolean {
  const s = sentence.trim();
  if (s.length < MIN_CHARS) return false;
  if (s.startsWith("-") || s.startsWith("#") || s.startsWith("|") || s.startsWith(">")) return false;
  return bag(s).size >= MIN_WORDS;
}

export interface EchoGuard {
  push(delta: string): string;
  flush(): string;
  /** How many sentences were dropped as repeats — for the turn's audit line. */
  dropped(): number;
}

/**
 * Drop sentences the reply has already said, while it is still being written.
 *
 * Same shape as the other streaming guards: text is held until a sentence is
 * complete, then it is either emitted or dropped, so the customer never reads a
 * duplicate that is removed afterwards. Only the LATER copy can go — the first
 * is on their screen before the second is written, which is the whole reason
 * this runs in the stream rather than over the finished reply.
 */
export function echoGuard(): EchoGuard {
  const said: Set<string>[] = [];
  let buf = "";
  let inFence = false;
  let drops = 0;

  /** Emit the sentence, unless the reply has already made it. */
  const decide = (sentence: string): boolean => {
    if (!substantial(sentence)) return true;
    const words = bag(sentence);
    for (const earlier of said) {
      if (overlap(words, earlier) >= SAME) {
        drops += 1;
        return false;
      }
    }
    said.push(words);
    return true;
  };

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
      const m = /^([\s\S]*?[.!?؟])(\s+)/.exec(upto);
      if (m) {
        const sentence = m[1]!;
        out += decide(sentence) ? sentence + m[2] : "";
        buf = buf.slice(m[0].length);
        continue;
      }
      // A newline ends a unit too: a heading or a list row has no full stop.
      const nl = upto.indexOf("\n");
      if (nl !== -1) {
        const line = upto.slice(0, nl + 1);
        out += decide(line.trim()) ? line : "";
        buf = buf.slice(nl + 1);
        continue;
      }
      if (start !== -1) {
        // Prose before a fence is finished by the fence.
        if (upto) out += decide(upto) ? upto : "";
        buf = buf.slice(start);
        inFence = true;
        continue;
      }
      if (final && buf) {
        out += decide(buf) ? buf : "";
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
    dropped(): number {
      return drops;
    },
  };
}
