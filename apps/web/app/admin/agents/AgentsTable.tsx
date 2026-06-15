"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, Search, ChevronsUpDown, ExternalLink, Pencil, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/field";

export interface AgentRow {
  slug: string;
  name: string;
  status: string;
  tenant: string;
  primary: string;
  locales: string[];
  journeys: number;
  updated: string;
}

export function AgentsTable({ rows }: { rows: AgentRow[] }) {
  const [q, setQ] = useState("");
  const filtered = rows.filter((r) => `${r.name} ${r.slug} ${r.tenant}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <div className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium text-muted">
        <span className="grid h-5 w-5 place-items-center rounded bg-[#0020f5]"><img src="/7xlogo.svg" alt="" className="h-2 w-auto" /></span>
        7X <ChevronRight className="h-3.5 w-3.5" /> <span className="text-ink">Agents</span>
      </div>
      <header className="mb-7 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold tracking-[-0.02em]">Agents</h1>
          <p className="mt-1 text-[14px] text-muted">Every embeddable assistant across your tenants. Open one to edit its configuration.</p>
        </div>
        <Link href="/admin/new" className="inline-flex h-[38px] items-center gap-2 rounded-lg bg-brand px-3.5 text-[13.5px] font-semibold text-white shadow-[var(--shadow-xs)] hover:bg-[color-mix(in_srgb,var(--color-brand)_90%,#000)]"><Plus className="h-4 w-4" /> New agent</Link>
      </header>

      <Card>
        <div className="flex items-center justify-between gap-3 border-b border-[var(--color-line-soft)] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <h3 className="text-[15px] font-semibold">All agents</h3>
            <Badge tone="brand">{rows.length}</Badge>
          </div>
          <div className="flex h-9 w-64 items-center gap-2 rounded-lg border border-[#d0d5dd] bg-surface px-3 shadow-[var(--shadow-xs)] focus-within:border-[var(--color-brand)] focus-within:ring-4 focus-within:ring-[var(--color-ring)]">
            <Search className="h-4 w-4 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search agents" className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-muted" />
          </div>
        </div>

        <div className="grid grid-cols-[2.4fr_1.3fr_1fr_.8fr_.9fr_.7fr] items-center gap-3 border-b border-[var(--color-line-soft)] px-5 py-2.5 text-[12px] font-medium text-muted">
          <span className="flex items-center gap-1">Agent <ChevronsUpDown className="h-3.5 w-3.5" /></span>
          <span>Tenant</span>
          <span>Languages</span>
          <span>Journeys</span>
          <span className="flex items-center gap-1">Status</span>
          <span className="text-right">Actions</span>
        </div>

        {filtered.map((r) => (
          <div key={r.slug} className="grid grid-cols-[2.4fr_1.3fr_1fr_.8fr_.9fr_.7fr] items-center gap-3 border-b border-[var(--color-line-soft)] px-5 py-3.5 text-[13.5px] transition-colors last:border-0 hover:bg-[var(--color-canvas)]">
            <span className="flex items-center gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[13px] font-bold uppercase text-white" style={{ background: r.primary }}>{r.name.charAt(0)}</span>
              <span className="min-w-0">
                <Link href={`/admin/${r.slug}`} className="block truncate font-semibold text-ink hover:text-[var(--color-brand)]">{r.name}</Link>
                <span className="block truncate font-mono text-[12px] text-muted">{r.slug}</span>
              </span>
            </span>
            <span className="truncate text-ink-2">{r.tenant}</span>
            <span className="text-muted">{r.locales.join(" · ") || "—"}</span>
            <span className="text-ink-2">{r.journeys}</span>
            <span><Badge tone={r.status === "live" ? "live" : "draft"} dot>{r.status}</Badge></span>
            <span className="flex items-center justify-end gap-1">
              <a href={`/embed/${r.slug}`} target="_blank" rel="noreferrer" aria-label="Open" className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-[var(--color-line-soft)] hover:text-ink"><ExternalLink className="h-4 w-4" /></a>
              <Link href={`/admin/${r.slug}`} aria-label="Edit" className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-[var(--color-line-soft)] hover:text-ink"><Pencil className="h-4 w-4" /></Link>
            </span>
          </div>
        ))}
        {filtered.length === 0 && <div className="px-5 py-10 text-center text-sm text-muted">No agents match “{q}”.</div>}
      </Card>
    </>
  );
}
