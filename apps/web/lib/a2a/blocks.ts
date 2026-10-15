/**
 * The agent's fenced blocks, read for a machine.
 *
 * The chat widget renders ```buttons, ```pay, ```summary and the rest as
 * controls. An A2A client gets the same reply as text, so each block is lifted
 * out into a typed object and the text keeps a plain-language line in its
 * place — a client that ignores the structure still reads a sensible message,
 * and one that uses it knows exactly what to send back.
 *
 * Grammar mirrors apps/web/app/embed/[agent]/Markdown.tsx.
 */

export type ReplyBlock =
  | { type: "pay"; url: string; amount?: string; label?: string }
  | { type: "buttons"; options: string[]; reply: "Send the option's text as the next message." }
  | { type: "select"; title?: string; options: { label: string; group?: string }[]; confirm: string; reply: "Send the chosen option's text as the next message." }
  | {
      type: "toggles";
      title?: string;
      style: "switch" | "checkbox";
      items: { key: string; label: string }[];
      confirm: string[];
      reply: string;
    }
  | { type: "summary"; title?: string; rows: { label: string; value: string }[]; total?: { label: string; value: string } }
  | { type: "cards"; cards: { title: string; price?: string; priceNote?: string; desc?: string; badge?: string; disabled?: boolean; attrs: { label: string; value: string }[] }[]; reply: "Send the card's title as the next message." }
  | { type: "map"; emirate: string; bundle: string; reply: "Branches are listed by name; send a branch name as the next message." }
  | { type: "locate"; label?: string; reply: "Send an address or 'latitude, longitude' as the next message." }
  | { type: "upload"; document: string; reply: "File parts are not accepted on this doorway; say the document is not available or continue without it." }
  | { type: "other"; kind: string; body: string };

export interface ParsedReply {
  /** The reply with every block replaced by a plain line. */
  text: string;
  blocks: ReplyBlock[];
}

const FENCE = /```([a-z][\w-]*)?[ \t]*\n([\s\S]*?)```/g;

const meta = (lines: string[], k: string): string | undefined =>
  lines.map((l) => l.match(new RegExp(`^\\s*${k}\\s*:\\s*(.+?)\\s*$`, "i"))).find(Boolean)?.[1]?.trim();
const items = (lines: string[]): string[] =>
  lines.map((l) => l.match(/^\s*-\s+(.*\S)\s*$/)).filter(Boolean).map((m) => m![1]!.trim());
const plainLabel = (s: string) => s.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

function parseCards(lines: string[]): Extract<ReplyBlock, { type: "cards" }>["cards"] {
  const cards: Extract<ReplyBlock, { type: "cards" }>["cards"] = [];
  let cur: (typeof cards)[number] | null = null;
  const apply = (card: (typeof cards)[number], key: string, value: string) => {
    const k = key.trim().toLowerCase();
    const v = value.trim();
    if (k === "title" || k === "name") card.title = v;
    else if (k === "price" || k === "cost") card.price = v;
    else if (k === "pricenote" || k === "price_note" || k === "fee" || k === "feenote") card.priceNote = v;
    else if (k === "desc" || k === "description" || k === "subtitle") card.desc = v;
    else if (k === "badge" || k === "tag") card.badge = v;
    else if (k === "disabled" || k === "unavailable") card.disabled = !/^(no|false|0)$/i.test(v);
    else if (!card.title) card.title = v;
    else card.attrs.push({ label: key.trim(), value: v });
  };
  for (const raw of lines) {
    const item = raw.match(/^\s*-\s+(.*)$/);
    const kv = raw.match(/^\s*([A-Za-z][\w ]*?):\s*(.*)$/);
    if (item) {
      if (cur) cards.push(cur);
      cur = { title: "", attrs: [] };
      const inline = item[1]!.match(/^([A-Za-z][\w ]*?):\s*(.*)$/);
      if (inline) apply(cur, inline[1]!, inline[2]!);
      else cur.title = item[1]!.trim();
    } else if (kv && cur) apply(cur, kv[1]!, kv[2]!);
  }
  if (cur) cards.push(cur);
  return cards.filter((c) => c.title || c.desc || c.attrs.length);
}

function blockFor(kind: string, body: string): { block: ReplyBlock | null; line: string } {
  const lines = body.split("\n");
  switch (kind.toLowerCase()) {
    case "pay": {
      const url = meta(lines, "url");
      if (!url) return { block: null, line: "" };
      const amount = meta(lines, "amount");
      const label = meta(lines, "label");
      return { block: { type: "pay", url, amount, label }, line: `${label ?? (amount ? `Pay ${amount}` : "Pay")}: ${url}` };
    }
    case "buttons": {
      const options = items(lines);
      if (!options.length) return { block: null, line: "" };
      return { block: { type: "buttons", options, reply: "Send the option's text as the next message." }, line: `Options: ${options.join(" · ")}` };
    }
    case "select": {
      let group: string | undefined;
      const options: { label: string; group?: string }[] = [];
      for (const l of lines) {
        const item = l.match(/^\s*-\s+(.*\S)\s*$/);
        const g = l.match(/^\s*group\s*:\s*(.+?)\s*$/i);
        if (item) options.push({ label: item[1]!.trim(), ...(group ? { group } : {}) });
        else if (g) group = g[1]!.trim();
      }
      if (!options.length) return { block: null, line: "" };
      const title = meta(lines, "title");
      const confirm = meta(lines, "confirm") ?? "Continue";
      return {
        block: { type: "select", title, options, confirm, reply: "Send the chosen option's text as the next message." },
        line: `${title ? title + " — " : ""}Options: ${options.map((o) => o.label).join(" · ")}`,
      };
    }
    case "toggles": {
      const its: { key: string; label: string }[] = [];
      for (const l of lines) {
        const item = l.match(/^\s*-\s+([\w.-]+)\s*:\s*(.+?)\s*$/);
        if (item) its.push({ key: item[1]!.trim(), label: plainLabel(item[2]!.trim()) });
      }
      if (!its.length) return { block: null, line: "" };
      const title = meta(lines, "title");
      const confirm = (meta(lines, "confirm") ?? "Confirm").split("|").map((x) => x.trim()).filter(Boolean);
      const style: "switch" | "checkbox" = /checkbox/i.test(meta(lines, "style") ?? "") ? "checkbox" : "switch";
      const example = `${its.map((i) => `${i.label}: Yes`).join(". ")}. ${confirm[0]}.`;
      return {
        block: { type: "toggles", title, style, items: its, confirm, reply: `Send each choice as "<label>: Yes" or "<label>: No", then the confirm label, for example: ${example}` },
        line: `${title ? title + " — " : ""}${its.map((i) => `${i.label} (yes/no)`).join("; ")}. Then confirm with: ${confirm.join(" or ")}`,
      };
    }
    case "summary": {
      const rows: { label: string; value: string }[] = [];
      let total: { label: string; value: string } | undefined;
      for (const l of lines) {
        const m = l.match(/^\s*(title|total)\s*:\s*(.+?)\s*$/i);
        const row = l.match(/^\s*-\s+(.+?)\s*:\s*(.+?)\s*$/);
        if (m && /^total$/i.test(m[1]!)) {
          const t = m[2]!.trim();
          const split = t.match(/^(.+?)\s*:\s*(.+)$/);
          total = split ? { label: split[1]!.trim(), value: split[2]!.trim() } : { label: "Total", value: t };
        } else if (row) rows.push({ label: row[1]!.trim(), value: row[2]!.trim() });
      }
      if (!rows.length && !total) return { block: null, line: "" };
      const title = meta(lines, "title");
      return {
        block: { type: "summary", title, rows, total },
        line: [title, ...rows.map((r) => `${r.label}: ${r.value}`), total ? `${total.label}: ${total.value}` : ""].filter(Boolean).join("\n"),
      };
    }
    case "cards": {
      const cards = parseCards(lines);
      if (!cards.length) return { block: null, line: "" };
      return {
        block: { type: "cards", cards, reply: "Send the card's title as the next message." },
        line: cards.map((c) => `- ${c.title}${c.price ? ` — ${c.price}` : ""}${c.desc ? ` — ${c.desc}` : ""}${c.disabled ? " (unavailable)" : ""}`).join("\n"),
      };
    }
    case "map": {
      const emirate = (meta(lines, "emirate") ?? "").toUpperCase();
      const bundle = meta(lines, "bundle") ?? "";
      if (!emirate || !bundle) return { block: null, line: "" };
      return {
        block: { type: "map", emirate, bundle, reply: "Branches are listed by name; send a branch name as the next message." },
        line: `(A map of nearby branches in ${emirate} was offered; name the branch you want.)`,
      };
    }
    case "locate":
      return { block: { type: "locate", label: meta(lines, "label"), reply: "Send an address or 'latitude, longitude' as the next message." }, line: "(Share your location: send an address or coordinates.)" };
    case "upload": {
      const document = lines.map((l) => l.trim()).find(Boolean) ?? "";
      return {
        block: { type: "upload", document, reply: "File parts are not accepted on this doorway; say the document is not available or continue without it." },
        line: `(A document upload was requested: ${document || "document"}.)`,
      };
    }
    default:
      return { block: { type: "other", kind, body: body.trim() }, line: body.trim() };
  }
}

export function parseReply(raw: string): ParsedReply {
  const blocks: ReplyBlock[] = [];
  const text = raw
    .replace(FENCE, (_m, kind: string | undefined, body: string) => {
      const { block, line } = blockFor(kind ?? "", body);
      if (block) blocks.push(block);
      return line ? `\n${line}\n` : "\n";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, blocks };
}
