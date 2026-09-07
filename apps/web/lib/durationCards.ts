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

/** What a line says once its figures are taken out, or nothing. */
const stripMoney = (body: string): string =>
  body
    .replace(/\bAED[  ]*[\d,]+(?:\.\d{1,2})?/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s+·|,\-–—]+|[\s+·|,\-–—]+$/g, "")
    .trim();

/** Rewrite one card's money to the term's real figures. */
function stampCard(card: string, term: Term): string {
  let out = card;
  const priced = term.total !== null;
  // The headline figure.
  out = out.replace(/^([ \t]*price[ \t]*:[ \t]*).*$/im, (_m, head: string) =>
    priced ? `${head}AED ${money(term.total!)}` : `${head}Confirmed when the box is reserved`
  );
  // The breakdown, ONCE.
  //
  // Every money-carrying line used to be rewritten to the same sentence, so a
  // card the model gave both a `desc:` and a `badge:` ended up stating "Rental
  // AED 1,595.00 + registration AED 70.00" twice — once in the body and once in
  // a highlighted pill directly above it. The 1-year and 10-year cards escaped
  // only because the model had not given them a badge.
  //
  // So the FIRST breakdown line carries the figures and the rest lose theirs.
  const BREAKDOWN = /^([ \t]*(desc|badge|note|pricenote)[ \t]*:[ \t]*)(.*)$/gim;
  // `desc` is the card's body and the natural place for it; a badge is a pill
  // and belongs to whatever it says of its own. So the breakdown goes in the
  // desc when there is one, and otherwise in the first line that carries money.
  BREAKDOWN.lastIndex = 0;
  const carriers = [...out.matchAll(BREAKDOWN)].filter((m) => /AED/i.test(m[3] ?? ""));
  const carrier = carriers.find((m) => (m[2] ?? "").toLowerCase() === "desc") ?? carriers[0];
  let stated = false;
  BREAKDOWN.lastIndex = 0;
  out = out.replace(BREAKDOWN, (_m, head: string, field: string, body: string) => {
    void field;
    const isCarrier = carrier !== undefined && _m === carrier[0] && !stated;
    if (!/AED/i.test(body)) return `${head}${body}`;
    if (!priced) {
      // A breakdown for a price we do not have is a price we do not have.
      const cleaned = stripMoney(body);
      return cleaned ? `${head}${cleaned}` : `${head}Price confirmed when the box is reserved`;
    }
    if (term.rent === null || term.fee === null) return `${head}${body}`;
    if (!isCarrier) {
      // A second line saying the same thing is not emphasis, it is noise. What
      // is left of it after the figures come out is kept only if it says
      // something of its own.
      const rest = stripMoney(body);
      return rest ? `${head}${rest}` : "";
    }
    stated = true;
    return `${head}Rental AED ${money(term.rent)} + registration AED ${money(term.fee)}`;
  });
  // Emptied lines leave a blank row behind; take the whole line with them.
  return out.replace(/^[ \t]*(?:desc|badge|note|pricenote)[ \t]*:[ \t]*$\n?/gim, "");
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
