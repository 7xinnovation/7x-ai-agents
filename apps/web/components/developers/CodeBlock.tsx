"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/**
 * A code sample with a copy button and a quiet title bar. Colouring is a few
 * regular expressions — strings, numbers, JSON keys and comments — enough for
 * curl and JSON to read well without a highlighter dependency.
 */
export function CodeBlock({ code, title, lang = "text", className = "" }: { code: string; title?: string; lang?: "bash" | "json" | "js" | "python" | "text" | "http"; className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard unavailable: the text is still selectable */
    }
  };
  return (
    <div className={`dev-code ${className}`}>
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-3.5 py-2">
        <span className="mono text-[11.5px] text-[#9aa3ae]">{title ?? lang}</span>
        <button type="button" onClick={copy} className="inline-flex items-center gap-1.5 rounded-[2px] px-2 py-1 text-[11.5px] font-medium text-[#aab2c5] transition-colors hover:bg-white/10 hover:text-white" aria-label="Copy code">
          {copied ? <Check size={13} strokeWidth={2.2} /> : <Copy size={13} strokeWidth={2} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <code>
          {highlight(code, lang).map((t, i) => (t.cls ? <span key={i} className={t.cls}>{t.text}</span> : t.text))}
        </code>
      </pre>
    </div>
  );
}

/**
 * Colouring as tokens, rendered as React text — never as HTML (6 November
 * 2026, security audit: raw inner HTML "can lead to XSS"). The old
 * version escaped the code and then ran regular expressions over the HTML it
 * was building, which was safe only as long as no expression ever matched
 * inside a tag it had inserted itself. Text in React nodes is escaped by
 * React, whatever the code contains.
 */
export interface Token {
  text: string;
  cls?: "tok-k" | "tok-s" | "tok-n" | "tok-c";
}

/** Walk `src` with one global expression; `pick` turns each match into tokens. */
function scan(src: string, re: RegExp, pick: (m: RegExpExecArray) => Token[]): Token[] {
  const out: Token[] = [];
  let last = 0;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    if (m[0] === "") {
      re.lastIndex++;
      continue;
    }
    if (m.index > last) out.push({ text: src.slice(last, m.index) });
    out.push(...pick(m));
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push({ text: src.slice(last) });
  return out;
}

const STR = String.raw`"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'`;

export function highlight(code: string, lang: string): Token[] {
  if (lang === "json") {
    return scan(code, /("(?:[^"\\\n]|\\.)*")(\s*:)?|\b(true|false|null)\b|(-?\b\d+(?:\.\d+)?\b)/g, (m) =>
      m[1] !== undefined
        ? m[2] !== undefined
          ? [{ text: m[1], cls: "tok-k" }, { text: m[2] }]
          : [{ text: m[1], cls: "tok-s" }]
        : [{ text: m[0], cls: "tok-n" }]
    );
  }
  if (lang === "bash" || lang === "http") {
    // Line by line: a comment line is one token, never tokenised again.
    return code.split("\n").flatMap((line, i) => {
      const nl: Token[] = i === 0 ? [] : [{ text: "\n" }];
      if (/^\s*#/.test(line)) return [...nl, { text: line, cls: "tok-c" as const }];
      const re = new RegExp(`(${STR})|^(\\s*)(curl|POST|GET|DELETE|PATCH|export)\\b|(\\s)(-{1,2}[A-Za-z][\\w-]*)`, "g");
      return [
        ...nl,
        ...scan(line, re, (m) =>
          m[1] !== undefined
            ? [{ text: m[1], cls: "tok-s" }]
            : m[3] !== undefined
              ? [{ text: m[2] ?? "" }, { text: m[3], cls: "tok-k" }]
              : [{ text: m[4] ?? "" }, { text: m[5] ?? "", cls: "tok-n" }]
        ),
      ];
    });
  }
  if (lang === "js" || lang === "python") {
    const re = new RegExp(
      `(?<=^|\\n)([ \\t]*)(\\/\\/[^\\n]*|#[^\\n]*)|(${STR}|\`(?:[^\`\\\\]|\\\\.)*\`)|\\b(const|let|await|async|import|from|return|def|for|in|if|else|while|print|function|new)\\b`,
      "g"
    );
    return scan(code, re, (m) =>
      m[2] !== undefined
        ? [{ text: m[1] ?? "" }, { text: m[2], cls: "tok-c" }]
        : m[3] !== undefined
          ? [{ text: m[3], cls: "tok-s" }]
          : [{ text: m[4] ?? "", cls: "tok-k" }]
    );
  }
  return [{ text: code }];
}
