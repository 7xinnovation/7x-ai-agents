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

/**
 * Titles only. The cards renderer has no `key` — any line it does not know is
 * printed as a labelled row, which put "key CEP30-UAE-SME-DOM" on every card
 * (seen on staging, 6 November). A tap sends the title; productFromMessage
 * turns it back into the code.
 */
export function canonicalProductBlock(options: ProductOption[]): string {
  return `${OPEN}\n${options.map((o) => `- title: ${o.label}`).join("\n")}\n\`\`\``;
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

/** The licence menu, whoever wrote it, goes out as the catalogue's ten. */
export function productCardGuard(options: () => ProductOption[]) {
  return fencedGuard(OPEN, (block) => {
    const opts = options();
    return isProductMenu(block, opts) ? canonicalProductBlock(opts) : block;
  });
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
export function noUploadBeforeProductGuard(active: () => boolean, options: () => ProductOption[]) {
  let menuShown = false;
  const watch = productCardGuard(options);
  const upload = fencedGuard("```upload", (block) => {
    if (!active()) return block;
    const opts = options();
    if (menuShown || opts.length < 2) return "";
    menuShown = true;
    return canonicalProductBlock(opts);
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
