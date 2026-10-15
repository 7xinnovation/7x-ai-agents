import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { currentDeveloper } from "@/lib/developer/session";
import { adminEvents, adminRequests, adminTasks, listAccounts, listAllApps, type EventScope } from "@/lib/developer/admin";
import { LogsClient, type LogsFilters, type LogsTab, type LogsInitial } from "./LogsClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Logs" };

type Search = Promise<Record<string, string | string[] | undefined>>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

/**
 * Requests, tasks and audit events in one place. The tab and the filters live
 * in the URL, so the other admin pages can link straight to a filtered view;
 * the first page is rendered here and the client pages on from it.
 */
export default async function AdminLogsPage({ searchParams }: { searchParams: Search }) {
  const dev = await currentDeveloper();
  if (!dev) redirect("/developers/login?next=/developers/admin/logs");
  if (dev.role !== "admin") notFound();

  const sp = await searchParams;
  const t = one(sp.tab);
  const tab: LogsTab = t === "tasks" || t === "events" ? t : "requests";
  const outcome = one(sp.outcome);
  const scope = one(sp.scope);
  const filters: LogsFilters = {
    accountId: one(sp.accountId),
    appId: one(sp.appId),
    outcome: outcome === "ok" || outcome === "error" ? outcome : undefined,
    state: one(sp.state),
    scope: scope === "sandbox" || scope === "all" ? scope : "portal",
    q: one(sp.q)?.slice(0, 100),
  };

  const [accounts, apps, initial] = await Promise.all([
    listAccounts(),
    listAllApps(),
    (async (): Promise<LogsInitial> => {
      if (tab === "tasks") {
        const r = await adminTasks({ accountId: filters.accountId, appId: filters.appId, state: filters.state, limit: 50 });
        return { tab, rows: r.tasks, nextCursor: r.nextCursor };
      }
      if (tab === "events") {
        const r = await adminEvents({ scope: filters.scope as EventScope, q: filters.q, limit: 100 });
        return { tab, rows: r.events, nextCursor: r.nextCursor };
      }
      const r = await adminRequests({ accountId: filters.accountId, appId: filters.appId, outcome: filters.outcome as "ok" | "error" | undefined, limit: 100 });
      return { tab, rows: r.requests, nextCursor: r.nextCursor };
    })(),
  ]);

  return (
    <LogsClient
      initial={initial}
      initialFilters={filters}
      accounts={accounts.map((a) => ({ id: a.id, label: `${a.organization} (${a.email})` }))}
      apps={apps.map((a) => ({ id: a.id, accountId: a.accountId, label: `${a.name}, ${a.organization}` }))}
    />
  );
}
