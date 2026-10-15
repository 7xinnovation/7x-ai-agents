"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { Plus, RefreshCw } from "lucide-react";
import { AdminHeader } from "@/components/developers/admin/AdminNav";
import { Confirm, CopyButton, Notice, Time, adminApi, type NoteValue } from "@/components/developers/admin/ui";
import { Empty, TableFrame, Tag, Td, Th } from "@/components/developers/admin/table";
import { btnPrimary, btnSecondary, inputCls, linkAction, rowCls, theadCls } from "@/components/developers/admin/styles";
import { numberFmt } from "@/components/developers/admin/labels";
import type { AccountRow } from "@/components/developers/admin/types";
import { cn } from "@/lib/utils";

type Role = "developer" | "admin";
type Panel =
  | { id: string; kind: "edit"; name: string; organization: string }
  | { id: string; kind: "role"; to: Role }
  | { id: string; kind: "active"; to: boolean };

interface Created {
  email: string;
  signInUrl: string;
  notified: boolean | null;
}

const COLS = 8;

export function AccountsClient({ initial, selfId }: { initial: AccountRow[]; selfId: string }) {
  const [accounts, setAccounts] = useState(initial);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<NoteValue | null>(null);

  async function refresh() {
    setBusy("refresh");
    const r = await adminApi<{ accounts: AccountRow[] }>("/api/developers/admin/accounts");
    setBusy(null);
    if (r.ok) setAccounts(r.body.accounts);
    else setNote({ tone: "error", text: r.message ?? `The accounts could not be loaded (${r.error}).` });
  }

  function open(p: Panel | null) {
    setPanel(p);
    setPanelError(null);
    setNote(null);
  }

  async function patch(id: string, body: Partial<{ organization: string; name: string; role: Role; active: boolean }>, done: string) {
    setBusy(`patch:${id}`);
    setPanelError(null);
    const r = await adminApi<{ ok: true }>(`/api/developers/admin/accounts/${id}`, { method: "PATCH", body: JSON.stringify(body) });
    setBusy(null);
    if (!r.ok) {
      setPanelError(r.message ?? (r.error === "bad_request" ? "Check the values: each must be between 1 and 120 characters." : `The change was not saved (${r.error}).`));
      return;
    }
    setAccounts((list) => list.map((a) => (a.id === id ? { ...a, ...body } : a)));
    setPanel(null);
    setNote({ tone: "ok", text: done });
    void refresh();
  }

  return (
    <div>
      <AdminHeader
        title="Accounts"
        subtitle="Everyone who can sign in to the developer portal. People sign in with a one-time code sent to their email; there are no passwords."
        actions={
          <>
            <button type="button" className={btnSecondary} onClick={() => void refresh()} disabled={busy === "refresh"}>
              <RefreshCw size={14} strokeWidth={1.75} className={cn(busy === "refresh" && "animate-spin motion-reduce:animate-none")} />
              Refresh
            </button>
            <button
              type="button"
              className={btnPrimary}
              aria-expanded={creating}
              aria-controls="new-account"
              onClick={() => {
                setCreating((v) => !v);
                setCreated(null);
              }}
            >
              <Plus size={15} strokeWidth={1.75} />
              New account
            </button>
          </>
        }
      />

      {creating ? (
        <NewAccountForm
          onCancel={() => setCreating(false)}
          onCreated={(c) => {
            setCreated(c);
            setCreating(false);
            void refresh();
          }}
        />
      ) : null}

      {created ? <CreatedPanel created={created} onDone={() => setCreated(null)} /> : null}

      <Notice note={note} onDismiss={() => setNote(null)} />

      <div className="mt-6">
        {accounts.length === 0 ? (
          <Empty text="There are no accounts yet. Create one to invite someone to the portal." />
        ) : (
          <TableFrame minWidth={980}>
            <thead className={theadCls}>
              <tr>
                <Th>Account</Th>
                <Th>Role</Th>
                <Th>Status</Th>
                <Th className="text-right">Applications</Th>
                <Th className="text-right">Requests 24h</Th>
                <Th>Last sign-in</Th>
                <Th>Created</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => {
                const p = panel?.id === a.id ? panel : null;
                const self = a.id === selfId;
                const rowBusy = busy === `patch:${a.id}`;
                return (
                  <Fragment key={a.id}>
                    <tr className={cn(rowCls, p && "border-b-0 bg-[var(--color-canvas)]", !a.active && "text-muted")}>
                      <Td>
                        <div className="font-medium text-ink">
                          {a.organization}
                          {self ? <span className="ml-1.5 text-[12px] font-normal text-muted">(you)</span> : null}
                        </div>
                        <div className="text-[13px] text-ink-2">{a.name}</div>
                        <div className="mono text-[12px] text-muted">{a.email}</div>
                      </Td>
                      <Td>{a.role === "admin" ? <Tag tone="brand">Admin</Tag> : <span className="text-ink-2">Developer</span>}</Td>
                      <Td>{a.active ? <Tag tone="ok">Active</Tag> : <Tag>Deactivated</Tag>}</Td>
                      <Td className="whitespace-nowrap text-right tabular-nums text-ink-2">
                        {a.liveApplications} / {a.applications}
                      </Td>
                      <Td className="text-right tabular-nums text-ink-2">{numberFmt.format(a.requests24h)}</Td>
                      <Td className="whitespace-nowrap text-ink-2">{a.lastLoginAt ? <Time iso={a.lastLoginAt} /> : <span className="text-muted">Never</span>}</Td>
                      <Td className="whitespace-nowrap text-ink-2">
                        <Time iso={a.createdAt} mode="absolute" />
                      </Td>
                      <Td>
                        <div className="flex items-center gap-x-3 whitespace-nowrap">
                          <button type="button" className={linkAction} onClick={() => open(p?.kind === "edit" ? null : { id: a.id, kind: "edit", name: a.name, organization: a.organization })}>
                            Edit
                          </button>
                          <button
                            type="button"
                            className={linkAction}
                            onClick={() => open(p?.kind === "role" ? null : { id: a.id, kind: "role", to: a.role === "admin" ? "developer" : "admin" })}
                          >
                            {a.role === "admin" ? "Make developer" : "Make admin"}
                          </button>
                          <button
                            type="button"
                            className={cn(linkAction, a.active && "text-[#b42318]")}
                            onClick={() => open(p?.kind === "active" ? null : { id: a.id, kind: "active", to: !a.active })}
                          >
                            {a.active ? "Deactivate" : "Reactivate"}
                          </button>
                          <Link href={`/developers/admin/logs?tab=requests&accountId=${a.id}`} className={linkAction}>
                            View logs
                          </Link>
                        </div>
                      </Td>
                    </tr>
                    {p ? (
                      <tr className={cn(rowCls, "bg-[var(--color-canvas)]")}>
                        <Td colSpan={COLS} className="pt-0">
                          {p.kind === "edit" ? (
                            <form
                              className="border border-[var(--color-line)] bg-white px-4 py-3"
                              onSubmit={(e) => {
                                e.preventDefault();
                                const body: { name?: string; organization?: string } = {};
                                if (p.name.trim() !== a.name) body.name = p.name.trim();
                                if (p.organization.trim() !== a.organization) body.organization = p.organization.trim();
                                if (!Object.keys(body).length) return open(null);
                                void patch(a.id, body, `Saved ${p.name.trim()}, ${p.organization.trim()}.`);
                              }}
                            >
                              <div className="grid gap-3 sm:grid-cols-2 sm:max-w-[640px]">
                                <label className="flex flex-col gap-1.5">
                                  <span className="text-[13px] font-medium text-ink-2">Organisation</span>
                                  <input className={inputCls} value={p.organization} maxLength={120} onChange={(e) => setPanel({ ...p, organization: e.target.value })} autoFocus />
                                </label>
                                <label className="flex flex-col gap-1.5">
                                  <span className="text-[13px] font-medium text-ink-2">Name</span>
                                  <input className={inputCls} value={p.name} maxLength={120} onChange={(e) => setPanel({ ...p, name: e.target.value })} />
                                </label>
                              </div>
                              {panelError ? (
                                <p role="alert" className="mt-2 text-[13px] text-[#b42318]">
                                  {panelError}
                                </p>
                              ) : null}
                              <div className="mt-3 flex gap-2">
                                <button type="submit" className={btnPrimary} disabled={rowBusy || !p.name.trim() || !p.organization.trim()}>
                                  {rowBusy ? "Saving…" : "Save"}
                                </button>
                                <button type="button" className={btnSecondary} onClick={() => open(null)} disabled={rowBusy}>
                                  Cancel
                                </button>
                              </div>
                            </form>
                          ) : p.kind === "role" ? (
                            <Confirm
                              text={
                                p.to === "admin"
                                  ? `Make ${a.name} an admin? They will see every account, application and log, and can change the portal's settings. It takes effect on their next page load.`
                                  : `Make ${a.name} a developer? They lose access to the admin pages at once and keep their own applications.`
                              }
                              confirmLabel={p.to === "admin" ? "Make admin" : "Make developer"}
                              busy={rowBusy}
                              error={panelError}
                              onConfirm={() => void patch(a.id, { role: p.to }, `${a.name} is now ${p.to === "admin" ? "an admin" : "a developer"}.`)}
                              onCancel={() => open(null)}
                            />
                          ) : (
                            <Confirm
                              text={
                                p.to
                                  ? `Reactivate ${a.name}? They can sign in again with a one-time code sent to ${a.email}.`
                                  : `Deactivate ${a.name}? This signs them out at once and stops new sign-ins. Their applications keep working until you revoke them on the Applications page.`
                              }
                              confirmLabel={p.to ? "Reactivate" : "Deactivate"}
                              danger={!p.to}
                              busy={rowBusy}
                              error={panelError}
                              onConfirm={() => void patch(a.id, { active: p.to }, p.to ? `${a.name} is active again.` : `${a.name} is deactivated and signed out.`)}
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

// ─── New account ─────────────────────────────────────────────────────────────

function NewAccountForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (c: Created) => void }) {
  const [organization, setOrganization] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("developer");
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await adminApi<{ account: { id: string; email: string }; signInUrl: string; notified: boolean | null }>("/api/developers/admin/accounts", {
      method: "POST",
      body: JSON.stringify({ organization: organization.trim(), name: name.trim(), email: email.trim(), role, notify }),
    });
    setBusy(false);
    if (!r.ok) {
      setError(
        r.error === "exists"
          ? "An account with this email already exists."
          : r.error === "bad_request"
            ? "Check the fields: organisation and name are required, and the email must be a valid address."
            : `The account was not created (${r.error}).`
      );
      return;
    }
    onCreated({ email: r.body.account.email, signInUrl: r.body.signInUrl, notified: r.body.notified });
  }

  const ready = organization.trim() && name.trim() && /.+@.+\..+/.test(email.trim());

  return (
    <form id="new-account" onSubmit={submit} className="mt-6 border border-[var(--color-line)] bg-white">
      <h2 className="border-b border-[var(--color-line)] px-5 py-3 text-[13px] font-semibold text-ink">New account</h2>
      <div className="grid gap-4 px-5 py-4 sm:grid-cols-2 lg:max-w-[760px]">
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink-2">Organisation</span>
          <input className={inputCls} value={organization} onChange={(e) => setOrganization(e.target.value)} maxLength={120} autoFocus placeholder="e.g. Prime Minister's Office" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink-2">Name</span>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink-2">Email</span>
          <input className={cn(inputCls, "mono text-[13px]")} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink-2">Role</span>
          <select className={cn(inputCls, "cursor-pointer")} value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="developer">Developer</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <label className="flex items-start gap-2.5 sm:col-span-2">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#1330f0]" />
          <span className="text-[13.5px] text-ink-2">
            Email them the sign-in link
            <span className="block text-[12.5px] text-muted">They sign in with this address and receive a one-time code; no password is set.</span>
          </span>
        </label>
      </div>
      {error ? (
        <p role="alert" className="px-5 pb-1 text-[13px] text-[#b42318]">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2 border-t border-[var(--color-line)] px-5 py-3">
        <button type="submit" className={btnPrimary} disabled={busy || !ready}>
          {busy ? "Creating…" : "Create account"}
        </button>
        <button type="button" className={btnSecondary} onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function CreatedPanel({ created, onDone }: { created: Created; onDone: () => void }) {
  const emailLine =
    created.notified === true
      ? `The sign-in link was emailed to ${created.email}.`
      : created.notified === false
        ? `The email to ${created.email} could not be sent. Share the link below with them yourself.`
        : "No email was sent. Share the link below with them yourself.";
  return (
    <section role="status" aria-label="Account created" className="mt-6 border border-[var(--color-line)] bg-white px-5 py-4">
      <h2 className="text-[14px] font-semibold text-ink">Account created for {created.email}</h2>
      <p className={cn("mt-1 text-[13.5px]", created.notified === false ? "text-[#b42318]" : "text-ink-2")}>{emailLine}</p>
      <div className="mt-3 flex max-w-full items-center gap-2 border border-[var(--color-line)] bg-[var(--color-canvas)] px-3 py-2">
        <code className="mono min-w-0 flex-1 truncate bg-transparent p-0 text-[12.5px]" title={created.signInUrl}>
          {created.signInUrl}
        </code>
        <CopyButton value={created.signInUrl} label="sign-in link" />
      </div>
      <button type="button" className={cn(btnSecondary, "mt-3")} onClick={onDone}>
        Done
      </button>
    </section>
  );
}
