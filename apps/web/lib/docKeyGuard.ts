/**
 * A FIELD KEY IS NOT A NAME THE CUSTOMER KNOWS.
 *
 * A renewal on 16 September: "The system is still flagging `partner_1_passport`
 * and `partner_1_emirates_id` as missing — but as we agreed, GLOBAL JET EXPRESS
 * AE FZCO is a corporate partner and those don't apply." Two internal identifiers
 * read out to an applicant, in a sentence that also told them our readiness
 * calculation disagreed with the conversation. They can do nothing with either.
 *
 * It leaks the way officeId leaked: the guidance is emphatic about document keys
 * for good reason — an upload block is addressed by key and the wrong key files
 * the document in the wrong slot — and what the model is told to be careful
 * with, it narrates.
 *
 * So the key is swapped for the label the customer was shown when they uploaded
 * it. ONLY inside backticks, which is how a model writes an identifier it means
 * as an identifier, and never anywhere else: an upload block addresses its slot
 * as `key: partner_1_passport` with no backticks at all, and rewriting that
 * would file the document nowhere.
 */
export function docKeyGuard(label: (key: string) => string | undefined) {
  let buf = "";
  /** A key, and nothing but a key, between one pair of backticks. */
  const KEY = /^`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`$/;
  /** Long enough for any key we use; past it, the backtick was not a pair. */
  const MAX_HOLD = 80;

  const step = (): string => {
    let out = "";
    for (;;) {
      const open = buf.indexOf("`");
      if (open === -1) {
        out += buf;
        buf = "";
        return out;
      }
      out += buf.slice(0, open);
      const rest = buf.slice(open);
      const close = rest.indexOf("`", 1);
      if (close === -1) {
        // Still arriving. A run that has gone too far, or crossed a line, was
        // never a pair worth holding.
        const nl = rest.indexOf("\n");
        if (rest.length <= MAX_HOLD && nl === -1) {
          buf = rest;
          return out;
        }
        const upto = nl === -1 ? MAX_HOLD : nl + 1;
        out += rest.slice(0, upto);
        buf = rest.slice(upto);
        continue;
      }
      const span = rest.slice(0, close + 1);
      const m = KEY.exec(span);
      const readable = m ? label(m[1]!) : undefined;
      out += readable ? readable : span;
      buf = rest.slice(close + 1);
    }
  };

  return {
    push(delta: string): string {
      buf += delta;
      return step();
    },
    /** Whatever is still held when the message ends is text, not a pair. */
    flush(): string {
      const rest = buf;
      buf = "";
      return rest;
    },
  };
}
