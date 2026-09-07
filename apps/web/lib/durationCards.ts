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

/**
 * A line that is only a price breakdown — "Rental AED 1,595.00 + registration
 * AED 70.00" — as opposed to one that says something of its own.
 */
function isBreakdown(body: string): boolean {
  if (!/AED/i.test(body)) return false;
  if (/rental/i.test(body) && /registration/i.test(body)) return true;
  return stripMoney(body) === "";
}

/** Rewrite one card's money to the term's real figures. */
function stampCard(card: string, term: Term): string {
  let out = card;
  const priced = term.total !== null;
  // The headline figure.
  out = out.replace(/^([ \t]*price[ \t]*:[ \t]*).*$/im, (_m, head: string) =>
    priced ? `${head}AED ${money(term.total!)}` : `${head}Confirmed when the box is reserved`
  );

  // THE BREAKDOWN, ONCE, AND IN THE SAME PLACE ON EVERY CARD.
  //
  // The model writes these cards inconsistently: some get a `badge:` carrying
  // the breakdown, some get only a `desc:` with the expiry, and the guard used
  // to touch only the lines that already carried money — so it preserved that
  // inconsistency exactly. In the same five-card block, 2, 3, 5 and 10 years
  // wore a highlighted pill and 1 year did not.
  //
  // So the breakdown always ends up in `desc`, beside whatever that line already
  // said (the expiry, usually), and any OTHER line that was purely a breakdown
  // goes. A badge that says something of its own — "Most popular", a saving — is
  // left exactly as it was; it is not a duplicate of anything.
  const BREAKDOWN = /^([ \t]*(desc|badge|note|pricenote)[ \t]*:[ \t]*)(.*)$/gim;
  // What the card's own body line says besides money — the expiry, usually. It
  // is folded in beside the breakdown so the card keeps it. Only `desc` is
  // folded: a badge is a pill of its own and stays one.
  BREAKDOWN.lastIndex = 0;
  const descLine = [...out.matchAll(BREAKDOWN)].find((m) => (m[2] ?? "").toLowerCase() === "desc");
  const kept = descLine && !isBreakdown(descLine[3] ?? "") ? stripMoney(descLine[3] ?? "") : "";

  const line =
    priced && term.rent !== null && term.fee !== null
      ? [`Rental AED ${money(term.rent)} + registration AED ${money(term.fee)}`, kept].filter(Boolean).join(" · ")
      : [kept, "Price confirmed when the box is reserved"].filter(Boolean).join(" · ");

  let placed = false;
  BREAKDOWN.lastIndex = 0;
  out = out.replace(BREAKDOWN, (_m, head: string, field: string, body: string) => {
    if ((field ?? "").toLowerCase() === "desc" && !placed) {
      placed = true;
      return `${head}${line}`;
    }
    // Any OTHER line that was only a price breakdown is the duplicate; a line
    // saying something of its own is not, and is left exactly as written.
    return isBreakdown(body) ? "" : `${head}${body}`;
  });

  // No desc at all: give the card one, under its title.
  if (!placed) {
    out = out.replace(/^([ \t]*-[ \t]+title[ \t]*:[ \t]*.*)$/im, (m) => `${m}\n  desc: ${line}`);
  }
  // A removed line leaves its newline behind, and a blank row in the middle of
  // a card renders as a gap under the title. Take the whole line with it —
  // but only inside a card, so the blank lines BETWEEN cards are left alone.
  return out
    .replace(/^[ \t]*(?:desc|badge|note|pricenote)[ \t]*:[ \t]*$\n?/gim, "")
    .replace(/^[ \t]*\n(?=[ \t]+[A-Za-z]+[ \t]*:)/gm, "");
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
