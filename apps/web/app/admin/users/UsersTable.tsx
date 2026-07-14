"use client";

import { useState } from "react";
import { UserPlus, ShieldCheck } from "lucide-react";
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
}

const ROLES = ["owner", "admin", "editor", "viewer"] as const;
const roleTone: Record<string, "brand" | "live" | "muted" | "draft"> = { owner: "brand", admin: "live", editor: "muted", viewer: "draft" };

export function UsersTable({ initial }: { initial: UserRow[] }) {
  const [rows, setRows] = useState(initial);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ email: "", name: "", password: "", role: "viewer" as UserRow["role"] });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function refresh() {
    const r = await fetch("/api/admin/users");
    if (r.ok) setRows((await r.json()).users);
  }
  async function patch(id: string, body: Record<string, unknown>) {
    await fetch("/api/admin/users", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...body }) });
    await refresh();
  }
  async function create() {
    setBusy(true); setErr("");
    const r = await fetch("/api/admin/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    setBusy(false);
    if (!r.ok) { setErr((await r.json()).error?.toString?.() ?? "Failed"); return; }
    setOpen(false); setForm({ email: "", name: "", password: "", role: "viewer" });
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
            <input className="h-10 rounded-lg border border-[var(--color-line)] px-3 text-sm outline-none focus:border-[var(--color-brand)]" type="password" placeholder="Temp password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <select className="h-10 rounded-lg border border-[var(--color-line)] px-3 text-sm outline-none focus:border-[var(--color-brand)]" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as UserRow["role"] })}>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          {err && <p className="mt-2 text-[12.5px] text-[#d92d20]">{err}</p>}
          <div className="mt-3 flex justify-end gap-2">
            <button onClick={() => setOpen(false)} className="h-9 rounded-lg border border-[var(--color-line)] px-3 text-[13px] font-medium hover:bg-[var(--color-line-soft)]">Cancel</button>
            <button disabled={busy || !form.email || !form.name || form.password.length < 6} onClick={create} className="h-9 rounded-lg bg-brand px-3.5 text-[13px] font-semibold text-white disabled:opacity-50">{busy ? "Creating…" : "Create user"}</button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-[var(--color-line)] bg-surface shadow-[var(--shadow-xs)]">
        <table className="w-full min-w-[560px] text-left text-[13.5px]">
          <thead className="border-b border-[var(--color-line)] text-[12px] uppercase tracking-wide text-muted">
            <tr>
              <th className="px-5 py-3 font-semibold">User</th>
              <th className="px-5 py-3 font-semibold">Role</th>
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
                <td className="px-5 py-3"><Badge tone={u.provider === "entra" ? "brand" : "muted"}>{u.provider === "entra" ? "Microsoft SSO" : "Password"}</Badge></td>
                <td className="px-5 py-3">
                  <button onClick={() => patch(u.id, { active: !u.active })} className="inline-flex items-center gap-1.5">
                    <Badge tone={u.active ? "live" : "draft"} dot>{u.active ? "Active" : "Disabled"}</Badge>
                  </button>
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
