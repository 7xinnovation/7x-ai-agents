/**
 * Do not ask for a file that is already sitting there.
 *
 * The prompt has said this since the beginning — "a document already in the case
 * is COLLECTED, never ask for it again" — and on 5 Sep an EPGL customer uploaded
 * their trade licence from the panel, and two messages later was told "Let's
 * start with the Trade License. Please upload it below", with the widget
 * underneath showing **Uploaded**. The case had it. The model was told. It asked
 * anyway, and the customer had no idea what was wanted of them.
 *
 * So the block is replaced on the way out, the same way the pay URL and the
 * summary total are: what was an upload control becomes one line saying the file
 * is already in and naming it. The customer sees an answer instead of a box they
 * have already filled.
 */
const OPEN = "```upload";

/**
 * And do not put the box back when you have just said it can wait.
 *
 * EPGL, 15 September. A Form 9 was refused as another company's document —
 * correctly — and the customer said "do I need to upload that right now? I don't
 * have one on me". The reply was right too: "No problem, you can come back to
 * it... you don't need to upload it right now." And underneath it, the same
 * upload control, with the same rejection in red beneath it, for the second
 * time.
 *
 * The words say later and the interface says now, and the red paragraph
 * repeating verbatim reads as a SECOND rejection of a second attempt. A
 * customer who has just been let off the hook is shown the hook again.
 *
 * So a reply that defers a document does not also offer the control for it. The
 * prose survives untouched; only the box goes. Nothing is lost by it — the
 * document is still listed as outstanding in the panel, with its own upload
 * button, which is where somebody coming back to it would look.
 */
const DEFERS =
  /\b(come back to it|no need to upload|do not need to upload|don'?t need to upload|nothing to upload right now|whenever you have it|when you have it to hand|no rush|in your own time|later on)\b/i;
const DEFERS_AR = /(لاحقاً|لاحقا|لا داعي الآن|لا حاجة الآن|يمكنك العودة|عندما يتوفر|عند توفره)/;

/** Has this reply, so far, told the customer the document can wait? */
export function defersUpload(prose: string): boolean {
  return DEFERS.test(prose) || DEFERS_AR.test(prose);
}

/**
 * AND A MESSAGE ASKS FOR ONE THING.
 *
 * EPGL, 15 September: "Now I need Partner 2's Emirates ID. Does Abdelaziz live
 * in the UAE, or is he based outside the UAE?", three buttons to answer it —
 * and underneath, an upload control for the Memorandum of Association, marked
 * optional. The guidance has forbidden this since August ("never put an upload
 * block in the same message as a question about something else"); a rule only
 * the model enforces is a rule that holds most of the time.
 *
 * A ```buttons block IS the question. Anything asking for a file underneath it
 * is asking for something the customer was not asked about, so it goes — and
 * the buttons, which are what the message is actually for, stay.
 *
 * Only when the buttons come FIRST. "Upload it below, or tell me you don't have
 * it yet" is a genuine pairing and reads in that order.
 */
const BUTTONS = /```[ \t]*buttons\b/i;

export function asksSomethingElse(prose: string): boolean {
  return BUTTONS.test(prose);
}

/**
 * AND AN OPTIONAL DOCUMENT IS AN OFFER, WHICH HAS TO BE MADE IN WORDS.
 *
 * The same EPGL message, reported again on 15 September with the guard already
 * live: "Now I need his Emirates ID", three buttons, and an upload control for
 * the Memorandum of Association underneath — and when the customer, reasonably,
 * put a file in the only box on the screen, it was refused.
 *
 * The buttons rule above did fire. It was then FORGOTTEN, which is the bug
 * below in flush(). But the deeper point stands on its own: the MOA is
 * OPTIONAL, nothing is waiting on it, and a box for it appearing beside an
 * unrelated question has no reading except "this is what I am being asked for".
 *
 * A mandatory document is different — it is outstanding whether or not the
 * sentence remembers to mention it, and dropping its control strands the
 * customer. So the rule is only about optional ones: a block asking for an
 * optional document survives when the message NAMES that document, and goes
 * when it does not. Saying "here is the MOA slot if you have it" costs the
 * model one clause and is exactly what the guidance already asks for.
 */
export function namesDocument(prose: string, aliases: string[]): boolean {
  for (const alias of aliases) {
    const a = alias.trim();
    if (a.length < 3) continue;
    const pattern = a
      .split(/\s+/)
      .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("[\\s\u2011-]+");
    // Arabic has no \b, so the boundary is "not a letter of the same script".
    const re = /^[\x00-\x7f]+$/.test(a)
      ? new RegExp(`\\b${pattern}\\b`, "i")
      : new RegExp(`(?<![\\p{L}])${pattern}(?![\\p{L}])`, "iu");
    if (re.test(prose)) return true;
  }
  return false;
}

/** The longest tail of `s` that is a proper prefix of `OPEN`. */
function heldTail(s: string): number {
  const max = Math.min(OPEN.length - 1, s.length);
  for (let n = max; n > 0; n--) if (OPEN.startsWith(s.slice(s.length - n))) return n;
  return 0;
}

export interface CollectedDoc {
  /** What the customer knows it as. */
  label: string;
  /** The file they sent, when we have its name. */
  fileName?: string | null;
}

/** Rewrite one block; exported so the wording is testable without a stream. */
export function replaceCollected(
  block: string,
  collected: (key: string) => CollectedDoc | null
): string {
  const close = /\n[ \t]*```[ \t]*$/.exec(block);
  if (!close) return block;
  const body = block.slice(OPEN.length, close.index);
  const keys = [...body.matchAll(/^[ \t]*(?:-[ \t]*)?key[ \t]*:[ \t]*([\w.-]+)[ \t]*$/gim)].map((m) => m[1]!);
  if (!keys.length) return block;
  const done = keys.map((k) => [k, collected(k)] as const).filter(([, d]) => d);
  // Nothing collected yet, or only some of it: leave the block alone rather than
  // half-rewriting an ask that is still genuine.
  if (done.length !== keys.length) return block;
  const lines = done.map(
    ([, d]) => `_Already uploaded: **${d!.label}**${d!.fileName ? ` — ${d!.fileName}` : ""}. Nothing to do here._`
  );
  return lines.join("\n");
}

export interface OptionalDoc {
  /** Every name this document goes by, in both languages, plus its key. */
  aliases: string[];
}

export function collectedUploadGuard(
  collected: (key: string) => CollectedDoc | null,
  /**
   * Non-null for a document nothing is waiting on. See namesDocument: an offer
   * has to be made in words, or it is not an offer, it is a demand nobody made.
   */
  optional: (key: string) => OptionalDoc | null = () => null
) {
  let mode: "pass" | "capture" = "pass";
  let buf = "";
  // Set by the prose we have already let through this reply. The deferring
  // sentence always precedes the block -- the model explains, then offers -- so
  // by the time a block arrives we know whether it was disowned.
  //
  // Tested against the prose ACCUMULATED so far, not the slice just emitted: the
  // text arrives a few characters at a time, and "come back to it" split across
  // two deltas matches neither of them. Bounded, because only the sentences
  // around the block can be talking about it.
  let deferred = false;
  let seen = "";
  /** Whether a block has already gone out in this reply. */
  let kept = false;
  const sawProse = (prose: string) => {
    if (deferred || !prose) return;
    seen = (seen + prose).slice(-2000);
    if (defersUpload(seen) || asksSomethingElse(seen)) deferred = true;
  };

  /**
   * A block offering ONLY optional documents that the message never mentioned.
   *
   * Every key has to be optional for this to bite. A block pairing the MOA with
   * a partner's passport is about the passport, and Markdown.tsx already drops
   * the optional half of those; this is the other shape, where the optional
   * document arrives alone with nothing in the sentence above it.
   */
  const unaskedOptional = (block: string): boolean => {
    const keys = [...block.matchAll(/^[ \t]*(?:-[ \t]*)?key[ \t]*:[ \t]*([\w.-]+)[ \t]*$/gim)].map((m) => m[1]!);
    if (!keys.length) return false;
    const offers = keys.map((k) => optional(k));
    if (offers.some((o) => !o)) return false; // something here is actually required
    /**
     * AND NEVER SECOND.
     *
     * The opening message of an EPGL new licence lists what to have ready —
     * naming the MOA, correctly — and then emits two blocks: the trade licence,
     * which it is asking for, and the MOA, which it is not. The prose names the
     * MOA, so the rule above lets it stand, and the customer is capped at one
     * control per message so the right one wins by being FIRST.
     *
     * Winning by arrival order is not winning. Swap the two blocks and the
     * optional offer is the only box on a screen asking for a trade licence,
     * which is the whole bug in a different coat. An optional document is never
     * the point of a message that has already asked for something, so once a
     * block has gone out, the offers stop.
     */
    if (kept) return true;
    return !offers.some((o) => namesDocument(seen, o!.aliases));
  };

  const step = (): string => {
    let out = "";
    for (;;) {
      if (mode === "pass") {
        const i = buf.toLowerCase().indexOf(OPEN);
        if (i === -1) {
          const hold = heldTail(buf);
          const prose = buf.slice(0, buf.length - hold);
          sawProse(prose);
          out += prose;
          buf = buf.slice(buf.length - hold);
          return out;
        }
        const before = buf.slice(0, i);
        sawProse(before);
        out += before;
        buf = buf.slice(i);
        mode = "capture";
        continue;
      }
      const close = /\n[ \t]*```[ \t]*(\n|$)/.exec(buf.slice(OPEN.length));
      if (!close) return out;
      const end = OPEN.length + close.index + close[0].length;
      const trailing = close[1] ?? "";
      // Already said it can wait, or already asked something else: the control
      // goes, the sentence and the buttons stay.
      const block = buf.slice(0, end - trailing.length);
      if (deferred || unaskedOptional(block)) {
        // The sentence stays; only the control goes.
      } else {
        out += replaceCollected(block, collected) + trailing;
        kept = true;
      }
      buf = buf.slice(end);
      mode = "pass";
    }
  };

  return {
    push(delta: string): string {
      buf += delta;
      return step();
    },
    /**
     * WHAT A REPLY HAS SAID, IT HAS SAID.
     *
     * flush() used to clear `deferred` and `seen`, on the reading that it ends a
     * reply. It does not: the chat route flushes every guard whenever a
     * NON-TEXT event arrives mid-turn — a case update, a citation, a tool
     * result — and the model calls a tool between almost every pair of
     * sentences. So EPGL's "Now I need his Emirates ID", its three buttons, a
     * collect_field recording the answer, and then the MOA upload block, was:
     * buttons seen, guard flushed, buttons forgotten, block emitted. The rule
     * that a message asks for one thing held only for messages that made no
     * tool calls, which in this flow is almost none of them.
     *
     * A guard is built per request (see the chat route), so this state belongs
     * to one reply by construction and has nothing to reset between.
     */
    flush(): string {
      const rest = buf;
      buf = "";
      mode = "pass";
      return rest;
    },
  };
}
