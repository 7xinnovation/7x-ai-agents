import { isIdentityKey, maskIdentity } from "./maskIdentity";

/**
 * Identity numbers masked in the CHAT, not only in the panel.
 *
 * EPGL, 11 September: "passport and Emirates ID numbers should be masked and
 * not displayed in full." That was built — and built client-side, in the
 * application panel. The chat was never covered, so on 2 October the panel
 * showed `•••••4322` beside a reply that read:
 *
 *   "Zain's passport is in — picked up passport number ending P11734322."
 *
 * Masked in one pane and printed in full in the other, in the same sentence as
 * the word "ending". The customer's screen stays open beside a shared desk for
 * the length of an application; half a rule is not a rule.
 *
 * WHAT IS MASKED: the exact values this case holds under an identity key, and
 * nothing else. Not a pattern for "things that look like a passport number" —
 * a trade licence is 1196781, a licence request is LR-37652, a PO Box is
 * 450367, and a guard that masked those would be a worse bug than the one it
 * fixes. The case already knows which values are identity numbers because the
 * extraction wrote them there under `*_passport` and `*_emirates_id` keys.
 *
 * The exception is an Emirates ID the model has read aloud from a document the
 * case has not recorded yet. `784-` followed by the right shape is unambiguous
 * enough to mask on sight; no other number in either agent begins that way.
 *
 * STREAMING, so it has to hold back a partial match. A number arriving as
 * "P117" then "34322" must not escape as the first half, so the tail of the
 * buffer is held until it cannot be the start of anything being watched for.
 */

/**
 * How much unbroken text to hold before giving up and releasing it.
 *
 * The cut is normally made at whitespace, because no identity number contains
 * any — so a cut there cannot fall inside one. This is only the ceiling for
 * text that arrives with no whitespace at all, where holding forever would mean
 * a reply that never appears.
 */
const HARD_HOLD = 400;

/** An Emirates ID as printed, in any of the ways they are written. */
const EMIRATES_ID = /\b784[-\s]?\d{4}[-\s]?\d{7}[-\s]?\d\b/g;

/** Identity values on the case, longest first so a prefix never wins. */
export function identityValues(data: Record<string, unknown> | undefined): string[] {
  const out = new Set<string>();
  for (const [key, value] of Object.entries(data ?? {})) {
    if (!isIdentityKey(key)) continue;
    const v = String(value ?? "").trim();
    // Four or fewer characters is not an identity number, and masking a short
    // string would turn an ordinary word into dots wherever it appeared.
    if (v.replace(/[^0-9a-z]/gi, "").length > 4) out.add(v);
  }
  return [...out].sort((a, b) => b.length - a.length);
}

/** Mask every known identity value, and any Emirates ID, inside one string. */
export function maskIdentitiesIn(text: string, values: string[]): string {
  let out = text;
  for (const v of values) {
    if (!v) continue;
    // Split rather than regex: these values come from documents and may contain
    // anything, and a value escaped into a pattern is a value waiting to break
    // one. Case-insensitive because a passport is often written both ways.
    const masked = maskIdentity(v);
    if (masked === v) continue;
    const lower = out.toLowerCase();
    const needle = v.toLowerCase();
    let at = lower.indexOf(needle);
    while (at !== -1) {
      out = out.slice(0, at) + masked + out.slice(at + v.length);
      at = out.toLowerCase().indexOf(needle, at + masked.length);
    }
  }
  return out.replace(EMIRATES_ID, (m) => maskIdentity(m));
}

export interface IdentityGuard {
  push(delta: string): string;
  flush(): string;
  masked(): number;
}

/**
 * `values` is read on every push rather than captured once: the case gains
 * identity numbers DURING a turn — a document is read, the extraction writes a
 * passport number, and the same reply then mentions it.
 */
export function identityGuard(values: () => string[]): IdentityGuard {
  let buf = "";
  let count = 0;

  const emit = (text: string): string => {
    if (!text) return "";
    const masked = maskIdentitiesIn(text, values());
    if (masked !== text) count += 1;
    return masked;
  };

  return {
    push(delta: string): string {
      buf += delta;
      /**
       * CUT AT WHITESPACE, NOT AT A CHARACTER COUNT.
       *
       * The first version held a fixed tail and released the rest, which put
       * the cut wherever the arithmetic landed — including the middle of the
       * number it was there to catch. "P117" went out unmasked and "34322"
       * stayed behind, and the two halves read as the whole thing.
       *
       * No identity number contains a space, so a cut at whitespace cannot fall
       * inside one. Everything up to the last space is complete tokens and safe
       * to mask and release; what follows might still be growing.
       */
      const cut = buf.search(/\s(?=\S*$)/);
      if (cut === -1) {
        if (buf.length <= HARD_HOLD) return "";
        const out = emit(buf);
        buf = "";
        return out;
      }
      const out = emit(buf.slice(0, cut + 1));
      buf = buf.slice(cut + 1);
      return out;
    },
    flush(): string {
      const out = emit(buf);
      buf = "";
      return out;
    },
    masked(): number {
      return count;
    },
  };
}
