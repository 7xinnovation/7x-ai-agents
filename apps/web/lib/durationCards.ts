/**
 * The duration cards say what Emirates Post charges, or they say nothing.
 *
 * Rental/Bundle returns a price for one year and null for every longer term on
 * the personal bundles, so a five-year card can only be priced from a term
 * Emirates Post has actually charged for. Multiplying the annual rate is not an
 * approximation of that, it is a different and larger number: MyHome Instant's
 * five years is 4,000, not 4,975, and MyHome's ten is 4,000, not 6,950. The tool
 * result says so in as many words and the cards were still written by hand from
 * the annual rate.
 *
 * So the figures are stamped here, from the ladder the tool actually priced. A
 * term with no price loses the one it was given and says it is confirmed when
 * the box is reserved — an honest blank beats a wrong number in front of someone
 * comparing us against emiratespost.ae.
 *
 * Only cards titled as a term are touched. A bundle card, a branch card and a
 * box-number card go past untouched.
 */
const OPEN = "```cards";

/** The longest tail of `s` that is a proper prefix of `OPEN`. */
function heldTail(s: string): number {
  const max = Math.min(OPEN.length - 1, s.length);
  for (let n = max; n > 0; n--) if (OPEN.startsWith(s.slice(s.length - n))) return n;
  return 0;
}

export interface Term {
  years: number;
  rent: number | null;
  fee: number | null;
  total: number | null;
}

/** "- title: 5 Years" → 5. Anything else is not a duration card. */
export function yearsInTitle(title: string): number | null {
  const m = /^\s*(\d{1,2})\s*(?:-|\s)?\s*(?:year|yr|سنة|سنوات)/i.exec(title.trim());
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 && n <= 30 ? n : null;
}

const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Rewrite one card's money to the term's real figures. */
function stampCard(card: string, term: Term): string {
  let out = card;
  const priced = term.total !== null;
  // The headline figure.
  out = out.replace(/^([ \t]*price[ \t]*:[ \t]*).*$/im, (_m, head: string) =>
    priced ? `${head}AED ${money(term.total!)}` : `${head}Confirmed when the box is reserved`
  );
  // Any breakdown beside it — desc, badge, note — restated or emptied of money.
  out = out.replace(/^([ \t]*(?:desc|badge|note|pricenote)[ \t]*:[ \t]*)(.*)$/gim, (_m, head: string, body: string) => {
    if (!/AED/i.test(body)) return `${head}${body}`;
    if (!priced) {
      // A breakdown for a price we do not have is a price we do not have.
      const cleaned = body.replace(/\bAED[  ]*[\d,]+(?:\.\d{1,2})?/gi, "").replace(/\s{2,}/g, " ").replace(/^[\s+·|,-]+|[\s+·|,-]+$/g, "");
      return cleaned ? `${head}${cleaned}` : `${head}Price confirmed when the box is reserved`;
    }
    if (term.rent === null || term.fee === null) return `${head}${body}`;
    return `${head}Rental AED ${money(term.rent)} + registration AED ${money(term.fee)}`;
  });
  return out;
}

/** Stamp every duration card in one ```cards block. */
export function stampDurationCards(block: string, terms: Term[]): string {
  const byYears = new Map(terms.map((t) => [t.years, t]));
  // Cards are "- title: …" separated; keep everything between titles with its card.
  const parts = block.split(/(?=^[ \t]*-[ \t]+title[ \t]*:)/im);
  return parts
    .map((part) => {
      const title = /^[ \t]*-[ \t]+title[ \t]*:[ \t]*(.*)$/im.exec(part)?.[1] ?? "";
      const years = yearsInTitle(title);
      const term = years !== null ? byYears.get(years) : undefined;
      return term ? stampCard(part, term) : part;
    })
    .join("");
}

export function durationCardGuard(terms: () => Term[] | null) {
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
      const known = terms();
      const block = buf.slice(0, end);
      out += known?.length ? stampDurationCards(block, known) : block;
      buf = buf.slice(end);
      mode = "pass";
    }
  };

  return {
    push(delta: string): string {
      buf += delta;
      return step();
    },
    flush(): string {
      const rest = buf;
      buf = "";
      mode = "pass";
      return rest;
    },
  };
}
