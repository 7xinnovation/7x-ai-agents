/**
 * The registration fee belongs IN the summary card.
 *
 * Emirates Post asked for the amount to be visible before payment. It was — as a
 * sentence underneath the card: "Registration fee (AED 70) and any mandatory
 * charges are added when the box is reserved." That is the one place a customer
 * reading a table of what they will pay does not look, and asking for it as a
 * row kept producing another sentence.
 *
 * So the row is inserted on the way out, the same way the pay block's URL and
 * amount are. A card that already names the fee is left alone; a card with a
 * `total:` footer gets the row above it, because a total that does not include
 * the line above it is worse than no total at all.
 */
const OPEN = "```summary";

/** The longest tail of `s` that is a proper prefix of `OPEN`. */
function heldTail(s: string): number {
  const max = Math.min(OPEN.length - 1, s.length);
  for (let n = max; n > 0; n--) if (OPEN.startsWith(s.slice(s.length - n))) return n;
  return 0;
}

export function insertRegistrationFee(block: string, fee: number): string {
  if (/registration/i.test(block)) return block;
  const close = /\n[ \t]*```[ \t]*$/.exec(block);
  if (!close) return block;
  const body = block.slice(OPEN.length, close.index);
  // Only a card that actually lists rows; a bare fenced word is not a summary.
  if (!/^[ \t]*-[ \t]+\S/m.test(body)) return block;
  const row = `\n- One-time registration fee: AED ${fee.toFixed(2)}`;
  const total = /\n[ \t]*total[ \t]*:/i.exec(body);
  const next = total ? body.slice(0, total.index) + row + body.slice(total.index) : body + row;
  return OPEN + next + block.slice(close.index);
}

export function summaryFeeGuard(fee: () => number | null) {
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
      const block = buf.slice(0, end - trailing.length);
      const amount = fee();
      out += (amount !== null && Number.isFinite(amount) ? insertRegistrationFee(block, amount) : block) + trailing;
      buf = buf.slice(end);
      mode = "pass";
    }
  };

  return {
    push(delta: string): string {
      buf += delta;
      return step();
    },
    /** Whatever is still held when the message ends. An unclosed fence is text. */
    flush(): string {
      const rest = buf;
      buf = "";
      mode = "pass";
      return rest;
    },
  };
}
