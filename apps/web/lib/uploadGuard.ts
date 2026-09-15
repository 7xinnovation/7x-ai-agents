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

export function collectedUploadGuard(collected: (key: string) => CollectedDoc | null) {
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
  const sawProse = (prose: string) => {
    if (deferred || !prose) return;
    seen = (seen + prose).slice(-2000);
    if (defersUpload(seen) || asksSomethingElse(seen)) deferred = true;
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
      out += deferred ? "" : replaceCollected(buf.slice(0, end - trailing.length), collected) + trailing;
      buf = buf.slice(end);
      mode = "pass";
    }
  };

  return {
    push(delta: string): string {
      buf += delta;
      return step();
    },
    flush(): string {
      const rest = buf;
      buf = "";
      mode = "pass";
      deferred = false;
      seen = "";
      return rest;
    },
  };
}
