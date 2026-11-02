/**
 * A sentence that names our plumbing never reaches the customer.
 *
 * EPGL, 2 November, mid-submission:
 *
 *   "The tier value I sent wasn't accepted. Let me correct that and resubmit now.
 *    I can see the issue — `Licensing_Tier_Declared__c` isn't a valid field on
 *    the Account for this product. Let me resubmit with the correct fields now."
 *
 * Asked about it: "why is it showing that to the customer in the first place".
 * There is no good answer. A Salesforce API name, the word Account meaning the
 * object rather than theirs, and a running commentary on our own retry.
 *
 * WHY THIS IS CODE AND NOT ANOTHER PARAGRAPH OF GUIDANCE. It already is a
 * paragraph of guidance — two, in fact: the privacy rule of 30 October ("the
 * name of a field, a parameter, an object or a tool" is on the never list) and
 * the rule written this very morning ("a refusal you can fix is fixed
 * silently"). Both were in the agent that produced the message above. A rule
 * the model may forget under load is not a guarantee, and this one has to be:
 * the customer is mid-payment and the text is already on their screen.
 *
 * WHAT IS DROPPED: the whole sentence, not the identifier. Masking the name
 * leaves "I can see the issue — ▪▪▪ isn't a valid field on the Account", which
 * tells the customer just as much and reads worse. The sentences around it are
 * kept, so "Filing your application with EPGL now" and "Your application is
 * filed as LR-54109" survive untouched.
 *
 * WHAT IS NEVER TOUCHED: anything inside a fenced block. The ```upload,
 * ```cards and ```buttons blocks are the UI, they are parsed by position, and a
 * sentence removed from inside one breaks the control rather than the prose.
 */

/** How much unbroken text to hold before releasing it anyway. */
const HARD_HOLD = 1200;

/**
 * The marks of something that belongs to us and not to them.
 *
 * Deliberately narrow. A customer-facing reply legitimately contains licence
 * numbers, references, amounts and Arabic — none of which look like any of
 * this. Each entry here was in front of a customer at some point:
 *
 *  - `Licensing_Tier_Declared__c`, `Document_Type`, `EPG_Trade_license_no__c` —
 *    Salesforce API names, which always carry `__c` or `__r`, or are one of the
 *    handful of bare ones the composite uses.
 *  - `Class.CompositeHandler.handleRequest: line 86, column 1` — an Apex trace.
 *  - `compositeRequest`, `allOrNone`, `httpStatusCode`, `referenceId` — the
 *    shape of the request itself.
 */
const PATTERNS: RegExp[] = [
  /\b[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)*__[cr]\b/,
  /\bClass\.[A-Za-z0-9_]+\.[A-Za-z0-9_]+\b/,
  /\bline \d+, column \d+\b/,
  /\b(?:compositeRequest|compositeResponse|allOrNone|httpStatusCode|referenceId|Document_Type|Product_Code|Signatory_UAE_PASS_Id|Principal_Licence_Number)\b/,
  /\bAPEX_ERROR\b|\bSystem\.[A-Za-z]+Exception\b/,
];

/** Does this piece of prose name something that is ours, not theirs? */
export function leaksInternals(text: string): boolean {
  return PATTERNS.some((p) => p.test(text));
}

export interface InternalsGuard {
  push(delta: string): string;
  flush(): string;
  /** How many sentences were withheld, for the log. */
  dropped(): number;
}

/** One sentence, including the space or newline that ends it. */
const SENTENCE = /^[\s\S]*?(?:[.!?؟]["'’”)\]]?(?=\s|$)\s*|\n)/;

export function internalsGuard(): InternalsGuard {
  let buf = "";
  let inFence = false;
  let count = 0;

  /** Complete sentences out of `text`, minus the ones that name our plumbing. */
  const sift = (text: string, all: boolean): { out: string; rest: string } => {
    let out = "";
    let rest = text;
    for (;;) {
      const m = SENTENCE.exec(rest);
      if (!m) break;
      const sentence = m[0];
      rest = rest.slice(sentence.length);
      if (leaksInternals(sentence)) count += 1;
      else out += sentence;
    }
    if (all && rest) {
      if (leaksInternals(rest)) count += 1;
      else out += rest;
      rest = "";
    }
    return { out, rest };
  };

  const consume = (all: boolean): string => {
    let out = "";
    for (;;) {
      const fence = buf.indexOf("```");
      if (inFence) {
        // Inside a block: everything goes out as it is, up to and including the
        // closing fence. Nothing in here is prose.
        if (fence === -1) { out += buf; buf = ""; break; }
        out += buf.slice(0, fence + 3);
        buf = buf.slice(fence + 3);
        inFence = false;
        continue;
      }
      if (fence === -1) {
        const { out: emitted, rest } = sift(buf, all);
        out += emitted;
        buf = rest;
        break;
      }
      // Prose up to the fence is finished by the fence itself, so it may all be
      // judged now even if the last sentence has no full stop.
      const { out: emitted } = sift(buf.slice(0, fence), true);
      out += emitted + "```";
      buf = buf.slice(fence + 3);
      inFence = true;
    }
    return out;
  };

  return {
    push(delta: string): string {
      buf += delta;
      /**
       * A FENCE MUST NEVER BE SEEN IN HALVES.
       *
       * The model writes in small pieces and ``` arrives split as often as not.
       * Released as one or two backticks, the fence is never recognised, the
       * block's own lines are judged as if they were prose, and — worse — the
       * NEXT fence flips the state the wrong way, so what follows a block is
       * treated as being inside one and nothing is filtered at all. That is
       * exactly how the leak escaped in the first run of these tests.
       *
       * So a trailing run of backticks is held back until it is either a whole
       * fence or demonstrably not one.
       */
      const partial = /`{1,2}$/.exec(buf)?.[0] ?? "";
      if (partial) buf = buf.slice(0, -partial.length);
      const out = buf.length > HARD_HOLD && !inFence && buf.indexOf("```") === -1 ? consume(true) : consume(false);
      buf += partial;
      return out;
    },
    flush(): string {
      const out = consume(true);
      buf = "";
      return out;
    },
    dropped(): number {
      return count;
    },
  };
}
