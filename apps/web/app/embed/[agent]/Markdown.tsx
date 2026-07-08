import React from "react";

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
 * Reveals assistant text with a smooth typewriter effect, decoupled from the
 * network: SSE deltas grow `text`, and this animates the visible slice up to it
 * at a steady pace, accelerating to catch up after a burst (e.g. text resuming
 * after a tool round) so it never lags far behind. When `animate` is false
 * (completed / resumed messages) it renders in full immediately.
 */
export function TypewriterMarkdown({ text, animate }: { text: string; animate: boolean }) {
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

  return <Markdown text={animate ? text.slice(0, Math.floor(shown)) : text} />;
}

export function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const nodes: React.ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i]!;
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
