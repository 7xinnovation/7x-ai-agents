/**
 * The registration fee belongs IN the summary card.
 *
 * Emirates Post asked for the amount to be visible before payment. It was — as a
 * sentence underneath the card: "Registration fee (AED 70) and any mandatory
 * charges are added when the box is reserved." That is the one place a customer
 * reading a table of what they will pay does not look, and asking for it as a
 * row kept producing another sentence.
 *
 * So the row is inserted on the way out, the same way the pay block's URL and
 * amount are. A card that already names the fee is left alone; a card with a
 * `total:` footer gets the row above it, because a total that does not include
 * the line above it is worse than no total at all.
 *
 * AND THE TOTAL ITSELF. A card listing 600 + 70 + 30 footed at "Total AED
 * 670.00" over a payment page asking 700 is not a rounding difference, it is
 * arithmetic done from memory. Where the real charge is known it replaces
 * whatever was written, so the card, the payment button and the gateway all say
 * one number.
 */
const OPEN = "```summary";

/** The longest tail of `s` that is a proper prefix of `OPEN`. */
function heldTail(s: string): number {
  const max = Math.min(OPEN.length - 1, s.length);
  for (let n = max; n > 0; n--) if (OPEN.startsWith(s.slice(s.length - n))) return n;
  return 0;
}

/** A row that names the fee AND states an amount for it. */
const PRICED_FEE = /^[ \t]*-[ \t]+[^\n:]*registration[^\n:]*:[^\n]*\d/im;

/**
 * A row charging for key delivery: "- Key courier delivery: AED 30.00".
 *
 * The customer's CHOICE lives here and, on 6 September, nowhere else. A MyBox
 * rental listed the courier, listed its 30, and was footed at 1,270 — the bare
 * reservation — because the choice had never been written into the case, so the
 * figure the guard stamped knew nothing about it. The card is asked what it is
 * selling instead of the state being asked what it remembers.
 */
const COURIER_ROW = /^[ \t]*-[ \t]+[^\n:]*\b(?:key[^\n:]*(?:courier|deliver)|courier[^\n:]*key)[^\n:]*:[^\n]*\d[^\n]*$/gim;
/**
 * The card's footer, written either way.
 *
 * The prompt asks for `total: AED x` and the model as often writes it as one
 * more bullet, `- Total: AED 1,300.00`. Only the first form was recognised, so
 * on a bulleted card the figure the customer reads was the model's arithmetic
 * with nothing checking it — right on 6 September by luck, not by design.
 */
const TOTAL_ROW = /^[ \t]*(?:[-*][ \t]+)?total[ \t]*:.*$/im;

/** The choice as a line of its own: "- Key delivery: Courier (AED 30 …)". */
const COURIER_CHOICE = /^([ \t]*-[ \t]+[^\n:]*key[^\n:]*deliver[^\n:]*:[ \t]*)(.*)$/im;

/** What the card says the customer is buying on top of the box. */
export function extrasNamedIn(block: string): { keyDelivery: boolean } {
  COURIER_ROW.lastIndex = 0;
  if (COURIER_ROW.test(block)) return { keyDelivery: true };
  const choice = COURIER_CHOICE.exec(block);
  return { keyDelivery: Boolean(choice && /courier|deliver/i.test(choice[2] ?? "")) };
}

/**
 * Take the courier back off a card that offered it on a reservation which does
 * not price it.
 *
 * Emirates Post prices KEY-DELIVERY per bundle, per term AND per branch, so a
 * service that exists on a three-year MyBox at one branch may not exist on a
 * five-year one at another. Charging 30 for it anyway is money taken for
 * nothing; leaving the row while the total excludes it is the card contradicting
 * itself. Both are removed here.
 */
export function dropCourier(block: string): string {
  // The stated choice first: rewriting it leaves no amount behind, so the sweep
  // for priced rows below cannot then delete the line altogether and leave the
  // customer with a card that never says how the key reaches them.
  let out = block;
  const choice = COURIER_CHOICE.exec(out);
  if (choice && /courier|deliver/i.test(choice[2] ?? "")) {
    out = out.replace(choice[0], `${choice[1]}Collect from the branch`);
  }
  COURIER_ROW.lastIndex = 0;
  return out.replace(COURIER_ROW, "").replace(/\n{3,}/g, "\n\n");
}

export function insertRegistrationFee(block: string, fee: number): string {
  // Naming the fee is not stating it. "Registration fee and exact total:
  // confirmed when box is reserved" mentions the word and leaves the customer
  // without the number — and it satisfied the old check, so the row was never
  // added. A row that names the fee without an amount is replaced.
  if (PRICED_FEE.test(block)) return block;
  const vague = /^[ \t]*-[ \t]+[^\n:]*registration[^\n:]*:[^\n]*$/im.exec(block);
  if (vague) return block.replace(vague[0], `- One-time registration fee: AED ${fee.toFixed(2)}`);
  const close = /\n[ \t]*```[ \t]*$/.exec(block);
  if (!close) return block;
  const body = block.slice(OPEN.length, close.index);
  // Only a card that actually lists rows; a bare fenced word is not a summary.
  if (!/^[ \t]*-[ \t]+\S/m.test(body)) return block;
  const row = `\n- One-time registration fee: AED ${fee.toFixed(2)}`;
  // TOTAL_ROW anchors at the start of the footer's own line, so the new row is
  // spliced in ahead of it rather than glued onto its front.
  const total = TOTAL_ROW.exec(body);
  const next = total ? `${body.slice(0, total.index)}${row.slice(1)}\n${body.slice(total.index)}` : body + row;
  return OPEN + next + block.slice(close.index);
}

/** Force the card's footer to the amount that will actually be charged. */
export function correctTotal(block: string, total: number): string {
  const close = /\n[ \t]*```[ \t]*$/.exec(block);
  if (!close) return block;
  const body = block.slice(OPEN.length, close.index);
  if (!/^[ \t]*-[ \t]+\S/m.test(body)) return block;
  const written = TOTAL_ROW.exec(body);
  // Keep the shape the card already uses: a bulleted footer stays bulleted, so
  // correcting the figure does not reformat the card around it.
  const bullet = /^[ \t]*([-*][ \t]+)/.exec(written?.[0] ?? "");
  const line = `${bullet?.[1] ? `- ` : ""}${bullet ? "Total" : "total"}: AED ${total.toFixed(2)}`;
  // A card with no footer is left without one: adding a total to a summary that
  // deliberately has none (the pre-reservation one, where the figure is not yet
  // final) would state a number the journey is not ready to state.
  if (!written) return block;
  return OPEN + body.replace(written[0], line) + block.slice(close.index);
}

/**
 * What the customer is actually buying, when the card forgot to say.
 *
 * Reported twice on 10 September, as separate bugs, and it is one: "the P.O. Box
 * number and location were selected during the rental journey, but these details
 * are not displayed in the Selection Summary", and "the selected P.O. Box details
 * are not displayed for review and confirmation before proceeding with the
 * payment". Asked for it directly, the assistant produced a complete card with
 * PO Box 392028 and Al Quoz Fourth Branch in it — so nothing was missing from
 * the case, only from the card.
 *
 * A summary that omits the box and the branch is a summary of the wrong thing:
 * those two ARE the purchase, and everything else on the card is a term of it.
 * So they are inserted rather than asked for, above the money, in the order the
 * customer chose them.
 *
 * Only ever inserted, never corrected. A row the card already carries stands as
 * written, whatever it says — if the card and the case disagree that is a real
 * problem and papering over it here would hide it.
 */
export interface SummaryFacts {
  boxNumber?: string | null;
  branch?: string | null;
}

/** A row whose label mentions this thing AND carries a value. */
const hasRow = (body: string, label: RegExp) =>
  new RegExp(`^[ \\t]*-[ \\t]+[^\\n:]*(?:${label.source})[^\\n:]*:[ \\t]*\\S`, "im").test(body);

export function insertSelectionRows(block: string, facts: SummaryFacts, locale?: string): string {
  const close = /\n[ \t]*```[ \t]*$/.exec(block);
  if (!close) return block;
  const body = block.slice(OPEN.length, close.index);
  // Only a card that actually lists rows; a bare fenced word is not a summary.
  if (!/^[ \t]*-[ \t]+\S/m.test(body)) return block;

  const ar = locale === "ar";
  const wanted: { label: string; value: string; has: RegExp }[] = [];
  const box = String(facts.boxNumber ?? "").trim();
  const branch = String(facts.branch ?? "").trim();
  if (box) wanted.push({ label: ar ? "الصندوق" : "PO Box", value: box, has: /p\.?o\.? ?box|box number|الصندوق|صندوق/ });
  if (branch) wanted.push({ label: ar ? "الفرع" : "Branch", value: branch, has: /branch|office|الفرع|مكتب/ });

  const rows = wanted.filter((w) => !hasRow(body, w.has)).map((w) => `- ${w.label}: ${w.value}`);
  if (!rows.length) return block;

  // Above the money. A summary reads as a description of the thing followed by
  // what it costs, and a box number below the total reads as an afterthought.
  const firstMoney = /^[ \t]*(?:[-*][ \t]+)?[^\n:]*(?:fee|rental|total|AED|الرسوم|الإجمالي|درهم)[^\n:]*:/im.exec(body);
  const at = firstMoney ? firstMoney.index : body.length;
  const head = body.slice(0, at).replace(/\n+$/, "");
  const tail = body.slice(at);
  const next = tail ? `${head}\n${rows.join("\n")}\n${tail}` : `${head}\n${rows.join("\n")}`;
  return OPEN + next + block.slice(close.index);
}

export function summaryFeeGuard(
  fee: () => number | null,
  /**
   * The real charge for the card as written — given what the card itself says
   * the customer chose, because the model states the choice in the card several
   * turns before it ever reaches the case.
   */
  total: (extras: { keyDelivery: boolean }) => number | null = () => null,
  /**
   * Whether the reservation prices key delivery at all. False removes the row;
   * true (the default) leaves the card's own choice standing.
   */
  courierPriced: () => boolean = () => true,
  /** The box and branch the customer picked, for a card that left them out. */
  facts: () => SummaryFacts = () => ({}),
  locale?: string,
  /**
   * The receipt for a payment that has already settled, or null. Supplied only
   * for a settled payment — see insertReceiptRow.
   */
  receipt: () => string | null = () => null
) {
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
      const trailing = close[1] ?? "";
      const block = buf.slice(0, end - trailing.length);
      const amount = fee();
      let fixed = amount !== null && Number.isFinite(amount) ? insertRegistrationFee(block, amount) : block;
      // The purchase itself, before anything priced.
      fixed = insertSelectionRows(fixed, facts(), locale);
      // Sold only if Emirates Post priced it on this reservation.
      if (extrasNamedIn(fixed).keyDelivery && !courierPriced()) fixed = dropCourier(fixed);
      const charge = total(extrasNamedIn(fixed));
      if (charge !== null && Number.isFinite(charge) && charge > 0) fixed = correctTotal(fixed, charge);
      // Last, and only on a card that is reporting a finished transaction.
      const url = receipt();
      if (url) fixed = insertReceiptRow(fixed, url, locale);
      out += fixed + trailing;
      buf = buf.slice(end);
      mode = "pass";
    }
  };

  return {
    push(delta: string): string {
      buf += delta;
      return step();
    },
    /** Whatever is still held when the message ends. An unclosed fence is text. */
    flush(): string {
      const rest = buf;
      buf = "";
      mode = "pass";
      return rest;
    },
  };
}

/**
 * THE RECEIPT BELONGS IN THE CARD TOO.
 *
 * Reported 16 September, with an arrow drawn from the panel's "Download receipt"
 * to the confirmation card in the chat: the link exists, in the application
 * panel, on the right, which is not where a customer reading "APPLICATION
 * CONFIRMED" is looking. In the chat it appears only on the turn the payment
 * arrives — and EPGL settles the card payment one turn BEFORE the confirmation
 * is written, so the message that confirms the application is the one message
 * that never carried it.
 *
 * So it is put where the confirmation is, as a row of the card, the same way the
 * registration fee and the box number are. Never on a card that is still asking
 * the customer to confirm something: a receipt for a payment that has not
 * happened is worse than no receipt at all, which is why the caller supplies the
 * URL only for a settled payment and this only accepts a card that is reporting
 * a finished transaction.
 */
const RECEIPT_ROW = /^[ \t]*-[ \t]+[^\n:]*(?:receipt|إيصال)[^\n:]*:/im;
/** A card REPORTING a completed transaction, not one asking to start one. */
const REPORTS_COMPLETION =
  /^[ \t]*-[ \t]+[^\n:]*(?:reference|مرجع)[^\n:]*:[ \t]*\S/im;
const SAYS_SETTLED = /\bpaid\b|\bsubmitted\b|مدفوع|تم الإرسال|تم الدفع/i;

export function insertReceiptRow(block: string, url: string, locale?: string): string {
  if (!url || block.includes("/api/receipt/")) return block;
  const close = /\n[ \t]*```[ \t]*$/.exec(block);
  if (!close) return block;
  const body = block.slice(OPEN.length, close.index);
  // Only a card that actually lists rows; a bare fenced word is not a summary.
  if (!/^[ \t]*-[ \t]+\S/m.test(body)) return block;
  if (!REPORTS_COMPLETION.test(body) && !SAYS_SETTLED.test(body)) return block;
  if (RECEIPT_ROW.test(body)) return block;
  const ar = locale === "ar";
  const row = `- ${ar ? "الإيصال" : "Receipt"}: [${ar ? "تحميل الإيصال" : "Download receipt"}](${url})`;
  // Last, below any total: the receipt is not one of the things being bought.
  return OPEN + `${body.replace(/\n+$/, "")}\n${row}` + block.slice(close.index);
}
