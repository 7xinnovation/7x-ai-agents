"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown } from "lucide-react";

/**
 * Agent scope selector for the admin dashboards. Writes `?agent=<slug>` (or
 * removes it for "All agents") while preserving other query params, and lets the
 * server component re-render with the scoped data.
 */
export function AgentFilter({ agents }: { agents: { slug: string; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = params.get("agent") ?? "";

  const onChange = (slug: string) => {
    const next = new URLSearchParams(params.toString());
    if (slug) next.set("agent", slug);
    else next.delete("agent");
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  return (
    <div className="relative">
      <select
        value={current}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Filter by agent"
        className="h-9 cursor-pointer appearance-none rounded-lg border border-[var(--color-line)] bg-surface pl-3 pr-9 text-[13px] font-medium text-ink shadow-[var(--shadow-xs)] outline-none focus:border-[var(--color-brand)] focus:ring-4 focus:ring-[var(--color-ring)]"
      >
        <option value="">All agents</option>
        {agents.map((a) => (
          <option key={a.slug} value={a.slug}>{a.name}</option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
    </div>
  );
}
