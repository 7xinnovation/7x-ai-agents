import Link from "next/link";
import { sql, desc, eq } from "drizzle-orm";
import { getDb, agents, tenants, conversations, messages, kbChunks, escalations, auditLog, analyticsEvents } from "@dialog/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/field";
import { Plus, ArrowUpRight, ArrowRight, Users, MessagesSquare, Database, LifeBuoy, ChevronRight } from "lucide-react";

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
    { label: "Agents", value: nA, hint: `${nT} tenants`, icon: Users },
    { label: "Conversations", value: nC, hint: `${nM} messages`, icon: MessagesSquare },
    { label: "Knowledge chunks", value: nK, hint: "grounding", icon: Database },
    { label: "Escalations", value: nE, hint: "to humans", icon: LifeBuoy },
  ];
  const kpis = [
    { label: "Journey completion", value: rate(ev["journey.completed"] ?? 0, ev["journey.started"] ?? 0) },
    { label: "Payment success", value: rate(ev["payment.completed"] ?? 0, ev["payment.initiated"] ?? 0) },
    { label: "Self-service", value: rate(Math.max(0, (ev["conversation.started"] ?? 0) - (ev["callback.requested"] ?? 0)), ev["conversation.started"] ?? 0) },
    { label: "Shipment lookups", value: String(ev["shipment.lookup"] ?? 0) },
  ];

  return (
    <>
      <div className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium text-muted">
        <span className="grid h-5 w-5 place-items-center rounded bg-[#0020f5]"><img src="/7xlogo.svg" alt="" className="h-2 w-auto" /></span>
        7X <ChevronRight className="h-3.5 w-3.5" /> <span className="text-ink">Overview</span>
      </div>
      <header className="mb-7 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold tracking-[-0.02em]">Overview</h1>
          <p className="mt-1 text-[14px] text-muted">Your conversational agents at a glance.</p>
        </div>
        <div className="flex items-center gap-2.5">
          <a href="/" target="_blank" rel="noreferrer" className="inline-flex h-[38px] items-center gap-2 rounded-lg border border-[var(--color-line)] bg-surface px-3.5 text-[13.5px] font-semibold text-ink-2 shadow-[var(--shadow-xs)] hover:bg-[var(--color-canvas)]"><ArrowUpRight className="h-4 w-4" /> View site</a>
          <Link href="/admin/new" className="inline-flex h-[38px] items-center gap-2 rounded-lg bg-brand px-3.5 text-[13.5px] font-semibold text-white shadow-[var(--shadow-xs)] hover:bg-[color-mix(in_srgb,var(--color-brand)_90%,#000)]"><Plus className="h-4 w-4" /> New agent</Link>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-5 lg:grid-cols-4">
        {stats.map((s) => {
          const I = s.icon;
          return (
            <Card key={s.label} className="p-5">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-lg border border-[color-mix(in_srgb,var(--color-brand)_16%,white)] bg-[color-mix(in_srgb,var(--color-brand)_7%,white)] text-[var(--color-brand)]"><I className="h-[18px] w-[18px]" /></span>
                <span className="text-[13.5px] font-medium text-muted">{s.label}</span>
              </div>
              <div className="mt-3.5 flex items-end justify-between">
                <span className="text-[30px] font-bold leading-none tracking-tight text-ink tabular-nums">{s.value}</span>
                <span className="mb-0.5 text-[12.5px] text-muted">{s.hint}</span>
              </div>
            </Card>
          );
        })}
      </div>

      <Card className="mt-5">
        <CardHeader><CardTitle>Performance</CardTitle><span className="text-[12.5px] text-muted">All time</span></CardHeader>
        <div className="grid grid-cols-2 divide-x divide-y divide-[var(--color-line-soft)] sm:grid-cols-4 sm:divide-y-0">
          {kpis.map((k) => (
            <div key={k.label} className="px-5 py-4">
              <div className="text-[12.5px] font-medium text-muted">{k.label}</div>
              <div className="mt-1.5 text-[24px] font-bold tracking-tight text-ink tabular-nums">{k.value}</div>
            </div>
          ))}
        </div>
      </Card>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Agents</CardTitle><Link href="/admin/agents" className="text-[13px] font-semibold text-[var(--color-brand)]">View all</Link></CardHeader>
          <div className="px-2 py-1.5">
            {liveAgents.map((a) => {
              const primary = a.definition?.theme?.colors?.primary ?? "#0020F5";
              return (
                <Link key={a.slug} href={`/admin/${a.slug}`} className="group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-[var(--color-line-soft)]">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[13px] font-bold uppercase text-white" style={{ background: primary }}>{a.name.charAt(0)}</span>
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
            <Link href="/admin/activity" className="mt-1.5 inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--color-brand)]">All activity <ArrowRight className="h-3.5 w-3.5" /></Link>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function dot(action: string) {
  const c = action.includes("submit") || action.includes("confirm") ? "bg-[#17b26a]" : action.includes("escal") || action.includes("fail") ? "bg-[#f79009]" : "bg-[#d0d5dd]";
  return `h-2 w-2 shrink-0 rounded-full ${c}`;
}
