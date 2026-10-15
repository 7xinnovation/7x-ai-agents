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
      <div className="flex items-center justify-between gap-3 border-b border-[#1b1f2a] px-3.5 py-2">
        <span className="mono text-[11px] uppercase tracking-wide text-[#8b93a7]">{title ?? lang}</span>
        <button type="button" onClick={copy} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] font-medium text-[#aab2c5] transition-colors hover:bg-white/10 hover:text-white" aria-label="Copy code">
          {copied ? <Check size={13} strokeWidth={2.2} /> : <Copy size={13} strokeWidth={2} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <code dangerouslySetInnerHTML={{ __html: highlight(code, lang) }} />
      </pre>
    </div>
  );
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function highlight(code: string, lang: string): string {
  const safe = esc(code);
  if (lang === "json") {
    return safe
      .replace(/(&quot;|")([^"\n]*?)\1(\s*:)/g, '<span class="tok-k">$1$2$1</span>$3')
      .replace(/:\s*("(?:[^"\\]|\\.)*")/g, (m, s) => m.replace(s, `<span class="tok-s">${s}</span>`))
      .replace(/\b(true|false|null)\b/g, '<span class="tok-n">$1</span>')
      .replace(/(:\s*)(-?\d+(?:\.\d+)?)/g, '$1<span class="tok-n">$2</span>');
  }
  if (lang === "bash" || lang === "http") {
    return safe
      .replace(/(^|\n)(#[^\n]*)/g, '$1<span class="tok-c">$2</span>')
      .replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, '<span class="tok-s">$1</span>')
      .replace(/(^|\n)(curl|POST|GET|DELETE|export)\b/g, '$1<span class="tok-k">$2</span>')
      .replace(/(\s)(-[A-Za-z-]+)/g, '$1<span class="tok-n">$2</span>');
  }
  if (lang === "js" || lang === "python") {
    return safe
      .replace(/(^|\n)(\s*)(\/\/[^\n]*|#[^\n]*)/g, '$1$2<span class="tok-c">$3</span>')
      .replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/g, '<span class="tok-s">$1</span>')
      .replace(/\b(const|let|await|async|import|from|return|def|for|in|if|else|while|print|function|new)\b/g, '<span class="tok-k">$1</span>');
  }
  return safe;
}
