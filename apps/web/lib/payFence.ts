/**
 * Guard the ```pay block on its way to the customer.
 *
 * The button in that block opens whatever URL the model wrote. On 31 Aug it wrote
 * our own return URL — the page the gateway sends the customer BACK to — because
 * the prompt handed it that URL to put in the save payload. The popup opened, the
 * return page did its job and closed it, and the chat announced "checking your
 * payment" for a payment that had never been offered. The order did not exist
 * either: the block was emitted before the save ran.
 *
 * So the URL is not taken on trust. The only payment URL that means anything is
 * the one the backend issued for THIS order, and it is substituted here; with no
 * order there is nothing to pay for, and the block is replaced by a line saying so.
 *
 * Written as a streaming filter because the customer reads the reply as it
 * arrives: it holds back only what could be the start of a fence (five bytes),
 * then the fence itself, so ordinary prose still streams a word at a time.
 */
const OPEN = "```pay";

/** The longest tail of `s` that is a proper prefix of `OPEN`. */
function heldTail(s: string): number {
  const max = Math.min(OPEN.length - 1, s.length);
  for (let n = max; n > 0; n--) if (OPEN.startsWith(s.slice(s.length - n))) return n;
  return 0;
}

export function payFenceGuard(
  expectedUrl: () => string | null,
  /**
   * What the gateway will actually ask for.
   *
   * The URL was guarded from the start and the AMOUNT beside it was not, so on
   * 4 Sep a card read "AED 700.00" over a payment page asking for AED 670 — the
   * model had added up priceDetails and counted the first authorised agent,
   * whose line comes back marked Inclusive. It is the same arithmetic that
   * produced 450 for a 400 rental, and the customer meets it at the one moment
   * they are about to hand over money. The figure is not the model's to write.
   */
  expectedAmount: () => number | null = () => null
) {
  let mode: "pass" | "capture" = "pass";
  let buf = "";

  const rewrite = (block: string): string => {
    const url = expectedUrl();
    if (!url) {
      return "\n_The payment link is not ready yet — the order still has to be created with Emirates Post._\n";
    }
    const has = /^\s*url\s*:\s*(\S+)\s*$/im.exec(block);
    let out = !has
      ? block.replace(/```pay/i, "```pay\nurl: " + url)
      : has[1] === url
        ? block
        : block.replace(has[0], has[0].replace(has[1]!, url));
    const amount = expectedAmount();
    if (amount !== null && Number.isFinite(amount)) {
      const line = `amount: AED ${amount.toFixed(2)}`;
      const written = /^[ \t]*amount[ \t]*:.*$/im.exec(out);
      out = written ? out.replace(written[0], line) : out.replace(/^([ \t]*url[ \t]*:.*)$/im, `$1\n${line}`);
    }
    return out;
  };

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
      // Capturing: wait for the closing fence on its own line.
      const close = /\n[ \t]*```[ \t]*(\n|$)/.exec(buf.slice(OPEN.length));
      if (!close) return out;
      const end = OPEN.length + close.index + close[0].length;
      out += rewrite(buf.slice(0, end));
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
