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

/** The longest tail of `s` that is a proper prefix of OPEN. */
function heldTail(s: string): number {
  const max = Math.min(OPEN.length - 1, s.length);
  for (let n = max; n > 0; n--) if (OPEN.startsWith(s.slice(s.length - n).toLowerCase())) return n;
  return 0;
}

/** Streaming: passes text through, holding only a cards block until it closes. */
export function productCardGuard(options: () => ProductOption[]) {
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
      const block = buf.slice(0, end);
      const opts = options();
      const trailing = close[1] === "\n" ? "\n" : "";
      out += isProductMenu(block, opts) ? canonicalProductBlock(opts) + trailing : block;
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
      // An unclosed block at the end of the reply is still the menu if it names products.
      const rest = buf;
      buf = "";
      mode = "pass";
      if (rest.toLowerCase().startsWith(OPEN) && isProductMenu(rest, options())) return canonicalProductBlock(options());
      return rest;
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
