"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Search, Paperclip, SendHorizontal, Sparkles, ExternalLink, Lock, ArrowLeft, ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/field";
import { cn } from "@/lib/utils";

interface Item { id: string; locale: string; authenticated: boolean; createdAt: string; agentName: string | null; agentSlug: string | null; primary: string | null; lastMessage: string | null; lastRole: string | null; messageCount: number }
interface Msg { role: "user" | "assistant"; content: string; createdAt: string }
interface Detail {
  id: string; locale: string; authenticated: boolean; userRef: string | null; createdAt: string;
  agent: { name: string; slug: string; primary: string } | null;
  case: any | null;
  messages: Msg[];
  audit: { action: string; actor: string; payload: any; createdAt: string }[];
}

const time = (d: string) => new Date(d).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const day = (d: string) => {
  const t = new Date(d), now = new Date();
  const diff = (now.getTime() - t.getTime()) / 86400000;
  if (diff < 1 && now.getDate() === t.getDate()) return time(d);
  if (diff < 2) return "Yesterday";
  if (diff < 7) return t.toLocaleDateString("en-US", { weekday: "long" });
  return t.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

export function Inbox({ initial }: { initial: Item[] }) {
  const [items] = useState<Item[]>(initial);
  const [q, setQ] = useState("");
  /**
   * Which agent's conversations to show.
   *
   * The inbox is one list across every agent, and with two of them live it reads
   * as one stream of unrelated work — an EPGL licence application between two PO
   * Box rentals. The search box could be typed into to narrow it, but only if you
   * knew the agent's name and thought to.
   *
   * The list is what is on the page, so this filters what the page already has
   * rather than fetching again.
   */
  const [agentFilter, setAgentFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(initial[0]?.id ?? null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/conversations/${id}`);
      if (res.ok) setDetail(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (selected) void load(selected); }, [selected, load]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [detail]);

  /** Every agent that actually has a conversation here, in name order. */
  const agentsInList = [...new Map(items.filter((i) => i.agentSlug).map((i) => [i.agentSlug!, i.agentName ?? i.agentSlug!])).entries()].sort(
    (a, b) => a[1].localeCompare(b[1])
  );
  const filtered = items.filter(
    (i) =>
      (!agentFilter || i.agentSlug === agentFilter) &&
      `${i.agentName} ${i.lastMessage}`.toLowerCase().includes(q.toLowerCase())
  );
  const a = detail?.agent;
  const customer = detail?.authenticated ? detail?.userRef || "Authenticated customer" : "Guest";

  return (
    <div className="-mx-4 -my-6 flex h-[calc(100dvh-3.5rem)] overflow-hidden bg-surface text-ink sm:-mx-6 lg:-mx-10 lg:-my-8 lg:h-dvh">
      {/* List — full width on mobile, fixed column on tablet+. On mobile it yields
          to the thread once a conversation is picked (master-detail). */}
      <div className={cn("w-full shrink-0 flex-col border-r border-[var(--color-line)] md:flex md:w-[310px]", selected ? "hidden md:flex" : "flex")}>
        <div className="flex items-center justify-between px-4 pt-5 pb-3">
          <h1 className="text-[20px] font-bold tracking-tight">Inbox</h1>
          {/* The count follows the filter: "12" beside a list of three is the
              header contradicting the page. */}
          <Badge tone="brand">{filtered.length}</Badge>
        </div>
        <div className="flex flex-col gap-2 px-3 pb-3">
          <div className="flex h-9 items-center gap-2 rounded-lg border border-[#d0d5dd] bg-surface px-3 shadow-[var(--shadow-xs)] focus-within:border-[var(--color-brand)] focus-within:ring-4 focus-within:ring-[var(--color-ring)]">
            <Search className="h-4 w-4 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search conversations" className="w-full bg-transparent text-sm outline-none placeholder:text-muted" />
          </div>
          {/* Only worth showing when there is more than one agent to choose
              between; on a single-agent console it is a control with one option. */}
          {agentsInList.length > 1 && (
            <div className="relative">
              <select
                value={agentFilter}
                onChange={(e) => {
                  setAgentFilter(e.target.value);
                  // The open thread may belong to an agent that is no longer
                  // listed; leaving it open beside an empty list reads as broken.
                  const still = items.find((i) => i.id === selected && (!e.target.value || i.agentSlug === e.target.value));
                  if (!still) setSelected(null);
                }}
                aria-label="Filter by agent"
                className="h-9 w-full cursor-pointer appearance-none rounded-lg border border-[#d0d5dd] bg-surface pl-3 pr-8 text-[13px] font-medium text-ink outline-none focus:border-[var(--color-brand)] focus:ring-4 focus:ring-[var(--color-ring)]"
              >
                <option value="">All agents</option>
                {agentsInList.map(([slug, name]) => (
                  <option key={slug} value={slug}>
                    {name}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            </div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-3">
          {filtered.map((it) => (
            <button
              key={it.id}
              onClick={() => setSelected(it.id)}
              className={cn("flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors", selected === it.id ? "bg-[var(--color-line-soft)]" : "hover:bg-[var(--color-canvas)]")}
            >
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-[15px] font-bold uppercase text-white" style={{ background: it.primary ?? "#0020F5" }}>{(it.agentName ?? "?").charAt(0)}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-[14px] font-semibold">{it.agentName ?? "Agent"}</span>
                  <span className="shrink-0 text-[11.5px] text-muted">{day(it.createdAt)}</span>
                </span>
                <span className="mt-0.5 flex items-center gap-1.5">
                  <span className="truncate text-[13px] text-muted">{it.lastRole === "assistant" ? "" : ""}{it.lastMessage ?? "No messages yet"}</span>
                </span>
              </span>
              {it.messageCount > 0 && selected !== it.id ? <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-[var(--color-brand)] px-1.5 text-[11px] font-bold text-white">{it.messageCount}</span> : null}
            </button>
          ))}
          {filtered.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted">No conversations.</p>}
        </div>
      </div>

      {/* Thread — hidden on mobile until a conversation is selected. */}
      <div className={cn("min-w-0 flex-1 flex-col bg-[var(--color-canvas)]", selected ? "flex" : "hidden md:flex")}>
        {!detail ? (
          <div className="grid flex-1 place-items-center text-sm text-muted">{loading ? "Loading…" : "Select a conversation"}</div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3 border-b border-[var(--color-line)] bg-surface px-5 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <button
                  onClick={() => setSelected(null)}
                  aria-label="Back to conversations"
                  className="-ml-1 grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-[var(--color-canvas)] hover:text-ink md:hidden"
                >
                  <ArrowLeft className="h-[18px] w-[18px]" />
                </button>
                <span className="grid h-9 w-9 place-items-center rounded-full text-[13px] font-bold text-white" style={{ background: a?.primary ?? "#0020F5" }}>{(a?.name ?? "?").charAt(0)}</span>
                <div>
                  <div className="text-[15px] font-semibold leading-tight">{a?.name ?? "Agent"}</div>
                  <div className="text-[12px] text-muted">{customer} · {detail.locale.toUpperCase()} · {day(detail.createdAt)}</div>
                </div>
              </div>
              {a?.slug && <a href={`/embed/${a.slug}`} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--color-line)] bg-surface px-3 text-[13px] font-semibold text-ink-2 hover:bg-[var(--color-canvas)]"><ExternalLink className="h-4 w-4" /> Open agent</a>}
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6">
              <div className="mx-auto flex max-w-3xl flex-col gap-2.5">
                {detail.messages.map((m, i) => {
                  const mine = m.role === "assistant"; // agent = our side (right)
                  return (
                    <div key={i} className={cn("flex flex-col", mine ? "items-end" : "items-start")}>
                      <div className={cn("max-w-[78%] whitespace-pre-wrap break-words px-3.5 py-2.5 text-[14px] leading-relaxed", mine ? "rounded-2xl rounded-br-md bg-[var(--color-brand)] text-white" : "rounded-2xl rounded-bl-md bg-surface text-ink shadow-[var(--shadow-xs)] border border-[var(--color-line)]")}>
                        {m.content}
                      </div>
                      <span className="mt-1 px-1 text-[11px] text-muted">{time(m.createdAt)}</span>
                    </div>
                  );
                })}
                {detail.messages.length === 0 && <p className="py-10 text-center text-sm text-muted">No messages in this conversation.</p>}
              </div>
            </div>

            <div className="border-t border-[var(--color-line)] bg-surface px-5 py-3">
              <div className="flex items-center gap-2 rounded-xl border border-[var(--color-line)] bg-[var(--color-canvas)] px-3 py-2 text-muted">
                <Paperclip className="h-4 w-4" />
                <input disabled placeholder="Read-only — admin view" className="w-full cursor-not-allowed bg-transparent text-sm outline-none placeholder:text-muted" />
                <Lock className="h-3.5 w-3.5" />
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--color-line-soft)] text-muted"><SendHorizontal className="h-4 w-4" /></span>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Profile */}
      {detail && (
        <div className="hidden w-[320px] shrink-0 flex-col overflow-y-auto border-l border-[var(--color-line)] xl:flex">
          <div className="flex flex-col items-center gap-3 border-b border-[var(--color-line)] px-5 py-7 text-center">
            <span className="grid h-20 w-20 place-items-center rounded-full text-[26px] font-bold text-white shadow-[var(--shadow-md)]" style={{ background: `linear-gradient(140deg, color-mix(in srgb, ${a?.primary ?? "#0020F5"} 80%, white), ${a?.primary ?? "#0020F5"})` }}>{(a?.name ?? "?").charAt(0)}</span>
            <div>
              <div className="text-[16px] font-bold">{a?.name ?? "Agent"}</div>
              <div className="text-[12.5px] text-muted">{customer} · {detail.locale.toUpperCase()}</div>
            </div>
          </div>

          <Section title="Conversation">
            <Row k="Agent" v={a?.slug ?? "—"} />
            <Row k="Customer" v={customer} />
            <Row k="Language" v={detail.locale.toUpperCase()} />
            <Row k="Messages" v={String(detail.messages.length)} />
            <Row k="Started" v={new Date(detail.createdAt).toLocaleString()} />
          </Section>

          {detail.case && (detail.case.journeyKey || detail.case.reference || Object.keys(detail.case.data ?? {}).length > 0) && (
            <Section title="Case">
              {detail.case.status && <Row k="Status" v={detail.case.status} badge />}
              {detail.case.reference && <Row k="Reference" v={detail.case.reference} mono />}
              {detail.case.journeyKey && <Row k="Journey" v={detail.case.journeyKey} />}
              {detail.case.payment?.status && detail.case.payment.status !== "none" && (
                <Row k="Payment" v={`${detail.case.payment.amount ?? ""} ${detail.case.payment.currency ?? ""} · ${detail.case.payment.status}`} />
              )}
              {Object.entries(detail.case.data ?? {}).map(([k, v]) => (
                <Row key={k} k={k} v={typeof v === "object" ? JSON.stringify(v) : String(v)} />
              ))}
            </Section>
          )}

          {detail.audit.length > 0 && (
            <Section title="Audited actions">
              {detail.audit.map((e, i) => (
                <div key={i} className="flex items-center gap-2.5 py-2">
                  <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", e.action.includes("submit") || e.action.includes("confirm") ? "bg-[#17b26a]" : e.action.includes("escal") || e.action.includes("fail") ? "bg-[#f79009]" : "bg-[#d0d5dd]")} />
                  <span className="flex-1 text-[13px] font-medium capitalize">{e.action.replace(/_/g, " ")}</span>
                  <span className="text-[11px] text-muted">{time(e.createdAt)}</span>
                </div>
              ))}
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-[var(--color-line)] px-5 py-4">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">{title}</div>
      {children}
    </div>
  );
}
function Row({ k, v, mono, badge }: { k: string; v: string; mono?: boolean; badge?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 text-[13px]">
      <span className="shrink-0 text-muted">{k}</span>
      {badge ? <Badge tone={v === "submitted" ? "live" : "draft"}>{v}</Badge> : <span className={cn("text-right font-medium text-ink", mono && "font-mono text-[12px]")}>{v}</span>}
    </div>
  );
}
