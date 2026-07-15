import React from "react";
import { UploadSimple, Camera, DeviceMobile, CheckCircle, ArrowClockwise, FileText, Warning } from "@phosphor-icons/react";
import { tr, type LocalizedString, type Locale } from "@dialog/config";

/**
 * Context the chat needs to render an inline upload widget (feedback: keep the
 * upload in the conversation, one document at a time). Built in Experience and
 * threaded into assistant-message markdown; a ```upload block names the doc key.
 */
export interface UploadDocMeta {
  label: LocalizedString;
  requirement: "mandatory" | "conditional" | "optional";
  acceptedFormats: string[];
  maxSizeMb: number;
}
export interface UploadCtx {
  locale: Locale;
  docs: Record<string, UploadDocMeta>;
  statuses: Record<string, { status: string; fileName?: string; rejectionReason?: string }>;
  uploadingKey: string | null;
  onUpload: (key: string, file: File) => void;
  onQr: () => void;
  strings: {
    upload: string; uploading: string; replace: string; optional: string;
    upTo: string; takePhoto: string; fromPhone: string; uploaded: string;
  };
}

/** Inline, in-conversation upload control for a single document (by key). */
function ChatUpload({ dkey, ctx }: { dkey: string; ctx: UploadCtx }) {
  const doc = ctx.docs[dkey];
  if (!doc) return null;
  const st = ctx.statuses[dkey];
  const uploaded = st?.status === "uploaded" || st?.status === "accepted";
  const busy = ctx.uploadingKey === dkey;
  const accept = doc.acceptedFormats.map((f) => "." + f).join(",");
  const t = ctx.strings;
  return (
    <div className={`dlg-chat-upload${uploaded ? " is-done" : ""}`}>
      <div className="dlg-chat-upload-head">
        <FileText size={15} weight="regular" />
        <span className="dlg-chat-upload-name">
          {tr(doc.label, ctx.locale)}
          {doc.requirement === "optional" ? <em> ({t.optional})</em> : null}
        </span>
        {uploaded ? (
          <span className="dlg-chat-upload-status">
            <CheckCircle size={13} weight="fill" /> {t.uploaded}
          </span>
        ) : null}
      </div>
      {uploaded ? (
        <div className="dlg-chat-upload-file">
          <span className="fname">{st?.fileName}</span>
          <label className="dlg-upload ghost">
            {t.replace}
            <input type="file" hidden accept={accept} onChange={(e) => e.target.files?.[0] && ctx.onUpload(dkey, e.target.files[0])} />
          </label>
        </div>
      ) : (
        <div className="dlg-chat-upload-actions">
          <label className="dlg-upload cam" title={t.takePhoto} aria-label={t.takePhoto}>
            <Camera size={14} weight="bold" />
            <input type="file" hidden disabled={busy} accept="image/*" capture="environment" onChange={(e) => e.target.files?.[0] && ctx.onUpload(dkey, e.target.files[0])} />
          </label>
          <button type="button" className="dlg-upload-phone" onClick={ctx.onQr} title={t.fromPhone}>
            <DeviceMobile size={14} weight="bold" /> {t.fromPhone}
          </button>
          <label className={`dlg-upload ${busy ? "busy" : ""}`}>
            {busy ? (
              <>
                <ArrowClockwise size={14} weight="bold" className="spin" /> {t.uploading}
              </>
            ) : (
              <>
                <UploadSimple size={14} weight="bold" /> {t.upload}
              </>
            )}
            <input type="file" hidden disabled={busy} accept={accept} onChange={(e) => e.target.files?.[0] && ctx.onUpload(dkey, e.target.files[0])} />
          </label>
        </div>
      )}
      {st?.status === "rejected" && st?.rejectionReason ? (
        <div className="dlg-docslot-error">
          <Warning size={13} weight="fill" /> {st.rejectionReason}
        </div>
      ) : (
        <div className="dlg-chat-upload-hint">
          {doc.acceptedFormats.join(", ").toUpperCase()} · {t.upTo} {doc.maxSizeMb}MB
        </div>
      )}
    </div>
  );
}

/** Inline action buttons (a ```buttons block). Tapping sends the label as the reply. */
function ChatButtons({ labels, onSelect }: { labels: string[]; onSelect: (text: string) => void }) {
  if (!labels.length) return null;
  return (
    <div className="dlg-chat-buttons">
      {labels.map((l, i) => (
        <button key={i} type="button" className={`dlg-chat-btn${i === 0 ? " primary" : ""}`} onClick={() => onSelect(l)}>
          {l}
        </button>
      ))}
    </div>
  );
}

/**
 * Inline toggle switches (a ```toggles block) plus a confirm button — for
 * capturing on/off choices (e.g. save card, auto-renewal) without a text Q&A.
 * On confirm it sends a readable summary of the switches so the agent records
 * each choice and continues.
 */
function ChatToggles({
  items, title, confirmLabel, onSelect,
}: {
  items: { key: string; label: string }[];
  title?: string;
  confirmLabel: string;
  onSelect: (text: string) => void;
}) {
  const [on, setOn] = React.useState<Record<string, boolean>>({});
  if (!items.length) return null;
  const submit = () => {
    const summary = items.map((it) => `${it.label}: ${on[it.key] ? "Yes" : "No"}`).join(". ");
    onSelect(`${summary}. ${confirmLabel}.`);
  };
  return (
    <div className="dlg-toggles">
      {title ? <div className="dlg-toggles-title">{title}</div> : null}
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          role="switch"
          aria-checked={!!on[it.key]}
          className={`dlg-toggle${on[it.key] ? " is-on" : ""}`}
          onClick={() => setOn((s) => ({ ...s, [it.key]: !s[it.key] }))}
        >
          <span className="dlg-toggle-label">{it.label}</span>
          <span className="dlg-toggle-track" aria-hidden="true"><span className="dlg-toggle-thumb" /></span>
        </button>
      ))}
      <button type="button" className="dlg-toggles-confirm" onClick={submit}>{confirmLabel}</button>
    </div>
  );
}

/**
 * A premium review card (a ```summary block) for confirming collected details —
 * a PO Box's details, a pre-payment summary. Labeled rows with an optional
 * emphasised total footer; cleaner and more considered than a raw markdown table.
 */
function ChatSummary({
  title, rows, total,
}: {
  title?: string;
  rows: { label: string; value: string }[];
  total?: { label: string; value: string };
}) {
  if (!rows.length && !total) return null;
  return (
    <div className="dlg-summary">
      {title ? <div className="dlg-summary-title">{title}</div> : null}
      {rows.length ? (
        <div className="dlg-summary-rows">
          {rows.map((r, i) => (
            <div className="dlg-summary-row" key={i}>
              <span className="dlg-summary-k">{renderInline(r.label)}</span>
              <span className="dlg-summary-v">{renderInline(r.value)}</span>
            </div>
          ))}
        </div>
      ) : null}
      {total ? (
        <div className="dlg-summary-total">
          <span className="dlg-summary-k">{renderInline(total.label)}</span>
          <span className="dlg-summary-v">{renderInline(total.value)}</span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Minimal, dependency-free Markdown renderer for assistant messages: paragraphs,
 * bullet lists, **bold**, *italic* / _italic_, `code`, and [links](url). Builds
 * React elements (no raw HTML) so it's XSS-safe. Tolerant of partial markdown
 * mid-stream (unmatched tokens render as plain text until they complete).
 */
function renderInline(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let rest = text;
  let key = 0;
  const push = (n: React.ReactNode) => out.push(<React.Fragment key={key++}>{n}</React.Fragment>);

  const patterns: { re: RegExp; make: (m: RegExpMatchArray) => React.ReactNode }[] = [
    { re: /\[([^\]]+)\]\(([^)\s]+)\)/, make: (m) => (
      <a href={m[2]} target="_blank" rel="noopener noreferrer" className="dlg-md-link">{m[1]}</a>
    ) },
    { re: /\*\*([^*]+)\*\*/, make: (m) => <strong>{renderInline(m[1]!)}</strong> },
    { re: /`([^`]+)`/, make: (m) => <code className="dlg-md-code">{m[1]}</code> },
    { re: /_([^_]+)_|\*([^*\s][^*]*)\*/, make: (m) => <em>{m[1] ?? m[2]}</em> },
  ];

  while (rest.length) {
    let best: RegExpMatchArray | null = null;
    let bestAt = Infinity;
    let bestMake: ((m: RegExpMatchArray) => React.ReactNode) | null = null;
    for (const p of patterns) {
      const m = rest.match(p.re);
      if (m && m.index !== undefined && m.index < bestAt) { best = m; bestAt = m.index; bestMake = p.make; }
    }
    if (!best || !bestMake) { push(rest); break; }
    if (bestAt > 0) push(rest.slice(0, bestAt));
    push(bestMake(best));
    rest = rest.slice(bestAt + best[0].length);
  }
  return out;
}

/** A row of `| a | b |` markdown split into trimmed cells (outer pipes dropped). */
function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  // Split on unescaped pipes.
  return s.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, "|").trim());
}
const isTableSep = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line);
const isTableRow = (line: string) => /\|/.test(line) && line.trim().length > 0;

/**
 * Parse a ```cards fenced block into selectable option cards (PRD/feedback
 * FB-1169: show products or options to choose from as visual cards, not tables).
 * Each card is a `- ` item followed by `key: value` lines; recognised keys —
 * title, price, desc/subtitle, badge, meta — get dedicated styling, anything
 * else renders as a labeled attribute row.
 */
interface OptionCard {
  title: string;
  price?: string;
  desc?: string;
  badge?: string;
  attrs: { label: string; value: string }[];
}
function parseCards(body: string[]): OptionCard[] {
  const cards: OptionCard[] = [];
  let cur: OptionCard | null = null;
  for (const raw of body) {
    const item = raw.match(/^\s*-\s+(.*)$/);
    const kv = raw.match(/^\s*([A-Za-z][\w ]*?):\s*(.*)$/);
    if (item) {
      if (cur) cards.push(cur);
      cur = { title: "", attrs: [] };
      const inline = item[1]!.match(/^([A-Za-z][\w ]*?):\s*(.*)$/);
      if (inline) applyCardKey(cur, inline[1]!, inline[2]!);
      else cur.title = item[1]!.trim();
    } else if (kv && cur) {
      applyCardKey(cur, kv[1]!, kv[2]!);
    }
  }
  if (cur) cards.push(cur);
  return cards.filter((c) => c.title || c.desc || c.attrs.length);
}
function applyCardKey(card: OptionCard, key: string, value: string) {
  const k = key.trim().toLowerCase();
  const v = value.trim();
  if (k === "title" || k === "name") card.title = v;
  else if (k === "price" || k === "cost" || k === "fee") card.price = v;
  else if (k === "desc" || k === "description" || k === "subtitle") card.desc = v;
  else if (k === "badge" || k === "tag") card.badge = v;
  else if (!card.title) card.title = v;
  else card.attrs.push({ label: key.trim(), value: v });
}

/**
 * Reveals assistant text with a smooth typewriter effect, decoupled from the
 * network: SSE deltas grow `text`, and this animates the visible slice up to it
 * at a steady pace, accelerating to catch up after a burst (e.g. text resuming
 * after a tool round) so it never lags far behind. When `animate` is false
 * (completed / resumed messages) it renders in full immediately.
 */
export function TypewriterMarkdown({ text, animate, onSelect, uploadCtx }: { text: string; animate: boolean; onSelect?: (text: string) => void; uploadCtx?: UploadCtx }) {
  const [shown, setShown] = React.useState(animate ? 0 : text.length);
  const shownRef = React.useRef(shown);
  const textRef = React.useRef(text);
  textRef.current = text;

  React.useEffect(() => {
    if (!animate) {
      shownRef.current = textRef.current.length;
      setShown(textRef.current.length);
      return;
    }
    let raf = 0;
    let last = performance.now();
    const BASE_CPS = 260; // steady typing speed
    const tick = (now: number) => {
      const dt = Math.min(now - last, 60) / 1000;
      last = now;
      const target = textRef.current.length;
      let cur = shownRef.current;
      if (cur < target) {
        const gap = target - cur;
        // Type steadily; speed up (up to ~7x) the further behind the buffer runs.
        const cps = BASE_CPS * (1 + Math.min(gap / 55, 6));
        cur = Math.min(target, cur + cps * dt);
        if (Math.floor(cur) !== shownRef.current) {
          shownRef.current = Math.floor(cur);
          setShown(shownRef.current);
        } else {
          shownRef.current = cur;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [animate]);

  // When the turn ends, make sure nothing is left half-revealed.
  React.useEffect(() => {
    if (!animate) setShown(text.length);
  }, [animate, text]);

  // Cards/uploads are interactive only once the reply has fully rendered.
  return <Markdown text={animate ? text.slice(0, Math.floor(shown)) : text} onSelect={animate ? undefined : onSelect} uploadCtx={animate ? undefined : uploadCtx} />;
}

export function Markdown({ text, onSelect, uploadCtx }: { text: string; onSelect?: (text: string) => void; uploadCtx?: UploadCtx }) {
  const lines = text.split("\n");
  const nodes: React.ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    // Fenced blocks: ```cards (choice cards) or ```upload (in-chat upload widget).
    const fence = line.match(/^\s*```\s*(cards|upload|buttons|toggles|summary)?\s*$/);
    if (fence) {
      const isCards = fence[1] === "cards";
      const isUpload = fence[1] === "upload";
      const isButtons = fence[1] === "buttons";
      const isToggles = fence[1] === "toggles";
      const isSummary = fence[1] === "summary";
      i++;
      const body: string[] = [];
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i]!)) { body.push(lines[i]!); i++; }
      i++; // closing fence
      if (isUpload) {
        // Body carries a `key: <docKey>` line naming which document to upload.
        const keyLine = body.map((l) => l.match(/^\s*key\s*:\s*(.+?)\s*$/i)).find(Boolean);
        const dkey = keyLine ? keyLine[1]!.trim() : "";
        if (uploadCtx && dkey && uploadCtx.docs[dkey]) {
          nodes.push(<ChatUpload key={k++} dkey={dkey} ctx={uploadCtx} />);
        }
        // No ctx (still streaming) or unknown key → render nothing for the block.
        continue;
      }
      if (isButtons) {
        // Each `- Label` line is an action button; tapping sends that label.
        const labels = body.map((l) => l.match(/^\s*-\s+(.*\S)\s*$/)).filter(Boolean).map((m) => m![1]!.trim());
        if (onSelect && labels.length) nodes.push(<ChatButtons key={k++} labels={labels} onSelect={onSelect} />);
        continue;
      }
      if (isToggles) {
        // `title:` / `confirm:` lines, and `- key: label` lines for each switch.
        let tTitle: string | undefined;
        let tConfirm = "Confirm";
        const tItems: { key: string; label: string }[] = [];
        for (const l of body) {
          const item = l.match(/^\s*-\s+([\w.-]+)\s*:\s*(.+?)\s*$/);
          const meta = l.match(/^\s*(title|confirm)\s*:\s*(.+?)\s*$/i);
          if (item) tItems.push({ key: item[1]!.trim(), label: item[2]!.trim() });
          else if (meta) { if (/^title$/i.test(meta[1]!)) tTitle = meta[2]!.trim(); else tConfirm = meta[2]!.trim(); }
        }
        if (onSelect && tItems.length) nodes.push(<ChatToggles key={k++} items={tItems} title={tTitle} confirmLabel={tConfirm} onSelect={onSelect} />);
        continue;
      }
      if (isSummary) {
        // A review card: `title:` line, `- Label: Value` rows, and an optional
        // `total: <amount>` line rendered as the emphasised footer.
        let sTitle: string | undefined;
        let sTotal: { label: string; value: string } | undefined;
        const sRows: { label: string; value: string }[] = [];
        for (const l of body) {
          const meta = l.match(/^\s*(title|total)\s*:\s*(.+?)\s*$/i);
          const row = l.match(/^\s*-\s+(.+?)\s*:\s*(.+?)\s*$/);
          if (meta && /^title$/i.test(meta[1]!)) sTitle = meta[2]!.trim();
          else if (meta) {
            const t = meta[2]!.trim();
            const split = t.match(/^(.+?)\s*:\s*(.+)$/);
            sTotal = split ? { label: split[1]!.trim(), value: split[2]!.trim() } : { label: "Total", value: t };
          } else if (row) sRows.push({ label: row[1]!.trim(), value: row[2]!.trim() });
        }
        if (sRows.length || sTotal) nodes.push(<ChatSummary key={k++} title={sTitle} rows={sRows} total={sTotal} />);
        continue;
      }
      if (isCards) {
        const cards = parseCards(body);
        if (cards.length) {
          nodes.push(
            <div className="dlg-cards" key={k++}>
              {cards.map((c, ci) => {
                const selected = !!c.badge && /^\s*selected\s*$/i.test(c.badge);
                // A tappable card sends its title as the customer's choice, so the
                // user can pick by tapping instead of typing. The already-selected
                // card and any card rendered without a handler stay inert.
                const tappable = !!onSelect && !selected;
                const cls = `dlg-card-opt${selected ? " is-selected" : ""}${tappable ? " is-tappable" : ""}`;
                const inner = (
                  <>
                    <div className="dlg-card-opt-head">
                      <span className="dlg-card-opt-title">{renderInline(c.title)}</span>
                      {c.badge ? (
                        <span className={`dlg-card-opt-badge${selected ? " is-selected" : ""}`}>
                          {selected ? (
                            <>
                              <svg viewBox="0 0 12 12" fill="none" aria-hidden="true">
                                <path d="M2.4 6.3l2.2 2.2 5-5.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                              Selected
                            </>
                          ) : (
                            c.badge
                          )}
                        </span>
                      ) : null}
                    </div>
                    {c.desc ? <p className="dlg-card-opt-desc">{renderInline(c.desc)}</p> : null}
                    {c.attrs.length ? (
                      <div className="dlg-card-opt-attrs">
                        {c.attrs.map((a, ai) => (
                          <span className="dlg-card-opt-attr" key={ai}>
                            <span className="k">{a.label}</span>
                            <span className={`v${a.value.length > 32 ? " long" : ""}`}>{renderInline(a.value)}</span>
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {c.price ? <div className="dlg-card-opt-price">{c.price}</div> : null}
                  </>
                );
                return tappable ? (
                  <button type="button" className={cls} key={ci} onClick={() => onSelect!(c.title)} aria-label={`Choose ${c.title}`}>
                    {inner}
                  </button>
                ) : (
                  <div className={cls} key={ci}>
                    {inner}
                  </div>
                );
              })}
            </div>
          );
        }
      } else {
        // Plain fenced code block.
        nodes.push(<pre className="dlg-md-pre" key={k++}><code>{body.join("\n")}</code></pre>);
      }
      continue;
    }
    // Table: a header row followed by a |---|---| separator, then body rows.
    if (isTableRow(line) && i + 1 < lines.length && isTableSep(lines[i + 1]!)) {
      const header = splitRow(line);
      i += 2; // skip header + separator
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i]!) && !isTableSep(lines[i]!)) {
        rows.push(splitRow(lines[i]!));
        i++;
      }
      nodes.push(
        <div className="dlg-md-tablewrap" key={k++}>
          <table className="dlg-md-table">
            <thead>
              <tr>{header.map((h, j) => <th key={j}>{renderInline(h)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {header.map((_, ci) => <td key={ci}>{renderInline(r[ci] ?? "")}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }
    // Horizontal rule: --- / *** on its own line (not a table separator — those
    // are consumed by the table branch above).
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      nodes.push(<hr key={k++} className="dlg-md-hr" />);
      i++;
      continue;
    }
    // Headings: #..#### — rendered as compact section titles inside the bubble.
    const h = line.match(/^\s*(#{1,4})\s+(.*)$/);
    if (h) {
      nodes.push(
        <div key={k++} className={`dlg-md-h dlg-md-h${h[1]!.length}`}>
          {renderInline(h[2]!)}
        </div>
      );
      i++;
      continue;
    }
    // Blockquote: consecutive "> " lines grouped into one quote block.
    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i]!)) {
        quote.push(lines[i]!.replace(/^\s*>\s?/, ""));
        i++;
      }
      nodes.push(
        <blockquote key={k++} className="dlg-md-quote">
          {quote.map((q, j) => (
            <React.Fragment key={j}>{j > 0 ? <br /> : null}{renderInline(q)}</React.Fragment>
          ))}
        </blockquote>
      );
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      nodes.push(
        <ul key={k++} className="dlg-md-list">
          {items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}
        </ul>
      );
    } else if (line.trim() === "") {
      i++;
    } else {
      const para: string[] = [];
      const isBlock = (l: string) =>
        /^\s*[-*]\s+/.test(l) || /^\s*(-{3,}|\*{3,})\s*$/.test(l) || /^\s*#{1,4}\s+/.test(l) || /^\s*>\s?/.test(l);
      while (i < lines.length && lines[i]!.trim() !== "" && !isBlock(lines[i]!)) {
        para.push(lines[i]!);
        i++;
      }
      nodes.push(
        <p key={k++} className="dlg-md-p">
          {para.map((pl, j) => (
            <React.Fragment key={j}>{j > 0 ? <br /> : null}{renderInline(pl)}</React.Fragment>
          ))}
        </p>
      );
    }
  }
  return <>{nodes}</>;
}
