/**
 * EPGL 2.0: the licence menu is the catalogue, every time (6 November 2026).
 *
 * Reported by a tester: "the available service catalogue displayed different
 * license options and SME categories" across sessions, and changed on refresh.
 * It did. The menu was written by the model, and across 17 sessions it wrote
 * three different ones: all ten products; seven, with the three CEP30
 * ownership groups each folded into one card and a second question for
 * domestic or international; and the ten with the scope moved into the card's
 * description, so two cards had the same title.
 *
 * The ten products are already data — the `product_code` field's options, one
 * per catalogue code, in both languages. So whatever menu the model writes is
 * replaced here by that list: same products, same order, same names, the code
 * as each card's key. Only a block that IS the licence menu is touched — one
 * naming at least two products — and any other cards go past untouched.
 */
import { tr, type AgentDefinition, type Locale } from "@dialog/config";

const OPEN = "```cards";

export interface ProductOption {
  code: string;
  label: string;
}

/** The product_code field's options, in the customer's language. */
export function productOptions(def: AgentDefinition, locale: Locale): ProductOption[] {
  if (def.tenantSlug !== "epgl") return [];
  for (const j of def.journeys)
    for (const s of j.steps)
      for (const f of s.fields)
        if (f.key === "product_code" && Array.isArray((f as { options?: unknown }).options)) {
          const opts = (f as unknown as { options: { value: string; label: Parameters<typeof tr>[0] }[] }).options;
          return opts.map((o) => ({ code: o.value, label: tr(o.label, locale) || o.value }));
        }
  return [];
}

type Two = { en: string; ar: string };

/**
 * LICENCES AND PERMITS, AND WHAT EACH ONE IS FOR (9 November 2026).
 *
 * BUG-177: "The service list should clearly distinguish between License
 * applications and Permit applications." BUG-178: "The SME category is missing
 * from the CEP License description."
 *
 * Which is which is the catalogue's own `designation` (fixtures/epgl-catalogue
 * -2026-10-22.json): LOCKERS and OUTSOURCE are Permits, the other eight are
 * Licences. The descriptions are written from its `description` and
 * `eligibilitySummary` — the catalogue's own text is one paragraph shared by all
 * six CEP products and names neither the ownership nor the SME tier, which is
 * exactly what tells them apart.
 */
const PERMITS = new Set(["LOCKERS", "OUTSOURCE"]);
const CEP_SCOPE = (intl: boolean): Two =>
  intl
    ? { en: "Documents and parcels up to 30 kg, within the UAE and internationally.", ar: "الوثائق والطرود حتى 30 كجم، داخل الدولة وخارجها." }
    : { en: "Documents and parcels up to 30 kg, within the UAE only.", ar: "الوثائق والطرود حتى 30 كجم، داخل الدولة فقط." };
const CEP_WHO: Record<string, Two> = {
  UAE: { en: "For SMEs owned by UAE nationals.", ar: "للمنشآت الصغيرة والمتوسطة المملوكة لمواطنين." },
  NONUAE: { en: "For SMEs not owned by UAE nationals.", ar: "للمنشآت الصغيرة والمتوسطة غير المملوكة لمواطنين." },
  GEN: { en: "General tier, for companies that are not SMEs.", ar: "الفئة العامة، للشركات غير المصنفة منشآت صغيرة ومتوسطة." },
};
const OTHER_DESC: Record<string, Two> = {
  FOODMED: {
    en: "Delivery of food and medicines. Issued conditionally, pending inspection of your premises.",
    ar: "توصيل الأغذية والأدوية. يصدر الترخيص بشكل مشروط لحين تفتيش المقر.",
  },
  INTERMED: {
    en: "Connecting senders with licensed delivery operators, or running a delivery platform. Issued conditionally, pending verification.",
    ar: "الوساطة بين المرسلين ومشغلي التوصيل المرخصين أو تشغيل منصة توصيل. يصدر بشكل مشروط لحين التحقق.",
  },
  LOCKERS: {
    en: "Parcel lockers and pick-up/drop-off points. For CEP licence holders, or together with a new CEP licence.",
    ar: "الخزائن الإلكترونية ونقاط الاستلام والتسليم. لحاملي ترخيص البريد السريع أو مع طلب ترخيص جديد.",
  },
  OUTSOURCE: {
    en: "Carrying out delivery work on behalf of a licensed operator. For CEP licence holders.",
    ar: "تنفيذ أعمال التوصيل نيابةً عن مشغل مرخص. لحاملي ترخيص البريد السريع.",
  },
};

export const isPermit = (code: string) => PERMITS.has(code.trim().toUpperCase());

/** The card's one-line description, in the customer's language. */
export function productDescription(code: string, locale: Locale): string | undefined {
  const c = code.trim().toUpperCase();
  const pick = (t: Two) => (locale === "ar" ? t.ar : t.en);
  const cep = /^CEP30-(UAE|NONUAE|GEN)-(?:SME-)?(DOM|INTL)$/.exec(c);
  if (cep) return `${pick(CEP_WHO[cep[1]!]!)} ${pick(CEP_SCOPE(cep[2] === "INTL"))}`;
  return OTHER_DESC[c] ? pick(OTHER_DESC[c]!) : undefined;
}

const cardLines = (o: ProductOption, locale: Locale): string => {
  const desc = productDescription(o.code, locale);
  const sme = productDerived(o.code).product_is_sme;
  return [
    `- title: ${o.label}`,
    desc ? `  desc: ${desc}` : "",
    sme ? `  badge: ${locale === "ar" ? "منشأة صغيرة ومتوسطة" : "SME"}` : "",
  ]
    .filter(Boolean)
    .join("\n");
};

/**
 * Two groups — Licences, then Permits — each its own set of cards.
 *
 * No `key` line: the cards renderer has none, and any line it does not know is
 * printed as a labelled row, which put "key CEP30-UAE-SME-DOM" on every card
 * (seen on staging, 6 November). A tap sends the title; productFromMessage
 * turns it back into the code.
 */
export function canonicalProductBlock(options: ProductOption[], locale: Locale = "en"): string {
  const block = (os: ProductOption[]) => `${OPEN}\n${os.map((o) => cardLines(o, locale)).join("\n")}\n\`\`\``;
  const licences = options.filter((o) => !isPermit(o.code));
  const permits = options.filter((o) => isPermit(o.code));
  if (!permits.length || !licences.length) return block(options);
  const h = locale === "ar" ? { l: "**التراخيص**", p: "**التصاريح**" } : { l: "**Licences**", p: "**Permits**" };
  return `${h.l}\n\n${block(licences)}\n\n${h.p}\n\n${block(permits)}`;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, "");

/**
 * The two fields every later question and document is conditioned on, from the
 * code alone — the rule their own field help states: product_family is CEP30
 * for any CEP30-* product and otherwise the code; product_is_sme is true when
 * the code says SME. They were left to the model, so a product recorded by the
 * server (a tapped card) had neither, and the batch offered no lease, SME
 * licence, insurance, fleet or standards slot: five files "not recognised"
 * (staging, 6 November).
 */
export function productDerived(code: string): { product_family: string; product_is_sme: boolean } {
  const c = code.trim().toUpperCase();
  return { product_family: c.startsWith("CEP30") ? "CEP30" : c, product_is_sme: /(^|-)SME(-|$)/.test(c) };
}

/**
 * THE WEIGHT IS THE PRODUCT'S, NOT A QUESTION (BUG-180, BUG-182, 9 Nov 2026).
 *
 * Every CEP30 product is a ≤30 kg licence, and the field's own help says "NOT
 * A QUESTION FOR THE CUSTOMER: set it to 30 as soon as the product is chosen".
 * Left to the model it was asked anyway — as "will you carry shipments ABOVE
 * 30 kg?" under a "Yes to all three" button, and again later in the journey.
 * Filled here, only while empty: a customer who says they carry heavier and
 * has it recorded is not overwritten.
 */
export function productDefaults(code: string, data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const w = data.declared_max_shipment_weight_kg;
  if (productDerived(code).product_family === "CEP30" && (w === undefined || w === null || w === "")) out.declared_max_shipment_weight_kg = 30;
  return out;
}

/**
 * The product a message names: a tapped card (its title, in either language)
 * or the bare code. Exact matches only — "the CEP one" is left to the model.
 *
 * Needed BEFORE the turn: the model records product_code during its reply, so
 * on the tap's own turn the case still had no product, the server thought the
 * licence was not yet chosen, and the "Upload all at once" offer was never
 * made — every turn after it was an upload turn (staging, 6 November).
 */
export function productFromMessage(def: AgentDefinition, message: string | undefined): string | null {
  const m = norm(message ?? "");
  if (!m) return null;
  for (const locale of ["en", "ar"] as const)
    for (const o of productOptions(def, locale)) if (m === norm(o.label) || m === norm(o.code)) return o.code;
  return null;
}

/** A cards block naming two or more products — by code, by full name, or by the name before its scope. */
export function isProductMenu(block: string, options: ProductOption[]): boolean {
  if (options.length < 2) return false;
  const body = block.slice(OPEN.length);
  const flat = norm(body);
  let hits = 0;
  for (const o of options) {
    const head = o.label.split(" — ").slice(0, 2).join(" — ");
    if (body.includes(o.code) || flat.includes(norm(o.label)) || (head.length > 12 && flat.includes(norm(head)))) hits++;
  }
  return hits >= 2;
}

/** The longest tail of `s` that is a proper prefix of `open`. */
function heldTail(s: string, open: string): number {
  const max = Math.min(open.length - 1, s.length);
  for (let n = max; n > 0; n--) if (open.startsWith(s.slice(s.length - n).toLowerCase())) return n;
  return 0;
}

/**
 * Streaming: passes text through, holding only a fenced block that opens with
 * `open` until it closes, then lets `rewrite` decide what goes out instead.
 */
function fencedGuard(open: string, rewrite: (block: string, closed: boolean) => string) {
  let mode: "pass" | "capture" = "pass";
  let buf = "";
  const step = (): string => {
    let out = "";
    for (;;) {
      if (mode === "pass") {
        const i = buf.toLowerCase().indexOf(open);
        if (i === -1) {
          const hold = heldTail(buf, open);
          out += buf.slice(0, buf.length - hold);
          buf = buf.slice(buf.length - hold);
          return out;
        }
        out += buf.slice(0, i);
        buf = buf.slice(i);
        mode = "capture";
        continue;
      }
      const close = /\n[ \t]*```[ \t]*(\n|$)/.exec(buf.slice(open.length));
      if (!close) return out;
      const end = open.length + close.index + close[0].length;
      const block = buf.slice(0, end);
      const trailing = close[1] === "\n" ? "\n" : "";
      const replaced = rewrite(block, true);
      out += replaced === block ? block : replaced ? replaced + trailing : "";
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
      // An unclosed block at the very end of the reply is judged as it stands.
      const rest = buf;
      buf = "";
      mode = "pass";
      return rest.toLowerCase().startsWith(open) ? rewrite(rest, false) : rest;
    },
  };
}

/**
 * The licence menu, whoever wrote it, goes out as the catalogue's ten — once.
 * A model that splits its own menu into two blocks (licences, then permits)
 * has each one recognised; the first becomes the whole menu and the second is
 * dropped, rather than showing the ten twice.
 */
export function productCardGuard(options: () => ProductOption[], locale: () => Locale = () => "en") {
  let shown = false;
  return fencedGuard(OPEN, (block) => {
    const opts = options();
    if (!isProductMenu(block, opts) && !(shown && isPartialMenu(block, opts))) return block;
    if (shown) return "";
    shown = true;
    return canonicalProductBlock(opts, locale());
  });
}

/** A block naming even one product, once the whole menu has gone out. */
function isPartialMenu(block: string, options: ProductOption[]): boolean {
  const body = block.slice(OPEN.length);
  const flat = norm(body);
  return options.some((o) => body.includes(o.code) || flat.includes(norm(o.label)));
}

/**
 * NO UPLOAD BEFORE THE LICENCE (6 November 2026).
 *
 * Every document depends on the licence, and "Upload all at once" is offered
 * only once it is chosen — so a document asked for before it is a document
 * taken one at a time, outside the batch. Seen on staging: the applicant said
 * the signed-in company was not theirs, and the trade licence was asked for at
 * once, before the menu, despite the directive saying the licence comes first.
 *
 * While no product is chosen, an ```upload block is replaced by the licence
 * menu — or dropped, when this reply already shows the menu or recorded a
 * product along the way.
 */
export function noUploadBeforeProductGuard(active: () => boolean, options: () => ProductOption[], locale: () => Locale = () => "en") {
  let menuShown = false;
  const watch = productCardGuard(options, locale);
  const upload = fencedGuard("```upload", (block) => {
    if (!active()) return block;
    const opts = options();
    if (menuShown || opts.length < 2) return "";
    menuShown = true;
    return canonicalProductBlock(opts, locale());
  });
  // The cards guard runs first, so a menu the model wrote is seen (and
  // normalised) before any upload block after it.
  return {
    push(d: string): string {
      const out = watch.push(d);
      if (out.includes(OPEN) && isProductMenu(out.slice(out.indexOf(OPEN)), options())) menuShown = true;
      return upload.push(out);
    },
    flush(): string {
      const out = watch.flush();
      if (out.includes(OPEN) && isProductMenu(out.slice(out.indexOf(OPEN)), options())) menuShown = true;
      return upload.push(out) + upload.flush();
    },
  };
}

/** Two streaming guards as one: `first` runs, then `second` on what it let out. */
export function chainGuards(
  first: { push(d: string): string; flush(): string },
  second: { push(d: string): string; flush(): string }
) {
  return {
    push: (d: string) => second.push(first.push(d)),
    flush: () => second.push(first.flush()) + second.flush(),
  };
}
