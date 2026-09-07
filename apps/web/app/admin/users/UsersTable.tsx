"use client";

import { useState } from "react";
import { UserPlus, ShieldCheck, ChevronDown, Mail, Check } from "lucide-react";
import { Badge } from "@/components/ui/field";

export interface UserRow {
  id: string;
  email: string;
  name: string;
  role: "owner" | "admin" | "editor" | "viewer";
  provider: "password" | "entra";
  active: boolean;
  lastLoginAt: string | Date | null;
  createdAt: string | Date;
  /** Agent slugs this account may see. Empty means all of them. */
  agentScope?: string[] | null;
  /** An invitation is open and has not been accepted. */
  invited?: boolean;
  inviteExpiresAt?: string | Date | null;
}

export interface AgentOption { slug: string; name: string }

const ROLES = ["owner", "admin", "editor", "viewer"] as const;
const roleTone: Record<string, "brand" | "live" | "muted" | "draft"> = { owner: "brand", admin: "live", editor: "muted", viewer: "draft" };
/** Owners and admins can lift any restriction themselves, so scoping them is theatre. */
const scoped = (r: UserRow["role"]) => r === "viewer" || r === "editor";
/**
 * What to tell the admin about an invitation they just sent.
 *
 * When no mail provider is configured the server hands back the link instead of
 * pretending to have sent one — an admin can then pass it on themselves, and
 * nobody is told an email went out that did not.
 */
function inviteResult(body: { sent?: boolean; link?: string; reason?: string }, email: string): string {
  if (body.sent) return `Invitation sent to ${email}. The link works once and expires in 7 days.`;
  if (body.link) return `Email is not configured on this environment, so nothing was sent. Give them this link yourself: ${body.link}`;
  return `The account was created, but the invitation could not be sent${body.reason ? ` (${body.reason})` : ""}. Try Resend.`;
}

/** Turn a zod flatten() or a code into something a person can act on. */
function errorText(error: unknown): string | null {
  if (!error) return null;
  if (typeof error === "string") {
    return error === "email_exists"
      ? "There is already an account with that email."
      : error === "password_or_invite_required"
        ? "Set a password, or use Invite to let them choose their own."
        : error;
  }
  const flat = error as { fieldErrors?: Record<string, string[]> };
  const first = Object.entries(flat.fieldErrors ?? {})[0];
  return first ? `${first[0]}: ${first[1]?.[0] ?? "invalid"}` : "Failed";
}

/** What the picker button reads when it is shut. */
function scopeLabel(u: UserRow, agents: AgentOption[]): string {
  const scope = u.agentScope ?? [];
  if (!scope.length) return "All agents";
  if (scope.length === 1) return agents.find((a) => a.slug === scope[0])?.name ?? scope[0]!;
  return `${scope.length} agents`;
}

export function UsersTable({ initial, agents = [] }: { initial: UserRow[]; agents?: AgentOption[] }) {
  const [rows, setRows] = useState(initial);
  const [open, setOpen] = useState(false);
  /** Which row has its agent picker open. */
  const [picking, setPicking] = useState<string | null>(null);
  const [form, setForm] = useState({
    email: "",
    name: "",
    password: "",
    role: "viewer" as UserRow["role"],
    agentScope: [] as string[],
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  /** What happened to the last invitation, in the words the admin needs. */
  const [note, setNote] = useState("");

  async function refresh() {
    const r = await fetch("/api/admin/users");
    if (r.ok) setRows((await r.json()).users);
  }
  async function patch(id: string, body: Record<string, unknown>) {
    await fetch("/api/admin/users", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...body }) });
    await refresh();
  }
  /**
   * Create the account, either way.
   *
   * `invite` sends them a link to choose their own password; without it an
   * admin types one and has to pass it on, which means the password exists
   * somewhere else before it exists in their head.
   */
  async function create(invite: boolean) {
    setBusy(true); setErr(""); setNote("");
    const r = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(invite ? { ...form, password: undefined, invite: true } : form),
    });
    const body = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(errorText(body.error) ?? "Failed"); return; }
    setOpen(false);
    setForm({ email: "", name: "", password: "", role: "viewer", agentScope: [] });
    if (invite) setNote(inviteResult(body, form.email));
    await refresh();
  }

  /** Send an invitation again — a link expired, or never arrived. */
  async function resend(u: UserRow) {
    setNote("");
    const r = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: u.id, invite: true }),
    });
    const body = await r.json().catch(() => ({}));
    setNote(r.ok ? inviteResult(body, u.email) : "The invitation could not be sent.");
    await refresh();
  }

  const fmt = (d: string | Date | null) => (d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");

  return (
    <div>
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Users &amp; Roles</h1>
          <p className="mt-1 text-[14px] text-muted">Role-based access control for the console. owner &gt; admin &gt; editor &gt; viewer.</p>
        </div>
        <button onClick={() => setOpen((v) => !v)} className="inline-flex h-[38px] items-center gap-2 rounded-lg bg-brand px-3.5 text-[13.5px] font-semibold text-white shadow-xs hover:opacity-90">
          <UserPlus className="h-4 w-4" /> New user
        </button>
      </div>

      {open && (
        <div className="mb-5 rounded-xl border border-[var(--color-line)] bg-surface p-4 shadow-[var(--shadow-xs)]">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <input className="h-10 rounded-lg border border-[var(--color-line)] px-3 text-sm outline-none focus:border-[var(--color-brand)]" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <input className="h-10 rounded-lg border border-[var(--color-line)] px-3 text-sm outline-none focus:border-[var(--color-brand)]" placeholder="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className="h-10 rounded-lg border border-[var(--color-line)] px-3 text-sm outline-none focus:border-[var(--color-brand)]" type="password" placeholder="Password (optional)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <select className="h-10 rounded-lg border border-[var(--color-line)] px-3 text-sm outline-none focus:border-[var(--color-brand)]" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as UserRow["role"] })}>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>

          {/* Which agents they may see, decided before the invitation goes out
              rather than after they have already signed in and seen everything. */}
          {scoped(form.role) && agents.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-[12.5px] font-medium text-muted">Agents:</span>
              <button
                onClick={() => setForm({ ...form, agentScope: [] })}
                className={`rounded-md border px-2.5 py-1 text-[12.5px] font-medium ${form.agentScope.length === 0 ? "border-[var(--color-brand)] bg-[var(--color-line-soft)] text-ink" : "border-[var(--color-line)] text-muted hover:text-ink"}`}
              >
                All agents
              </button>
              {agents.map((a) => {
                const on = form.agentScope.includes(a.slug);
                return (
                  <button
                    key={a.slug}
                    onClick={() =>
                      setForm({
                        ...form,
                        agentScope: on ? form.agentScope.filter((x) => x !== a.slug) : [...form.agentScope, a.slug],
                      })
                    }
                    className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12.5px] font-medium ${on ? "border-[var(--color-brand)] bg-[var(--color-line-soft)] text-ink" : "border-[var(--color-line)] text-muted hover:text-ink"}`}
                  >
                    {on && <Check className="h-3 w-3" />}
                    {a.name}
                  </button>
                );
              })}
            </div>
          )}

          {err && <p className="mt-2 text-[12.5px] text-[#d92d20]">{err}</p>}
          <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
            <p className="mr-auto max-w-[46ch] text-[12px] leading-relaxed text-muted">
              Leave the password blank and send an invitation — they choose their own from a link that works once.
            </p>
            <button onClick={() => setOpen(false)} className="h-9 rounded-lg border border-[var(--color-line)] px-3 text-[13px] font-medium hover:bg-[var(--color-line-soft)]">Cancel</button>
            <button
              disabled={busy || !form.email || !form.name}
              onClick={() => create(true)}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--color-brand)] px-3.5 text-[13px] font-semibold text-[var(--color-brand)] hover:bg-[var(--color-line-soft)] disabled:opacity-50"
            >
              <Mail className="h-3.5 w-3.5" /> {busy ? "Sending…" : "Invite"}
            </button>
            <button
              disabled={busy || !form.email || !form.name || form.password.length < 6}
              onClick={() => create(false)}
              className="h-9 rounded-lg bg-brand px-3.5 text-[13px] font-semibold text-white disabled:opacity-50"
              title={form.password.length < 6 ? "Set a password of at least 6 characters, or use Invite" : undefined}
            >
              {busy ? "Creating…" : "Create with password"}
            </button>
          </div>
        </div>
      )}

      {note && (
        <div className="mb-5 rounded-xl border border-[var(--color-line)] bg-surface px-4 py-3 text-[13px] leading-relaxed shadow-[var(--shadow-xs)]">
          <div className="flex items-start gap-2">
            <Mail className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-brand)]" />
            <p className="flex-1 break-all">{note}</p>
            <button onClick={() => setNote("")} className="text-[12px] font-medium text-muted hover:text-ink">Dismiss</button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-[var(--color-line)] bg-surface shadow-[var(--shadow-xs)]">
        <table className="w-full min-w-[560px] text-left text-[13.5px]">
          <thead className="border-b border-[var(--color-line)] text-[12px] uppercase tracking-wide text-muted">
            <tr>
              <th className="px-5 py-3 font-semibold">User</th>
              <th className="px-5 py-3 font-semibold">Role</th>
              <th className="px-5 py-3 font-semibold">Agents</th>
              <th className="px-5 py-3 font-semibold">Provider</th>
              <th className="px-5 py-3 font-semibold">Status</th>
              <th className="px-5 py-3 font-semibold">Last login</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id} className="border-b border-[var(--color-line-soft)] last:border-0">
                <td className="px-5 py-3">
                  <div className="font-semibold text-ink">{u.name}</div>
                  <div className="text-[12px] text-muted">{u.email}</div>
                </td>
                <td className="px-5 py-3">
                  <select value={u.role} onChange={(e) => patch(u.id, { role: e.target.value })} className="rounded-md border border-[var(--color-line)] bg-surface px-2 py-1 text-[12.5px] font-medium outline-none focus:border-[var(--color-brand)]">
                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </td>
                <td className="px-5 py-3">
                  {!scoped(u.role) ? (
                    <span className="text-[12.5px] text-muted">All agents</span>
                  ) : (
                    <div className="relative">
                      <button
                        onClick={() => setPicking((v) => (v === u.id ? null : u.id))}
                        className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-line)] px-2 py-1 text-[12.5px] font-medium hover:bg-[var(--color-line-soft)]"
                      >
                        {scopeLabel(u, agents)}
                        <ChevronDown className="h-3.5 w-3.5 text-muted" />
                      </button>
                      {picking === u.id && (
                        <div className="absolute left-0 z-20 mt-1 w-[248px] rounded-lg border border-[var(--color-line)] bg-surface p-1.5 shadow-[var(--shadow-md)]">
                          <button
                            onClick={() => { void patch(u.id, { agentScope: [] }); setPicking(null); }}
                            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-[var(--color-line-soft)]"
                          >
                            <input type="checkbox" readOnly checked={(u.agentScope ?? []).length === 0} className="h-3.5 w-3.5" />
                            <span className="font-medium">All agents</span>
                          </button>
                          <div className="my-1 border-t border-[var(--color-line-soft)]" />
                          {agents.map((a) => {
                            const on = (u.agentScope ?? []).includes(a.slug);
                            return (
                              <button
                                key={a.slug}
                                onClick={() => {
                                  const cur = u.agentScope ?? [];
                                  void patch(u.id, { agentScope: on ? cur.filter((x) => x !== a.slug) : [...cur, a.slug] });
                                }}
                                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-[var(--color-line-soft)]"
                              >
                                <input type="checkbox" readOnly checked={on} className="h-3.5 w-3.5" />
                                <span className="truncate">{a.name}</span>
                              </button>
                            );
                          })}
                          {!agents.length && <p className="px-2 py-1.5 text-[12.5px] text-muted">No agents yet.</p>}
                        </div>
                      )}
                    </div>
                  )}
                </td>
                <td className="px-5 py-3"><Badge tone={u.provider === "entra" ? "brand" : "muted"}>{u.provider === "entra" ? "Microsoft SSO" : "Password"}</Badge></td>
                <td className="px-5 py-3">
                  {/* An invitation that has not been accepted is its own state:
                      "Active" would say the account can be signed into, and it
                      cannot — there is no password on it yet. */}
                  {u.invited ? (
                    <span className="inline-flex items-center gap-2">
                      <Badge tone="brand" dot>Invited</Badge>
                      <button onClick={() => resend(u)} className="text-[12px] font-medium text-muted underline-offset-2 hover:text-ink hover:underline">
                        Resend
                      </button>
                    </span>
                  ) : (
                    <button onClick={() => patch(u.id, { active: !u.active })} className="inline-flex items-center gap-1.5">
                      <Badge tone={u.active ? "live" : "draft"} dot>{u.active ? "Active" : "Disabled"}</Badge>
                    </button>
                  )}
                </td>
                <td className="px-5 py-3 text-muted">{fmt(u.lastLoginAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 flex items-center gap-1.5 text-[12px] text-muted"><ShieldCheck className="h-3.5 w-3.5" /> Roles: <b>owner</b> full control · <b>admin</b> manage users · <b>editor</b> edit agents/KB/integrations · <b>viewer</b> read-only.</p>
    </div>
  );
}
