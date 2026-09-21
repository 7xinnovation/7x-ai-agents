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
 * OUR OWN FILING SYSTEM, CITED AT THE CUSTOMER.
 *
 * EPGL widget, 21 September: "Internal source references (e.g. 'EPGL Agentic AI
 * KB §4', 'EPGL Licensing Guide §7/§1') are displayed to the end user in the
 * chat." Raised on the PO Box agent too.
 *
 * These are the names WE gave the knowledge documents, and a section number
 * inside them. An applicant cannot open either, so the citation is at best
 * noise and at worst an invitation to ask for a document that is not theirs to
 * read. The answer is the answer; where it came from is ours to know, and the
 * widget already has a Sources control for the cases where a source genuinely
 * belongs on screen.
 *
 * The section mark is what makes this safe to match on. It is not a character
 * that turns up in a company name, an address or an applicant's own words —
 * every instance in the transcripts is one of ours — so the rule is anchored to
 * it rather than to the document names, which change.
 */
const SECTION = String.raw`§\s*\d+(?:\s*[/,&]\s*§?\s*\d+)*`;
/**
 * What makes a run of words a DOCUMENT rather than a sentence.
 *
 * The first version of this took "a capitalised word plus up to seven more,
 * then a section mark" and turned "Renewals run annually §3." into ".". Eating
 * the customer's answer to remove a citation from it is much worse than leaving
 * the citation, so a name is only removed when it ends in a word that names a
 * document. Anything else loses its section mark and keeps its prose.
 */
const DOC_WORD = String.raw`(?:KB|Knowledge\s*Base|Guide|Manual|Handbook|Policy|Procedure|SOP|Playbook|Document)`;
/**
 * Every word of the name STARTS WITH A LETTER.
 *
 * Without that, "AED 100,700 EPGL Agentic AI KB §4" matched from the 700
 * onwards and the reply came out as "AED 100,and covers one year." A number is
 * never part of a document's name, and corrupting a fee to remove a citation
 * from beside it is not a trade worth making.
 */
const DOC_NAME = String.raw`[A-Za-z][\w'’&.\-]*(?:[ \t][A-Za-z][\w'’&.\-]*){0,6}[ \t]${DOC_WORD}`;

/** A bracket holding nothing but a citation: "(EPGL Licensing Guide §7/§1)". */
const ONLY_SOURCE = new RegExp(
  String.raw`^[([]\s*(?:see|per|source|ref(?:erence)?)?[\s:]*(?:${DOC_NAME}|[\w'’&.\- ]{0,60}?)[\s,]*${SECTION}\s*[)\]]$`,
  "i"
);

/** "Per EPGL Licensing Guide §7/§1," — a citation announced as one. */
const CITED = new RegExp(
  String.raw`(^|[.!?]\s+)(?:see|per|source|ref(?:erence)?)[\s:]+(?:${DOC_NAME}|[A-Za-z][\w'’&.\- ]{0,60}?)[\s,]*${SECTION}[\s,]*(\w)`,
  "gi"
);

/** "…the EPGL Agentic AI KB §4 says…" — named document, mid-sentence. */
const NAMED_SOURCE = new RegExp(String.raw`[ \t]*([,;(\[]?)[ \t]*(?:the[ \t])?${DOC_NAME}[\s,]*${SECTION}[ \t]*([,;)\]]?)`, "gi");

/** A bare section mark with nothing identifying it. Only the mark goes. */
const BARE_SECTION = new RegExp(String.raw`[ \t]*[(\[]?\s*${SECTION}\s*[)\]]?`, "g");

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
    .replace(new RegExp(`\\s*\\((?:[^()\\n]{0,${MAX_HOLD}})\\)`, "g"), (m) =>
      ONLY_IDS.test(m.trim()) || ONLY_SOURCE.test(m.trim()) ? "" : m
    )
    // Announced as a citation: it and its lead-in go, and the sentence it was
    // in front of keeps its capital letter.
    // The citation opened the sentence, so the word behind it inherits the
    // capital letter the citation was using.
    .replace(CITED, (_m, before: string, next: string) => `${before}${next.toUpperCase()}`)
    // A named document mid-sentence. Punctuation on both sides means it was an
    // aside and both go; otherwise one space stands in for it.
    .replace(NAMED_SOURCE, (_m, lead: string, trail: string) => (lead && trail ? "" : lead || trail || " "))
    // And a section mark on its own, which takes nothing else with it.
    .replace(BARE_SECTION, "")
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
