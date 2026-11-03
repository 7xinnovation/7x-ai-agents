/**
 * "No problem." is not a reply, and an upload control under it is not one either.
 *
 * Reported twice on EPGL 2.0 — 2 November and again on 3 November, after the
 * rule telling it not to do this was already in the agent:
 *
 *   Customer: "No, it's a different company"
 *   Mira:     "No problem."
 *             [ Trade License / Initial Approval — Upload ]
 *
 * Two words and a file picker, to someone who has just said the company on the
 * application is the wrong one. Nothing says what was dropped, nothing says
 * which company's licence is now wanted, and nothing says why a document is
 * being asked for at all.
 *
 * WHY A GUARD AND NOT MORE GUIDANCE. There is guidance. It names this exact
 * message, in these exact words, and it did not hold — the same way the privacy
 * rule did not hold for Licensing_Tier_Declared__c. The pattern is narrow
 * enough to recognise and the repair is factual rather than invented: the
 * document being asked for has a name, the customer was going to be shown it
 * anyway on the control, and a sentence naming it is strictly more than two
 * words of politeness.
 *
 * WHAT IT DOES NOT DO: hold anything back. The acknowledgement has usually
 * streamed before the block arrives, and delaying every reply's first words to
 * catch this one would cost the voice its head start. The sentence is inserted
 * where it belongs instead — between the acknowledgement and the control.
 */

/** Everything the model opens with when it means "yes, fine". */
const BARE_ACK =
  /^(?:no problem|of course|certainly|sure|sure thing|got it|understood|okay|ok|alright|absolutely|no worries|happy to|لا مشكلة|بالتأكيد|حسنا|حسناً|تمام|مفهوم|بكل تأكيد)[.!…]*$/i;

/** Is this the whole of what was said — an acknowledgement and nothing else? */
export function isBareAcknowledgement(prose: string): boolean {
  const t = prose.replace(/\s+/g, " ").trim();
  if (!t || t.length > 40) return false;
  return BARE_ACK.test(t);
}

/** The sentence that replaces the silence, in the session's language. */
export function askFor(label: string, locale: "en" | "ar"): string {
  return locale === "ar" ? `يرجى رفع ${label}.` : `Please upload the ${label}.`;
}

export interface BareAckGuard {
  push(delta: string): string;
  flush(): string;
  /** Whether a sentence had to be put in. */
  repaired(): boolean;
}

/** How far into an upload block to look for its key before giving up. */
const KEY_WINDOW = 240;

export function bareAckGuard(label: (key: string) => string | undefined, locale: "en" | "ar"): BareAckGuard {
  let prose = "";
  let buf = "";
  /** Holding the opening of an upload block while its key arrives. */
  let holding = false;
  let done = false;
  let repairedAt = false;

  const open = (text: string): number => text.indexOf("```upload");

  const step = (final: boolean): string => {
    let out = "";
    for (;;) {
      if (holding) {
        /**
         * The key is only a key once the line it is on has ended. Matched
         * without that, "key: tr" is a key called `tr`, the slot cannot be
         * named, and the repair is skipped on a document we know perfectly
         * well — which is what the first run of these tests caught.
         */
        const key = (final ? /key:\s*([A-Za-z0-9_]+)\s*(?:\n|$)/ : /key:\s*([A-Za-z0-9_]+)\s*\n/).exec(buf)?.[1];
        if (!key && buf.length < KEY_WINDOW && !final) return out;
        holding = false;
        done = true;
        const name = key ? label(key) : undefined;
        // Only ever a sentence we can make true: the document has a name the
        // customer is about to see on the control, or nothing is added.
        if (name && isBareAcknowledgement(prose)) {
          repairedAt = true;
          out += `${askFor(name, locale)}\n\n`;
        }
        out += buf;
        buf = "";
        return out;
      }
      if (done) {
        out += buf;
        buf = "";
        return out;
      }
      const at = open(buf);
      if (at === -1) {
        /**
         * "```upl" may be all that has arrived. Hold back a tail that could
         * still become the fence; everything before it is prose and goes out.
         */
        const keep = final ? 0 : Math.min(buf.length, "```upload".length - 1);
        const safe = buf.slice(0, buf.length - keep);
        prose += safe;
        out += safe;
        buf = buf.slice(buf.length - keep);
        return out;
      }
      prose += buf.slice(0, at);
      out += buf.slice(0, at);
      buf = buf.slice(at);
      holding = true;
    }
  };

  return {
    push(delta: string): string {
      buf += delta;
      return step(false);
    },
    flush(): string {
      const out = step(true);
      buf = "";
      return out;
    },
    repaired(): boolean {
      return repairedAt;
    },
  };
}
