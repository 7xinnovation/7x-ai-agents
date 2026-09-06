/**
 * The total, in the sentence beside the card.
 *
 * The summary card's footer is stamped with the real charge, and the pay
 * button's amount is stamped with the real charge, and on 6 September a MyBox
 * rental still told the customer, in a paragraph directly under a card reading
 * AED 1,300.00: "The confirmed total from Emirates Post is AED 1,270.00."
 *
 * 1,270 is `minimumAmount` — the box, its registration and the first agent, with
 * nothing the customer added. It is the number the model is handed, so it is the
 * number the model reaches for whenever it wants to sound authoritative, and no
 * amount of telling it otherwise has stopped that. Prose is the one surface the
 * guards did not cover.
 *
 * So a figure PRESENTED AS THE TOTAL is corrected on the way out, the same way
 * the card's footer is. Only that: a line item is a line item, a fee is a fee,
 * and neither is touched. It is a streaming filter, holding back only the tail
 * that could still turn into such a phrase.
 */

/** Words that make the number after them a total rather than a line item. */
const TRIGGER = /\b(total|you will pay|you'll pay|amount to pay|amount due|amount payable|will be charged|charged)\b/gi;
/** The claim itself: a trigger, then an AED figure close behind it. */
const CLAIM = /\b(?:total|you will pay|you'll pay|amount to pay|amount due|amount payable|will be charged|charged)\b[^\n]{0,60}?AED[  ]*([\d,]+(?:\.\d{1,2})?)/gi;
/** A trigger plus its window plus the figure: how much must arrive before a
 * claim can be judged complete. */
const HOLD = 100;
/** The longest trigger phrase, so one split across two chunks is still seen. */
const TAIL = 20;

const money = (n: number, likeCommas: boolean) => {
  const s = n.toFixed(2);
  if (!likeCommas) return s;
  const [whole, frac] = s.split(".");
  return `${whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${frac}`;
};

/** Rewrite every stated total in `text` that is not the real one. */
export function correctStatedTotals(text: string, expected: number): string {
  CLAIM.lastIndex = 0;
  return text.replace(CLAIM, (whole, figure: string) => {
    const stated = Number(String(figure).replace(/,/g, ""));
    if (!Number.isFinite(stated) || Math.abs(stated - expected) < 0.01) return whole;
    return whole.replace(figure, money(expected, figure.includes(",")));
  });
}

export function proseTotalGuard(expected: () => number | null) {
  let buf = "";

  /**
   * The furthest we can emit without cutting a claim in half.
   *
   * Ordinary prose streams a word behind: only the last few bytes are held, in
   * case they are the start of a trigger word. A trigger that HAS arrived holds
   * everything from itself onwards until enough text follows for its figure to
   * have arrived too — otherwise the word is emitted, the figure lands in the
   * next chunk, and the claim is never seen as one.
   */
  const safeCut = (): number => {
    let cut = Math.max(0, buf.length - TAIL);
    TRIGGER.lastIndex = 0;
    for (let m = TRIGGER.exec(buf); m; m = TRIGGER.exec(buf)) {
      if (buf.length - m.index < HOLD) return Math.min(cut, m.index);
    }
    return cut;
  };

  const fix = (s: string): string => {
    const amount = expected();
    return amount !== null && Number.isFinite(amount) && amount > 0 ? correctStatedTotals(s, amount) : s;
  };

  return {
    push(delta: string): string {
      buf += delta;
      const cut = safeCut();
      if (cut <= 0) return "";
      const head = buf.slice(0, cut);
      buf = buf.slice(cut);
      return fix(head);
    },
    flush(): string {
      const rest = buf;
      buf = "";
      return fix(rest);
    },
  };
}
