import Link from "next/link";
import { sql, desc, eq } from "drizzle-orm";
import { getDb, agents, tenants, conversations, messages, kbChunks, escalations, auditLog, analyticsEvents } from "@dialog/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/field";
import { Plus, ArrowUpRight, ArrowRight, ChevronRight } from "lucide-react";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function count(table: any): Promise<number> {
  const [r] = await getDb().select({ c: sql<number>`count(*)::int` }).from(table);
  return r?.c ?? 0;
}
function ago(d: Date | string) {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export default async function Overview() {
  const db = getDb();
  const [nA, nT, nC, nM, nK, nE] = await Promise.all([count(agents), count(tenants), count(conversations), count(messages), count(kbChunks), count(escalations)]);
  const evRows = (await db.select({ type: analyticsEvents.type, c: sql<number>`count(*)::int` }).from(analyticsEvents).groupBy(analyticsEvents.type)) as { type: string; c: number }[];
  const ev: Record<string, number> = {};
  for (const r of evRows) ev[r.type] = r.c;
  const rate = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "—");

  const liveAgents = (await db
    .select({ slug: agents.slug, name: agents.name, status: agents.status, tenant: tenants.name, definition: agents.definition })
    .from(agents).leftJoin(tenants, eq(agents.tenantId, tenants.id)).orderBy(desc(agents.updatedAt)).limit(6)) as any[];
  const recent = (await db
    .select({ action: auditLog.action, actor: auditLog.actor, createdAt: auditLog.createdAt, agentName: agents.name })
    .from(auditLog).leftJoin(agents, eq(auditLog.agentId, agents.id)).orderBy(desc(auditLog.createdAt)).limit(7)) as any[];

  const stats = [
    { label: "Agents", value: String(nA), hint: `across ${nT} tenants` },
    { label: "Conversations", value: nC.toLocaleString("en-US"), hint: `${nM.toLocaleString("en-US")} messages` },
    { label: "Knowledge chunks", value: nK.toLocaleString("en-US"), hint: "grounding the KB" },
    { label: "Escalations", value: String(nE), hint: "routed to humans" },
  ];
  const kpis = [
    { label: "Journey completion", value: rate(ev["journey.completed"] ?? 0, ev["journey.started"] ?? 0), good: true },
    { label: "Payment success", value: rate(ev["payment.completed"] ?? 0, ev["payment.initiated"] ?? 0), good: true },
    { label: "Self-service", value: rate(Math.max(0, (ev["conversation.started"] ?? 0) - (ev["callback.requested"] ?? 0)), ev["conversation.started"] ?? 0), good: true },
    { label: "Shipment lookups", value: String(ev["shipment.lookup"] ?? 0), good: false },
  ];

  return (
    <div data-rise>
      <div className="mb-2 flex items-center gap-1.5 text-[12.5px] font-medium text-muted">
        <span className="grid h-5 w-5 place-items-center rounded bg-[#0020f5]"><img src="/7xlogo.svg" alt="" className="h-2 w-auto" /></span>
        7X <ChevronRight className="h-3.5 w-3.5 text-[#c4c8d0]" /> <span className="text-ink">Overview</span>
      </div>
      <header className="mb-8 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[30px] font-bold leading-[1.1] text-ink">Overview</h1>
          <p className="mt-1.5 text-[14px] text-muted">Your conversational agents, knowledge and operations at a glance.</p>
        </div>
        <div className="flex items-center gap-2.5">
          <a href="/" target="_blank" rel="noreferrer" className="inline-flex h-[38px] items-center gap-2 rounded-lg border border-[var(--color-line)] bg-surface px-3.5 text-[13.5px] font-semibold text-ink-2 shadow-[var(--shadow-xs)] transition-colors hover:bg-[var(--color-canvas)]"><ArrowUpRight className="h-4 w-4" /> View site</a>
          <Link href="/admin/new" className="inline-flex h-[38px] items-center gap-2 rounded-lg bg-brand px-3.5 text-[13.5px] font-semibold text-white shadow-[var(--shadow-xs)] transition-[transform,background] hover:bg-[color-mix(in_srgb,var(--color-brand)_90%,#000)] active:scale-[0.98]"><Plus className="h-4 w-4" /> New agent</Link>
        </div>
      </header>

      {/* Metrics — one intentional panel, hairline-divided, number-forward. No icon tiles. */}
      <section className="overflow-hidden rounded-2xl border border-[var(--color-line)] bg-surface shadow-[var(--shadow-xs)]">
        <div className="grid grid-cols-2 divide-[var(--color-line-soft)] md:grid-cols-4 md:divide-x [&>*]:border-b [&>*]:border-[var(--color-line-soft)] md:[&>*]:border-b-0 [&>*:nth-child(odd)]:border-r md:[&>*]:border-r-0">
          {stats.map((s) => (
            <div key={s.label} className="px-5 py-5 md:px-6 md:py-6">
              <div className="text-[12.5px] font-medium text-muted">{s.label}</div>
              <div className="mt-2.5 text-[32px] font-bold leading-none tracking-[-0.03em] text-ink tabular-nums">{s.value}</div>
              <div className="mt-2 text-[12.5px] text-muted">{s.hint}</div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3 border-t border-[var(--color-line)] bg-[var(--color-canvas)] px-6 py-4">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Performance</span>
          {kpis.map((k) => (
            <div key={k.label} className="flex items-baseline gap-2">
              <span className={`text-[17px] font-bold tabular-nums ${k.good && k.value !== "—" && k.value !== "0%" ? "text-[var(--color-pos)]" : "text-ink"}`}>{k.value}</span>
              <span className="text-[12.5px] text-muted">{k.label}</span>
            </div>
          ))}
          <Link href="/admin/analytics" className="ml-auto inline-flex items-center gap-1 text-[12.5px] font-semibold text-[var(--color-brand)] hover:underline">Full analytics <ArrowRight className="h-3.5 w-3.5" /></Link>
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Agents</CardTitle><Link href="/admin/agents" className="text-[13px] font-semibold text-[var(--color-brand)]">View all</Link></CardHeader>
          <div className="px-2 py-1.5">
            {liveAgents.map((a) => {
              const primary = a.definition?.theme?.colors?.primary ?? "#0020F5";
              const logoUrl = a.definition?.theme?.logoUrl as string | undefined;
              return (
                <Link key={a.slug} href={`/admin/${a.slug}`} className="group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-[var(--color-line-soft)]">
                  {logoUrl ? (
                    <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-lg border border-[var(--color-line)] bg-white p-1.5 shadow-[var(--shadow-xs)]">
                      <img src={logoUrl} alt={a.name} className="max-h-full max-w-full object-contain" />
                    </span>
                  ) : (
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[13px] font-bold uppercase text-white" style={{ background: primary }}>{a.name.charAt(0)}</span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold text-ink">{a.name}</span>
                    <span className="block truncate text-[12.5px] text-muted">{a.tenant}</span>
                  </span>
                  <Badge tone={a.status === "live" ? "live" : "draft"} dot>{a.status}</Badge>
                  <ChevronRight className="h-4 w-4 text-[#d0d5dd] transition-colors group-hover:text-muted" />
                </Link>
              );
            })}
          </div>
        </Card>

        <Card>
          <CardHeader><CardTitle>Recent activity</CardTitle></CardHeader>
          <CardContent className="py-2">
            {recent.length === 0 ? <p className="py-2 text-sm text-muted">No activity yet.</p> : recent.map((r, i) => (
              <div key={i} className="flex items-center gap-3 py-2.5">
                <span className={dot(r.action)} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-medium capitalize text-ink">{String(r.action).replace(/_/g, " ")}</span>
                  <span className="block text-[12px] text-muted">{r.agentName ?? "—"} · {r.actor}</span>
                </span>
                <span className="text-[12px] text-muted">{ago(r.createdAt)}</span>
              </div>
            ))}
            <Link href="/admin/activity" className="mt-1.5 inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--color-brand)] hover:underline">All activity <ArrowRight className="h-3.5 w-3.5" /></Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function dot(action: string) {
  const c = action.includes("submit") || action.includes("confirm") ? "bg-[#17b26a]" : action.includes("escal") || action.includes("fail") ? "bg-[#f79009]" : "bg-[#d0d5dd]";
  return `h-2 w-2 shrink-0 rounded-full ${c}`;
}
