"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { AdminHeader } from "@/components/developers/admin/AdminNav";
import { Confirm, CopyButton, Notice, Time, adminApi, type NoteValue } from "@/components/developers/admin/ui";
import { Empty, TableFrame, Tag, Td, Th } from "@/components/developers/admin/table";
import { btnPrimary, btnSecondary, linkAction, rowCls, theadCls } from "@/components/developers/admin/styles";
import { absolute } from "@/components/developers/admin/labels";
import type { AgentOption, AppRow } from "@/components/developers/admin/types";
import { cn } from "@/lib/utils";

type Panel = { id: string; kind: "agents"; selected: string[] } | { id: string; kind: "revoke" };

const COLS = 9;

export function ApplicationsClient({ initial, agents: initialAgents }: { initial: AppRow[]; agents: AgentOption[] }) {
  const [apps, setApps] = useState(initial);
  const [agents, setAgents] = useState(initialAgents);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<NoteValue | null>(null);
  const [showRevoked, setShowRevoked] = useState(true);

  const agentName = (key: string) => agents.find((a) => a.key === key)?.name ?? key;

  async function refresh() {
    setBusy("refresh");
    const r = await adminApi<{ apps: AppRow[]; agents: AgentOption[] }>("/api/developers/admin/apps");
    setBusy(null);
    if (r.ok) {
      setApps(r.body.apps);
      setAgents(r.body.agents);
    } else setNote({ tone: "error", text: `The applications could not be loaded (${r.error}).` });
  }

  function open(p: Panel | null) {
    setPanel(p);
    setPanelError(null);
    setNote(null);
  }

  async function patch(app: AppRow, body: { agentSlugs?: string[]; revoke?: true }, done: string) {
    setBusy(`patch:${app.id}`);
    setPanelError(null);
    const r = await adminApi<{ app: Omit<AppRow, "accountId" | "accountEmail" | "organization"> }>(`/api/developers/admin/apps/${app.id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    setBusy(null);
    if (!r.ok) {
      setPanelError(
        r.error === "unknown_agent" ? "One of the agents is not in the catalogue. Refresh the page and try again." : r.status === 404 ? "This application no longer exists." : `The change was not saved (${r.error}).`
      );
      return;
    }
    setApps((list) => list.map((a) => (a.id === app.id ? { ...a, ...r.body.app } : a)));
    setPanel(null);
    setNote({ tone: "ok", text: done });
  }

  const revokedCount = apps.filter((a) => a.revokedAt).length;
  const shown = showRevoked ? apps : apps.filter((a) => !a.revokedAt);

  return (
    <div>
      <AdminHeader
        title="Applications"
        subtitle="Every application on the portal, across all accounts. Change which agents one may call, or revoke it."
        actions={
          <button type="button" className={btnSecondary} onClick={() => void refresh()} disabled={busy === "refresh"}>
            <RefreshCw size={14} strokeWidth={1.75} className={cn(busy === "refresh" && "animate-spin motion-reduce:animate-none")} />
            Refresh
          </button>
        }
      />

      <Notice note={note} onDismiss={() => setNote(null)} />

      {revokedCount ? (
        <label className="mt-6 inline-flex items-center gap-2 text-[13px] text-ink-2">
          <input type="checkbox" checked={showRevoked} onChange={(e) => setShowRevoked(e.target.checked)} className="h-4 w-4 accent-[#1330f0]" />
          Show revoked applications ({revokedCount})
        </label>
      ) : null}

      <div className="mt-4">
        {shown.length === 0 ? (
          <Empty text="There are no applications yet. Developers create them from their own Applications page." />
        ) : (
          <TableFrame minWidth={1240}>
            <thead className={theadCls}>
              <tr>
                <Th>Application</Th>
                <Th>Organisation</Th>
                <Th>Client ID</Th>
                <Th>Key</Th>
                <Th>Agents</Th>
                <Th>Created</Th>
                <Th>Last used</Th>
                <Th>Status</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {shown.map((app) => {
                const p = panel?.id === app.id ? panel : null;
                const revoked = Boolean(app.revokedAt);
                const rowBusy = busy === `patch:${app.id}`;
                return (
                  <Fragment key={app.id}>
                    <tr className={cn(rowCls, "align-top", p && "border-b-0 bg-[var(--color-canvas)]")}>
                      <Td className={cn("font-medium", revoked ? "text-muted" : "text-ink")}>{app.name}</Td>
                      <Td>
                        <span className="block text-ink">{app.organization}</span>
                        <span className="mono block text-[12px] text-muted">{app.accountEmail}</span>
                      </Td>
                      <Td>
                        <span className="inline-flex items-center gap-1">
                          <code className="mono bg-transparent p-0 text-[12px] text-ink-2" title={app.clientId}>
                            {app.clientId.length > 22 ? `${app.clientId.slice(0, 22)}…` : app.clientId}
                          </code>
                          <CopyButton value={app.clientId} label="client ID" />
                        </span>
                      </Td>
                      <Td className="mono whitespace-nowrap text-[12px] text-ink-2">…{app.apiKeyHint}</Td>
                      <Td>
                        {app.agentSlugs.length ? (
                          <span className="flex flex-col gap-0.5">
                            {app.agentSlugs.map((k) => (
                              <span key={k} className="mono text-[12px] text-ink-2" title={agentName(k)}>
                                {k}
                              </span>
                            ))}
                          </span>
                        ) : (
                          <span className="text-muted">None</span>
                        )}
                      </Td>
                      <Td className="whitespace-nowrap text-ink-2">
                        <Time iso={app.createdAt} mode="absolute" />
                      </Td>
                      <Td className="whitespace-nowrap text-ink-2">{app.lastUsedAt ? <Time iso={app.lastUsedAt} /> : <span className="text-muted">Never</span>}</Td>
                      <Td>
                        {revoked ? (
                          <span title={app.revokedAt ? `Revoked ${absolute(app.revokedAt)}` : undefined}>
                            <Tag tone="error">Revoked</Tag>
                          </span>
                        ) : (
                          <Tag tone="ok">Live</Tag>
                        )}
                      </Td>
                      <Td>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          {!revoked ? (
                            <>
                              <button
                                type="button"
                                className={linkAction}
                                aria-expanded={p?.kind === "agents"}
                                onClick={() => open(p?.kind === "agents" ? null : { id: app.id, kind: "agents", selected: [...app.agentSlugs] })}
                              >
                                Edit agents
                              </button>
                              <button type="button" className={cn(linkAction, "text-[#b42318]")} aria-expanded={p?.kind === "revoke"} onClick={() => open(p?.kind === "revoke" ? null : { id: app.id, kind: "revoke" })}>
                                Revoke
                              </button>
                            </>
                          ) : null}
                          <Link href={`/developers/admin/logs?tab=requests&appId=${app.id}`} className={linkAction}>
                            View logs
                          </Link>
                        </div>
                      </Td>
                    </tr>
                    {p ? (
                      <tr className={cn(rowCls, "bg-[var(--color-canvas)]")}>
                        <Td colSpan={COLS} className="pt-0">
                          {p.kind === "agents" ? (
                            <form
                              className="border border-[var(--color-line)] bg-white px-4 py-3"
                              onSubmit={(e) => {
                                e.preventDefault();
                                void patch(app, { agentSlugs: p.selected }, `${app.name} may now call ${p.selected.length ? p.selected.join(", ") : "no agents"}.`);
                              }}
                            >
                              <fieldset>
                                <legend className="text-[13px] font-medium text-ink-2">Agents {app.name} may call</legend>
                                <div className="mt-2 flex flex-col gap-2">
                                  {agents.map((ag) => (
                                    <label key={ag.key} className="flex items-start gap-2.5 text-[13.5px] text-ink-2">
                                      <input
                                        type="checkbox"
                                        className="mt-0.5 h-4 w-4 accent-[#1330f0]"
                                        checked={p.selected.includes(ag.key)}
                                        onChange={(e) =>
                                          setPanel({ ...p, selected: e.target.checked ? [...p.selected, ag.key] : p.selected.filter((k) => k !== ag.key) })
                                        }
                                      />
                                      <span>
                                        {ag.name}
                                        <span className="mono ml-2 text-[12px] text-muted">{ag.key}</span>
                                      </span>
                                    </label>
                                  ))}
                                </div>
                              </fieldset>
                              {p.selected.length === 0 ? <p className="mt-2 text-[12.5px] text-[#b54708]">With no agents, every call this application makes is refused.</p> : null}
                              {panelError ? (
                                <p role="alert" className="mt-2 text-[13px] text-[#b42318]">
                                  {panelError}
                                </p>
                              ) : null}
                              <div className="mt-3 flex gap-2">
                                <button type="submit" className={btnPrimary} disabled={rowBusy}>
                                  {rowBusy ? "Saving…" : "Save agents"}
                                </button>
                                <button type="button" className={btnSecondary} onClick={() => open(null)} disabled={rowBusy}>
                                  Cancel
                                </button>
                              </div>
                            </form>
                          ) : (
                            <Confirm
                              text={`Revoke ${app.name} for ${app.organization}? Revoking stops its client secret, API key and every token at once. This cannot be undone.`}
                              confirmLabel="Revoke"
                              danger
                              busy={rowBusy}
                              error={panelError}
                              onConfirm={() => void patch(app, { revoke: true }, `${app.name} is revoked. Its credentials no longer work.`)}
                              onCancel={() => open(null)}
                            />
                          )}
                        </Td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </TableFrame>
        )}
      </div>
    </div>
  );
}
