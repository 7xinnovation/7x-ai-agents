import Link from "next/link";
import { sql, desc, eq } from "drizzle-orm";
import { getDb, agents, tenants, conversations, messages, kbChunks, escalations, auditLog, analyticsEvents } from "@dialog/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/field";
import { Plus, ArrowRight } from "lucide-react";

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
    { label: "Agents", value: nA, hint: `${nT} tenants` },
    { label: "Conversations", value: nC, hint: `${nM} messages` },
    { label: "Knowledge chunks", value: nK, hint: "grounding" },
    { label: "Escalations", value: nE, hint: "to humans" },
  ];
  const kpis = [
    { label: "Journey completion", value: rate(ev["journey.completed"] ?? 0, ev["journey.started"] ?? 0), hint: `${ev["journey.completed"] ?? 0}/${ev["journey.started"] ?? 0}` },
    { label: "Payment success", value: rate(ev["payment.completed"] ?? 0, ev["payment.initiated"] ?? 0), hint: `${ev["payment.completed"] ?? 0}/${ev["payment.initiated"] ?? 0} paid` },
    { label: "Self-service", value: rate(Math.max(0, (ev["conversation.started"] ?? 0) - (ev["callback.requested"] ?? 0)), ev["conversation.started"] ?? 0), hint: `${ev["callback.requested"] ?? 0} callbacks` },
    { label: "Shipment lookups", value: String(ev["shipment.lookup"] ?? 0), hint: "tracking" },
  ];

  return (
    <>
      <header className="mb-7 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[27px] font-extrabold tracking-tight">Overview</h1>
          <p className="mt-1 text-sm text-muted">Your conversational agents at a glance.</p>
        </div>
        <Link href="/admin/new" className="relative inline-flex h-10 items-center gap-2 overflow-hidden rounded-xl bg-[linear-gradient(140deg,var(--color-brand-2),var(--color-brand))] px-4 text-sm font-semibold text-white shadow-[0_10px_24px_-6px_rgba(19,48,240,.5)] transition-transform hover:-translate-y-px">
          <Plus className="h-4 w-4" /> New agent
        </Link>
      </header>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="relative overflow-hidden p-5 transition-all hover:-translate-y-0.5 hover:shadow-[0_2px_4px_rgba(16,24,40,.05),0_20px_40px_-16px_rgba(16,24,40,.28)]">
            <span className="absolute inset-x-0 top-0 h-[3px] bg-[linear-gradient(90deg,var(--color-brand-2),var(--color-brand))]" />
            <div className="text-[12.5px] font-semibold text-muted">{s.label}</div>
            <div className="mt-1 bg-[linear-gradient(180deg,var(--color-ink),color-mix(in_srgb,var(--color-ink)_72%,var(--color-brand)))] bg-clip-text text-[30px] font-extrabold tracking-tight text-transparent tabular-nums">{s.value}</div>
            <div className="text-xs text-muted">{s.hint}</div>
          </Card>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((s) => (
          <Card key={s.label} className="p-5">
            <div className="text-[12.5px] font-semibold text-muted">{s.label}</div>
            <div className="mt-1 text-[26px] font-extrabold tracking-tight tabular-nums">{s.value}</div>
            <div className="text-xs text-muted">{s.hint}</div>
          </Card>
        ))}
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Agents</CardTitle><Link href="/admin/agents" className="text-[13px] font-semibold text-[var(--color-brand)]">View all</Link></CardHeader>
          <CardContent className="pt-0">
            {liveAgents.map((a) => {
              const primary = a.definition?.theme?.colors?.primary ?? "#1330F0";
              return (
                <Link key={a.slug} href={`/admin/${a.slug}`} className="-mx-2 flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-[color-mix(in_srgb,var(--color-brand)_4%,white)] [&+a]:border-t [&+a]:border-[var(--color-line)]">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-sm font-extrabold uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,.3)]" style={{ background: primary }}>{a.name.charAt(0)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold">{a.name}</span>
                    <span className="block truncate text-[12.5px] text-muted">{a.tenant}</span>
                  </span>
                  <Badge tone={a.status === "live" ? "live" : "draft"}>{a.status}</Badge>
                </Link>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Recent activity</CardTitle></CardHeader>
          <CardContent className="pt-0">
            {recent.length === 0 ? <p className="py-2 text-sm text-muted">No activity yet.</p> : recent.map((r, i) => (
              <div key={i} className="flex items-center gap-3 border-t border-[var(--color-line)] py-2.5 first:border-t-0">
                <span className={cnDot(r.action)} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-semibold capitalize">{String(r.action).replace(/_/g, " ")}</span>
                  <span className="block text-xs text-muted">{r.agentName ?? "—"} · {r.actor}</span>
                </span>
                <span className="text-xs text-muted">{ago(r.createdAt)}</span>
              </div>
            ))}
            <Link href="/admin/activity" className="mt-2 inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--color-brand)]">All activity <ArrowRight className="h-3.5 w-3.5" /></Link>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function cnDot(action: string) {
  const c = action.includes("submit") || action.includes("confirm") ? "bg-emerald-500" : action.includes("escal") || action.includes("fail") ? "bg-amber-500" : "bg-slate-300";
  return `h-2 w-2 shrink-0 rounded-full ${c}`;
}
