import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { currentDeveloper } from "@/lib/developer/session";
import { adminEvents, adminOverview } from "@/lib/developer/admin";
import { AdminHeader } from "@/components/developers/admin/AdminNav";
import { Time } from "@/components/developers/admin/ui";
import { Dash, Empty, TableFrame, Td, Th } from "@/components/developers/admin/table";
import { rowCls, theadCls } from "@/components/developers/admin/styles";
import { actionLabel, byLabel, eventDetails, numberFmt } from "@/components/developers/admin/labels";
import { cn } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Administration" };

/** The admin front page: the portal's last day in six numbers, then the latest portal events. */
export default async function AdminOverviewPage() {
  const dev = await currentDeveloper();
  if (!dev) redirect("/developers/login?next=/developers/admin");
  if (dev.role !== "admin") notFound();

  const [o, recent] = await Promise.all([adminOverview(), adminEvents({ scope: "portal", limit: 10 })]);

  const tiles: { label: string; value: string; sub?: string; attention?: boolean }[] = [
    { label: "Active accounts", value: numberFmt.format(o.accounts.active), sub: `of ${numberFmt.format(o.accounts.total)}, ${numberFmt.format(o.accounts.admins)} admin${o.accounts.admins === 1 ? "" : "s"}` },
    { label: "Live applications", value: numberFmt.format(o.applications.live), sub: `of ${numberFmt.format(o.applications.total)}` },
    {
      label: "Requests 24h",
      value: numberFmt.format(o.requests24h.total),
      sub: `${numberFmt.format(o.requests24h.errors)} error${o.requests24h.errors === 1 ? "" : "s"}`,
      attention: o.requests24h.errors > 0,
    },
    { label: "Median latency 24h", value: o.requests24h.total ? `${numberFmt.format(o.requests24h.medianLatencyMs)} ms` : "-" },
    { label: "Open tasks", value: numberFmt.format(o.tasks.open), sub: `of ${numberFmt.format(o.tasks.total)}` },
    { label: "Sign-ins 24h", value: numberFmt.format(o.signIns24h) },
  ];

  return (
    <div>
      <AdminHeader title="Administration" subtitle="Accounts, applications, settings and logs for the developer portal." />

      <section aria-label="The last day" className="mt-8 grid grid-cols-2 gap-px border border-[var(--color-line)] bg-[var(--color-line)] sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((t) => (
          <div key={t.label} className="bg-white px-5 py-5">
            <div className="text-[12.5px] text-muted">{t.label}</div>
            <div className="mt-2 text-[28px] font-semibold leading-none tabular-nums text-ink">{t.value}</div>
            {t.sub ? <div className={cn("mt-2 text-[12.5px] tabular-nums", t.attention ? "font-medium text-[#b42318]" : "text-muted")}>{t.sub}</div> : null}
          </div>
        ))}
      </section>

      <section aria-labelledby="recent" className="mt-10">
        <div className="flex items-end justify-between gap-4">
          <h2 id="recent" className="text-[15px] font-semibold text-ink">
            Recent activity
          </h2>
          <Link href="/developers/admin/logs?tab=events&scope=portal" className="inline-flex items-center gap-1 text-[13px] font-medium text-[#1330f0] hover:underline">
            All logs
            <ArrowRight size={14} strokeWidth={1.75} />
          </Link>
        </div>
        <div className="mt-3">
          {recent.events.length ? (
            <TableFrame minWidth={720}>
              <thead className={theadCls}>
                <tr>
                  <Th>Time</Th>
                  <Th>Action</Th>
                  <Th>By</Th>
                  <Th>Details</Th>
                </tr>
              </thead>
              <tbody>
                {recent.events.map((e) => {
                  const a = actionLabel(e.action);
                  const details = eventDetails(e.payload);
                  return (
                    <tr key={e.id} className={rowCls}>
                      <Td className="whitespace-nowrap text-ink-2">
                        <Time iso={e.createdAt} />
                      </Td>
                      <Td className={cn("whitespace-nowrap", a.known ? "text-ink" : "mono text-[12.5px] text-ink-2")}>{a.label}</Td>
                      <Td className="text-ink-2">{byLabel(e.by) ?? <Dash />}</Td>
                      <Td className="text-ink-2">
                        {details ? (
                          <span className="line-clamp-2 max-w-[60ch]" title={details}>
                            {details}
                          </span>
                        ) : (
                          <Dash />
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </TableFrame>
          ) : (
            <Empty text="Nothing has happened on the portal yet. Sign-ins, account changes and application changes appear here." />
          )}
        </div>
      </section>
    </div>
  );
}
