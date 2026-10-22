/**
 * The assistant thinking out loud, in front of the customer.
 *
 * From the 8 September UAT screenshots, verbatim:
 *
 *   "The customer chose MyHome. I need to price both options: upgrade only
 *    (keeping current expiry 2031-09-05) and also prepare for upgrade + extend.
 *    Let me price the upgrade-only option first, and also fetch the renewed-by
 *    options."
 *
 *   "Let me get the pricing confirmed and the renewed-by options."
 *
 * The customer is being told about "the customer" in the third person, and
 * about "the renewed-by options", which is the name of one of our tools. This
 * is the model narrating its plan to itself and forgetting who is reading.
 *
 * NOT a ban on saying what it is doing, at the time. "Let me fetch the branches
 * for you" was a useful progress note and the journeys asked for it; what went
 * was the sentence that could only have been addressed to itself — the
 * third-person customer, and the internal names for things. See ANNOUNCED_WORK
 * for why the progress note went too, once the widget started making it.
 */

/** Sentences that are the model talking about the reader as a third party. */
const THIRD_PERSON = /\b(the|this) (customer|user|applicant)\b/i;

/** Names only we use: tools, fields, and the shapes of our own plumbing. */
const INTERNAL_NAMES =
  /\brenewed-?by options?\b|\bpricing tool\b|\bsave tool\b|\bsubmit tool\b|\bthe (details|confirm) tool\b|\bapiFlow\b|\btool call\b|\bcollect_field\b|\brequest_payment\b|\bsubmit_case\b/i;

/** Planning aloud: what it intends to call, and in what order. */
const PLANNING =
  /\bI need to (price|fetch|call|get|run|prepare)\b|\blet me (price|prepare)\b.{0,40}\b(first|and also)\b|\bI'?ll (call|invoke) \w+\b/i;

/**
 * A PLAN WITHDRAWN IN FRONT OF THE PERSON IT WAS ANNOUNCED TO.
 *
 * 16 September, an EPGL sole establishment, verbatim: "Since this is a Sole
 * Establishment, there's no MOA needed. Next, I'll need the Memorandum of
 * Association — actually, scratch that, no MOA for a sole establishment."
 *
 * The right answer was in the first sentence. The second asks for a document,
 * takes it back, and gives the reason a third time — the model correcting
 * itself out loud, which reads as an assistant that does not know what it
 * needs. A reversal has nothing in it for the customer: whatever survives the
 * correction was already said, or is about to be.
 */
const RETRACTION =
  /\b(scratch that|ignore that|disregard that|strike that|never ?mind that)\b|\bactually,? no\b|\bwait,? no\b|\bon second thought/i;

/**
 * Announcing a question instead of asking it.
 *
 * "Let me ask about the region." followed by "Which area of Dubai is the office
 * in?" — the first sentence is the model telling itself what to do next, and
 * the customer reads a preamble to a question that is right there.
 */
const ANNOUNCED_QUESTION = /\blet me (ask|check with you|confirm with you|clarify)\b/i;

/**
 * Announcing the lookup, when the widget is already showing it.
 *
 * "Let me fetch the branches for you" used to be allowed here, on purpose, and
 * the note above still says why: it reports work being done on the customer's
 * behalf, and a silent multi-second tool round with nothing on screen is worse
 * than a sentence about it.
 *
 * That stopped being true on 16 September, when the status line beside a tool
 * round was extended past the integration calls to cover every silent stretch
 * in a turn. The customer now watches "Checking pricing…" or "Looking up your
 * box…" appear and disappear on its own. The model saying it too is the same
 * information twice, in the slower of the two places.
 *
 * And it is not free. From the mobile app, 11 September, one bubble:
 *
 *   "…How long would you like to renew for? Let me fetch the prices for each
 *    option."
 *   "Your box expired on 21-08-2026, so the renewal runs from today forward…"
 *
 * The announcement is what splits the reply in half. The model says what it is
 * about to do, does it, and comes back to a paragraph it no longer remembers
 * finishing — so it starts again. Reported as a duplicate message, and
 * [[echoGuard]] catches the repeat, but this is where the repeat comes from.
 *
 * Capped at 80 characters so it stays an ANNOUNCEMENT. The longest one in the
 * reports is 62 — "Let me pull up the details for box 566300 in Dubai right
 * away." — and a sentence appreciably longer than that is carrying something
 * besides the preamble. "Let me check the price, though it depends on which
 * emirate the box is in and how long you renew for" answers a question, and
 * losing it would cost the customer more than the preamble does.
 */
/** Longer than this and the sentence is carrying something besides the preamble. */
const ANNOUNCEMENT_MAX = 80;
const ANNOUNCED_WORK =
  /\b(let me|i'?ll|i will|i'?m going to|i am going to)\s+(go (?:and )?)?(fetch|pull up|pull|look up|retrieve|bring up|check|get|find|price|calculate|work out)\b/i;
/** "I'll get back to you" is a promise about later, not a lookup happening now. */
const NOT_A_LOOKUP = /\bget back to you\b|\bget in touch\b/i;

/**
 * WHAT SURVIVES WHEN THE SENTENCE IN FRONT OF IT DOES NOT.
 *
 * A dropped sentence used to take its trailing whitespace with it, and on 18
 * September that whitespace was a paragraph break:
 *
 *   "How long would you like to rent the box? Let me fetch the prices for each
 *    option.\n\n```cards\n- title: 1 Year …"
 *
 * The second sentence goes — it is an announcement of work the widget already
 * shows — and the "\n\n" went with it, so the reply reached the customer as
 * "…rent the box? ```cards" with the fence in the middle of a line. A fence
 * only opens a block at the start of one, so the card renderer never saw a
 * block: the customer got a literal "```cards" and the card body as bullets.
 *
 * The hazard has been here since this guard was written and nothing hit it,
 * because the sentences it dropped sat in the middle of paragraphs. Announcing
 * a lookup is different — that sentence's natural home is the line immediately
 * before the cards the lookup produced, which is exactly the position where
 * losing the break breaks the block.
 *
 * So the SEPARATION survives even when the words do not: a newline means the
 * next thing starts on its own line, a blank line means its own paragraph, and
 * a plain space between two sentences leaves nothing behind.
 *
 * The space after the sentence BEFORE the dropped one is left where it is. It
 * has usually been sent to the customer already — this runs in a stream and
 * bytes do not come back — so trimming it would only work when a whole reply
 * arrives in one chunk, and a guard that behaves differently at different
 * chunk sizes is worse than a trailing space that renders as nothing.
 */
export function keptSeparator(whitespace: string): string {
  if (!whitespace.includes("\n")) return "";
  return /\n[ \t]*\n/.test(whitespace) ? "\n\n" : "\n";
}

/**
 * Split on sentence ends, keeping the delimiters so rejoining is lossless.
 * Deliberately simple: this runs on chat prose, not on prose with citations.
 */
function sentences(block: string): string[] {
  return block.split(/(?<=[.!?])\s+/);
}

/** Is this one sentence the model talking to itself? */
export function isInternalNarration(sentence: string): boolean {
  const s = sentence.trim();
  if (!s) return false;
  if (INTERNAL_NAMES.test(s)) return true;
  if (THIRD_PERSON.test(s) && !/\byou\b|\byour\b/i.test(s)) return true;
  if (RETRACTION.test(s)) return true;
  if (ANNOUNCED_QUESTION.test(s)) return true;
  if (s.length <= ANNOUNCEMENT_MAX && ANNOUNCED_WORK.test(s) && !NOT_A_LOOKUP.test(s)) return true;
  return PLANNING.test(s);
}

/**
 * Drop the internal sentences from a finished reply.
 *
 * Fenced blocks are left completely alone — a ```summary row or a card title is
 * not prose and must not be resentenced. If removing everything would leave the
 * reply empty, the original is kept: a stripped-to-nothing turn is worse than an
 * over-explained one.
 */
export function stripInternalNarration(text: string): string {
  if (!text.trim()) return text;
  const parts = text.split(/(```[\s\S]*?```)/g);
  const out = parts.map((part, i) => {
    if (i % 2 === 1) return part; // a fenced block
    return part
      .split(/\n/)
      .map((line) => {
        if (!line.trim() || line.trim().startsWith("-") || line.trim().startsWith("#")) return line;
        const kept = sentences(line).filter((s) => !isInternalNarration(s));
        return kept.length === sentences(line).length ? line : kept.join(" ").trim();
      })
      .join("\n");
  });
  const result = out.join("").replace(/\n{3,}/g, "\n\n").trim();
  return result ? result : text;
}

/**
 * The same rule, applied while the reply is still being written.
 *
 * Stripping a finished reply is no use here: the customer reads it as it
 * arrives, so a sentence removed afterwards is a sentence they have already
 * seen. Text is held until a sentence is complete, then that sentence is either
 * emitted or dropped.
 *
 * Fenced blocks pass through untouched and un-buffered — a ```cards block is not
 * prose, and holding it back would stall the card rendering the customer is
 * waiting for.
 */
/**
 * The duration the customer just picked, acknowledged as a different one.
 *
 * 20 October, a personal rental, verbatim and all in one bubble:
 *
 *   customer: "1 Year"
 *   Mira:     "Three years, noted. Would you like to add an authorised agent
 *              to this PO Box?
 *              1 year, noted."
 *
 * Both acknowledgements are the model's, either side of the tool round that
 * recorded the choice: it answered before it had written the value down, got
 * the number wrong, and said the right one on the way back. The second one is
 * correct and the case was right too — but the customer reads the first, and
 * the first says they are buying three years for 970 instead of one for 370.
 *
 * The echo guard does not catch it: the two sentences are short and they
 * disagree, and it is built for the long paragraph said twice.
 *
 * This is decidable without waiting for anything. When the customer's whole
 * message is a term off the duration ladder — which is what a card click sends
 * — any sentence in the reply that ACKNOWLEDGES a different term is wrong at
 * the moment it is written. It goes, and the question beside it stays.
 *
 * Deliberately narrow: only a short acknowledgement ("Three years, noted.",
 * "Got it — 3 years."), never a sentence that explains or compares, so
 * "The 3-year option is AED 970" is untouched.
 */
const SPELLED: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  واحدة: 1, سنتين: 2, ثلاث: 3, خمس: 5, عشر: 10,
};
const YEAR_WORD = "(?:years?|yrs?|سنوات|سنة|سنه)";

/** The number of years a short phrase names, or nothing. */
function yearsNamed(text: string): number | null {
  const t = text.toLowerCase();
  const digits = new RegExp(`\\b(\\d{1,2})\\s*[-\u2011\u2013 ]?\\s*${YEAR_WORD}`, "iu").exec(t);
  if (digits) {
    const n = Number(digits[1]);
    if (n > 0 && n <= 30) return n;
  }
  const spelled = new RegExp(`\\b(${Object.keys(SPELLED).join("|")})\\s*[-\u2011\u2013 ]?\\s*${YEAR_WORD}`, "iu").exec(t);
  if (spelled) return SPELLED[spelled[1]!] ?? null;
  // "سنتين" is two years on its own, with no year word after it.
  if (/\bسنتين\b/.test(t)) return 2;
  return null;
}

/**
 * The customer's message, when it is nothing but a term — a duration card
 * click, or someone typing "1 year" at the question. Anything longer is a
 * sentence we are not entitled to read a decision out of.
 */
export function durationChosen(userMessage: string): number | null {
  const bare = String(userMessage ?? "")
    .trim()
    .replace(/^[\s"'\u201c\u2018]+|[\s"'.!\u201d\u2019]+$/g, "");
  if (!bare || bare.length > 24) return null;
  const only = new RegExp(`^(?:\\d{1,2}|${Object.keys(SPELLED).join("|")})\\s*[-\u2011\u2013 ]?\\s*${YEAR_WORD}$`, "iu");
  return only.test(bare) ? yearsNamed(bare) : null;
}

/** Words that make a sentence an acknowledgement rather than an explanation. */
const ACK =
  /\b(noted|got it|understood|confirmed|perfect|great|excellent|sure|okay|ok|thanks|thank you)\b|^\s*(?:\u062a\u0645|\u062d\u0633\u0646\u0627\u064b?|\u0645\u0645\u062a\u0627\u0632|\u0639\u0644\u0645\u062a)\b/iu;

/** Does this sentence acknowledge a term that is not the one just chosen? */
/**
 * The customer NAMED a duration, inside a sentence of their own.
 *
 * `durationChosen` above is deliberately strict: it answers "did they tap the
 * 2 Years chip", so the whole message has to be the term and nothing else. That
 * is right for what it does and useless for what was reported on 21 October —
 * "Mira, can I change the subscription period to two years?" answered with the
 * full menu of five durations, and the tester replying "I asked to change the
 * subscription period to two years. Why did you show all the options when my
 * request was clear?"
 *
 * So this is the loose sibling: a duration named as an INSTRUCTION. It wants a
 * verb or a preposition that makes it a choice rather than a mention, and it
 * refuses when the customer is plainly asking to SEE the options — "see other
 * durations" is a button in the widget, and collapsing the menu for somebody
 * who pressed it would be the same discourtesy pointing the other way.
 *
 * Two different terms in one message is a comparison, not a choice, and gets
 * nothing: "how much for 2 and 3 years" wants the menu it asked for.
 */
export function durationRequested(message: string): number | null {
  const t = String(message ?? "")
    .toLowerCase()
    .replace(/[\u2019']/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return null;

  // Asking to see what is available is not choosing one of them.
  if (/\b(what|which|show|see|list|all|other|another|compare|different)\b[^.?!]{0,24}\b(option|options|duration|durations|period|periods|plan|plans|term|terms)\b/.test(t)) return null;
  if (/\b(option|options|duration|durations|period|periods)\b[^.?!]{0,16}\b(available|do you have|are there)\b/.test(t)) return null;
  if (/خيارات|المدد المتاحة/.test(t)) return null;

  /**
   * Arabic says "two years" in one word.
   *
   * سنتين and عامين are duals: the number and the noun are the same token, so
   * the <number><year-word> shape every other branch here looks for never
   * appears. Handled separately rather than by loosening that shape, which
   * other guards depend on.
   */
  const dual = /(سنتين|عامين)/.exec(t);
  if (dual) {
    const instruction = /(أريد|اريد|غير|غيّر|اجعلها|خلها|بدل|تمديد|لمدة|إلى|الى)/.test(t);
    return instruction ? 2 : null;
  }

  // A comparison names more than one.
  const every = [...t.matchAll(new RegExp(`\\b(\\d{1,2}|${Object.keys(SPELLED).join("|")})\\s*[-\u2011\u2013 ]?\\s*${YEAR_WORD}`, "giu"))];
  const named = new Set(
    every.map((m) => {
      const raw = m[1]!;
      return /^\d+$/.test(raw) ? Number(raw) : (SPELLED[raw] ?? NaN);
    })
  );
  if (named.size !== 1) return null;
  const years = [...named][0]!;
  if (!Number.isFinite(years) || years < 1 || years > 30) return null;

  // And it has to read as an instruction, not a passing mention.
  const Y = `(?:\\d{1,2}|${Object.keys(SPELLED).join("|")})\\s*[-\u2011\u2013 ]?\\s*${YEAR_WORD}`;
  const asks =
    new RegExp(`\\b(change|switch|make|set|update|move|extend|upgrade|downgrade|amend|convert)\\b[^.?!]{0,40}\\b${Y}`, "iu").test(t) ||
    new RegExp(`\\b(want|like|prefer|choose|pick|take|need|go with|continue with|stick with|rent|subscribe)\\b[^.?!]{0,30}\\b${Y}`, "iu").test(t) ||
    new RegExp(`\\b(to|for)\\s+${Y}`, "iu").test(t) ||
    new RegExp(`^${Y}\\b`, "iu").test(t) ||
    new RegExp(`${Y}\\s*(please|instead|then)\\b`, "iu").test(t) ||
    /(أريد|اريد|غير|غيّر|اجعلها|خلها)/.test(t);
  return asks ? years : null;
}

/**
 * A sentence that asks the customer to pick a duration they have just picked.
 *
 * The menu is collapsed to the term they named (see lib/durationCards); this is
 * the sentence underneath it that would otherwise still say "Which duration
 * would you like?" over a single card.
 */
export function asksToPickDuration(sentence: string): boolean {
  const t = String(sentence ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!t) return false;
  return (
    /\b(which|what)\b[^.?!]{0,30}\b(duration|period|term|plan|option)s?\b[^.?!]{0,30}\b(would|do|will|like|prefer|choose|want|suit)\b/.test(t) ||
    /\bhere are\b[^.?!]{0,20}\b(duration|period|term|option)s?\b/.test(t) ||
    /\b(choose|pick|select)\b[^.?!]{0,20}\b(a |your |the )?(duration|period|term)\b/.test(t) ||
    /\bأي\b[^.؟!]{0,20}(مدة|المدة)/.test(t) ||
    /إليك (خيارات|المدد)/.test(t)
  );
}

export function contradictsChosenDuration(sentence: string, chosen: number | null): boolean {
  if (!chosen) return false;
  const s = sentence.trim();
  if (!s || s.length > 70) return false;
  if (!ACK.test(s)) return false;
  const named = yearsNamed(s);
  return named !== null && named !== chosen;
}

export function narrationGuard(opts?: { chosenDuration?: () => number | null; requestedDuration?: () => number | null }) {
  let buf = "";
  let inFence = false;

  /** Emit whatever is decidable; keep the rest. */
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
      // Complete sentences within the prose we hold.
      const m = /^([\s\S]*?[.!?])(\s+)/.exec(upto);
      if (m) {
        const sentence = m[1]!;
        // The words may go; the line break they sat on does not. See keptSeparator.
        // The words may go; the line break they sat on does not. See keptSeparator.
        const drop =
          isInternalNarration(sentence) ||
          contradictsChosenDuration(sentence, opts?.chosenDuration?.() ?? null) ||
          // The menu above it has been collapsed to the term they named, so the
          // question underneath has already been answered (21 October).
          ((opts?.requestedDuration?.() ?? null) !== null && asksToPickDuration(sentence));
        out += drop ? keptSeparator(m[2]!) : sentence + m[2];
        buf = buf.slice(m[0].length);
        continue;
      }
      // A newline also ends a unit: headings and list rows have no full stop.
      const nl = upto.indexOf("\n");
      if (nl !== -1) {
        const line = upto.slice(0, nl + 1);
        const bare = line.trim();
        const keep =
          !bare ||
          bare.startsWith("-") ||
          bare.startsWith("#") ||
          (!isInternalNarration(bare) && !contradictsChosenDuration(bare, opts?.chosenDuration?.() ?? null));
        out += keep ? line : "";
        buf = buf.slice(nl + 1);
        continue;
      }
      if (start !== -1) {
        // Prose before a fence is finished by the fence itself.
        out += upto;
        buf = buf.slice(start);
        inFence = true;
        continue;
      }
      if (final && buf) {
        out += isInternalNarration(buf) || contradictsChosenDuration(buf, opts?.chosenDuration?.() ?? null) ? "" : buf;
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
  };
}
