/**
 * Internal identifiers do not belong in the conversation.
 *
 * "Naif Post Office (officeId: 214) confirmed. Now fetching available box
 * numbers." — the customer is reading a branch name with a database key stapled
 * to it. It leaks because the guidance is emphatic about officeId for good
 * reason (passing mainOfficeId makes every branch look sold out), and what the
 * model is told to be careful with, it narrates.
 *
 * Asking it not to has the failure mode every prose rule has: it holds until the
 * turn gets busy. So the ids are removed on the way out instead. A parenthetical
 * made ONLY of internal key/value pairs is dropped whole; anything else is left
 * exactly as written, because a parenthesis in a sentence is usually the
 * customer's own words coming back to them.
 *
 * Streaming, like the pay fence: it holds back only from an open bracket to its
 * close, so ordinary prose still arrives a word at a time.
 */

/** Keys that mean something to the backend and nothing to a customer. */
/** `boxId` is deliberately absent: it IS the customer's box number. */
const INTERNAL =
  "officeid|mainofficeid|locationid|uniqueboxid|bundleid|bundle_id|emiratecode|citycode|entcode|ent_code|subscriptionreferencenumber|custprofid|servicetype|serviceid|servicecriteria|licenseid|entityid|ownerid";

/** `(officeId: 214)`, `(officeId 214, mainOfficeId 209)`, `(BundleId=IN)`. */
const ONLY_IDS = new RegExp(`^\\(\\s*(?:${INTERNAL})\\s*[:=]?\\s*[\\w.-]+(?:\\s*[,;]\\s*(?:${INTERNAL})\\s*[:=]?\\s*[\\w.-]+)*\\s*\\)$`, "i");

/**
 * A backend error code is not a customer's business.
 *
 * "I'm getting an error holding that box right now
 * (ERROR_GETTING_RATE_TYPE_DETAILS)" — they can do nothing with that, and it
 * reads as the system coming apart. The retry that follows usually works; the
 * code should never have been shown either way.
 */
const ERROR_CODE = /\s*[([]\s*(?:ERROR_[A-Z_]+|[A-Z]+_NOT_FREE|[A-Z]+_NOT_FOUND|INVALID_[A-Z_]+|MISMATCH_[A-Z_]+|[A-Z_]{6,}_DETAILS)\s*[)\]]/g;

/**
 * ...and the same code written as a sentence.
 *
 * "Error 173 means the delivery area wasn't accepted." The bracketed form was
 * caught; this one reads as an explanation and sails through. It is still
 * Emirates Post's internal numbering read out to somebody who cannot act on it,
 * and the half after "means" is the only part that was ever for them.
 *
 * The remaining sentence can start lower-case. An earlier version capitalised
 * it and, because the rule also fired after a newline, turned "emirate: DXB"
 * inside a fenced map block into "Emirate: DXB" and broke fifteen tests. A
 * lower-case first letter is a blemish; a corrupted block is a bug.
 */
const ERROR_PROSE = /\berrors?\s+(?:code\s+)?\d{2,4}\s*(?:means|indicates|is)?\s*[:,-]?\s*/gi;

/** A bare SCREAMING_SNAKE code, outside brackets. */
const BARE_CODE = /\s*\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+){2,}\b/g;



/**
 * The same pairs written inline, e.g. "Naif Post Office, officeId 214, is…".
 * Punctuation on both sides means the pair was an aside and both commas go;
 * otherwise a single space stands in for it, so the sentence still reads.
 */
const INLINE = new RegExp(
  `[ \\t]*([,;]?)[ \\t]*\\b(?:${INTERNAL})\\b[ \\t]*[:=]?[ \\t]*[\\w-]+(?:\\.[\\w-]+)*[ \\t]*([,;]?)`,
  "gi"
);

/** Longest run a bracket may hold before we give up and let it through. */
const MAX_HOLD = 160;

/** Clean a complete string (used by the tests and by the non-streaming paths). */
export function stripInternalIds(text: string): string {
  return text
    .replace(new RegExp(`\\s*\\((?:[^()\\n]{0,${MAX_HOLD}})\\)`, "g"), (m) => (ONLY_IDS.test(m.trim()) ? "" : m))
    .replace(INLINE, (_m, lead: string, trail: string) => (lead && trail ? "" : lead || trail || " "))
    // Removing the pair can leave the punctuation that framed it: "(open until
    // 8pm,)" and "has . Let me". Tidy the seams rather than the sentence.
    // Codes come out BEFORE the seams are tidied, or the tidy runs against text
    // that still holds them and leaves "failed with , so" behind.
    .replace(ERROR_CODE, "")
    // ...and the prose form, which reads as an explanation and used to sail past.
    .replace(ERROR_PROSE, "")
    .replace(BARE_CODE, "")
    // A preposition with nothing left after it is a seam, not a sentence.
    .replace(/\b(?:with|by)\s*([,.;])/gi, "$1")
    .replace(/([,;])\s*([)\]])/g, "$2")
    .replace(/\s+([.,;:!?)\]])/g, "$1");
}

export function internalIdFilter() {
  let buf = "";
  return {
    push(delta: string): string {
      buf += delta;
      let out = "";
      for (;;) {
        const open = buf.indexOf("(");
        // Nothing bracketed pending: release everything but a possible partial
        // inline pair at the very end (it may still be mid-word).
        if (open === -1) {
          const safe = releasable(buf);
          out += stripInternalIds(buf.slice(0, safe));
          buf = buf.slice(safe);
          return out;
        }
        // The whitespace in front of a bracket belongs to the bracket: dropping
        // the parenthetical and leaving its space behind reads as a typo.
        const before = buf.slice(0, open);
        const lead = /[ \t]*$/.exec(before)![0];
        out += stripInternalIds(before.slice(0, before.length - lead.length));
        const rest = buf.slice(open);
        const close = rest.indexOf(")");
        const nl = rest.indexOf("\n");
        // An unclosed bracket that has run too long, or crossed a line, was never
        // a parenthetical worth holding.
        if (close === -1) {
          if (rest.length <= MAX_HOLD && nl === -1) {
            buf = lead + rest;
            return out;
          }
          const upto = nl === -1 ? MAX_HOLD : nl + 1;
          out += lead + rest.slice(0, upto);
          buf = rest.slice(upto);
          continue;
        }
        if (nl !== -1 && nl < close) {
          out += lead + rest.slice(0, nl + 1);
          buf = rest.slice(nl + 1);
          continue;
        }
        const paren = rest.slice(0, close + 1);
        if (!ONLY_IDS.test(paren.trim())) out += lead + paren;
        buf = rest.slice(close + 1);
      }
    },
    flush(): string {
      const rest = stripInternalIds(buf);
      buf = "";
      return rest;
    },
  };
}

/**
 * How much of the tail is safe to release.
 *
 * An inline pair can straddle two deltas ("officeId" / ": 214"), so a trailing
 * word — or a word followed by a colon — is held until the next chunk says what
 * follows it.
 */
function releasable(s: string): number {
  const m = /[,;]?\s*[\w.-]+\s*[:=]?\s*[\w.-]*$/.exec(s);
  if (!m) return s.length;
  return m.index;
}
