"use client";

import { useEffect, useState } from "react";

export interface DocsSection {
  id: string;
  title: string;
}

/**
 * The documentation's table of contents. A sticky list on a wide screen, a
 * select on a phone; the section in view carries aria-current.
 */
export function DocsToc({ sections }: { sections: DocsSection[] }) {
  const [current, setCurrent] = useState<string>(sections[0]?.id ?? "");

  useEffect(() => {
    const els = sections.map((s) => document.getElementById(s.id)).filter((el): el is HTMLElement => Boolean(el));
    if (!els.length || typeof IntersectionObserver === "undefined") return;
    const visible = new Set<string>();
    const pick = () => {
      // The first visible section in document order; when a long section
      // fills the viewport with no heading in view, the last choice stands.
      const first = sections.find((s) => visible.has(s.id));
      if (first) setCurrent(first.id);
    };
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target.id);
          else visible.delete(e.target.id);
        }
        pick();
      },
      { rootMargin: "-72px 0px -55% 0px", threshold: [0, 0.01] }
    );
    els.forEach((el) => io.observe(el));
    // Deep links: honour the hash on arrival.
    const hash = window.location.hash.replace(/^#/, "");
    if (hash && sections.some((s) => s.id === hash)) setCurrent(hash);
    return () => io.disconnect();
  }, [sections]);

  const go = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ block: "start" });
    history.replaceState(null, "", `#${id}`);
    setCurrent(id);
  };

  return (
    <>
      {/* Phone: a select that jumps. */}
      <div className="lg:hidden">
        <label htmlFor="docs-toc-select" className="sr-only">
          Section
        </label>
        <select
          id="docs-toc-select"
          value={current}
          onChange={(e) => go(e.target.value)}
          className="h-10 w-full rounded-lg border border-[#d0d5dd] bg-surface px-3 text-sm text-ink  outline-none focus:border-[var(--color-brand)] focus:ring-4 focus:ring-[var(--color-ring)]"
        >
          {sections.map((s, i) => (
            <option key={s.id} value={s.id}>
              {i + 1}. {s.title}
            </option>
          ))}
        </select>
      </div>

      {/* Wide: the sticky list. */}
      <nav className="dev-toc sticky top-[72px] hidden max-h-[calc(100dvh-96px)] overflow-y-auto pr-2 lg:block" aria-label="Contents">
        <p className="mb-2 px-2.5 text-[13px] font-semibold text-ink">On this page</p>
        <ol className="flex flex-col gap-0.5">
          {sections.map((s, i) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                aria-current={current === s.id ? "true" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  go(s.id);
                }}
              >
                
                {s.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>
    </>
  );
}
