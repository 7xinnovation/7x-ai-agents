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

  const step = (): string => {
    let out = "";
    for (;;) {
      if (mode === "pass") {
        const i = buf.toLowerCase().indexOf(OPEN);
        if (i === -1) {
          const hold = heldTail(buf);
          out += buf.slice(0, buf.length - hold);
          buf = buf.slice(buf.length - hold);
          return out;
        }
        out += buf.slice(0, i);
        buf = buf.slice(i);
        mode = "capture";
        continue;
      }
      const close = /\n[ \t]*```[ \t]*(\n|$)/.exec(buf.slice(OPEN.length));
      if (!close) return out;
      const end = OPEN.length + close.index + close[0].length;
      const trailing = close[1] ?? "";
      out += replaceCollected(buf.slice(0, end - trailing.length), collected) + trailing;
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
      return rest;
    },
  };
}
