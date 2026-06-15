import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { getDb, agents, tenants } from "@dialog/db";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/field";
import { Plus, ExternalLink, Pencil } from "lucide-react";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ago(d: Date | string) {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default async function Agents() {
  const rows = (await getDb()
    .select({ slug: agents.slug, name: agents.name, status: agents.status, updatedAt: agents.updatedAt, tenant: tenants.name, definition: agents.definition })
    .from(agents).leftJoin(tenants, eq(agents.tenantId, tenants.id)).orderBy(desc(agents.updatedAt))) as any[];

  return (
    <>
      <header className="mb-7 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[27px] font-extrabold tracking-tight">Agents</h1>
          <p className="mt-1 text-sm text-muted">Every embeddable assistant across your tenants. Click one to edit its configuration.</p>
        </div>
        <Link href="/admin/new" className="inline-flex h-10 items-center gap-2 rounded-xl bg-[linear-gradient(140deg,var(--color-brand-2),var(--color-brand))] px-4 text-sm font-semibold text-white shadow-[0_10px_24px_-6px_rgba(19,48,240,.5)] transition-transform hover:-translate-y-px">
          <Plus className="h-4 w-4" /> New agent
        </Link>
      </header>

      <Card className="overflow-hidden">
        <div className="grid grid-cols-[2.2fr_1.3fr_1fr_.9fr_1fr] gap-3 border-b border-[var(--color-line)] px-5 py-3 text-[11.5px] font-bold uppercase tracking-wide text-muted">
          <span>Agent</span><span>Tenant</span><span>Languages</span><span>Journeys</span><span className="text-right">Actions</span>
        </div>
        {rows.map((r) => {
          const primary = r.definition?.theme?.colors?.primary ?? "#1330F0";
          const locales = (r.definition?.locales ?? []).map((l: string) => l.toUpperCase()).join(" · ");
          return (
            <div key={r.slug} className="grid grid-cols-[2.2fr_1.3fr_1fr_.9fr_1fr] items-center gap-3 border-b border-[var(--color-line)] px-5 py-3.5 text-[13.5px] transition-colors last:border-0 hover:bg-[color-mix(in_srgb,var(--color-brand)_4%,white)]">
              <span className="flex items-center gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-sm font-extrabold uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,.3)]" style={{ background: primary }}>{r.name.charAt(0)}</span>
                <span className="min-w-0">
                  <Link href={`/admin/${r.slug}`} className="block truncate font-bold hover:text-[var(--color-brand)]">{r.name}</Link>
                  <span className="block truncate font-mono text-xs text-muted">{r.slug}</span>
                </span>
              </span>
              <span className="truncate">{r.tenant}</span>
              <span className="text-muted">{locales || "—"}</span>
              <span className="text-muted">{r.definition?.journeys?.length ?? 0}</span>
              <span className="flex items-center justify-end gap-3 text-[13px] font-semibold text-[var(--color-brand)]">
                <a href={`/embed/${r.slug}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline"><ExternalLink className="h-3.5 w-3.5" /> Open</a>
                <Link href={`/admin/${r.slug}`} className="inline-flex items-center gap-1 hover:underline"><Pencil className="h-3.5 w-3.5" /> Edit</Link>
              </span>
            </div>
          );
        })}
      </Card>
    </>
  );
}
