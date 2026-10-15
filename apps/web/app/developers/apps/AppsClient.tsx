"use client";

import { forwardRef, useEffect, useRef, useState } from "react";
import { Check, Copy, KeyRound, Pencil, Plus, RefreshCw, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Input, Label } from "@/components/ui/field";
import { CodeBlock } from "@/components/developers/CodeBlock";
import { cn } from "@/lib/utils";

/** An application as the API returns it: never a hash, never a secret after creation. */
export interface DevApp {
  id: string;
  name: string;
  clientId: string;
  apiKeyHint: string;
  agentSlugs: string[];
  scopes: string[];
  createdAt: string;
  rotatedAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

/** Credentials in the clear: the one response that carries them. */
interface Issued {
  heading: string;
  app: DevApp;
  clientSecret: string;
  apiKey: string;
}

type Pending = { id: string; kind: "rotate" | "revoke" };
type Note = { tone: "ok" | "error"; text: string };

const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });
const when = (iso: string | null) => (iso ? fmt.format(new Date(iso)) : null);

/** "2 min ago" for the glance; the absolute time sits in the title. */
function relative(iso: string, now: number): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return "yesterday";
  if (d < 30) return `${d} days ago`;
  return fmt.format(new Date(iso));
}

async function api<T>(url: string, init: RequestInit = {}): Promise<{ ok: true; status: number; body: T } | { ok: false; status: number; error: string }> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 401) {
    window.location.assign(`/developers/login?next=${encodeURIComponent(window.location.pathname)}`);
    return { ok: false, status: 401, error: "unauthenticated" };
  }
  if (!res.ok) return { ok: false, status: res.status, error: typeof body.error === "string" ? body.error : `http_${res.status}` };
  return { ok: true, status: res.status, body: body as T };
}

export function AppsClient({ initial }: { initial: DevApp[] }) {
  const [apps, setApps] = useState<DevApp[]>(initial);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const [live, setLive] = useState("");
  const [now, setNow] = useState<number | null>(null);
  const issuedRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (issued) issuedRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [issued]);

  const announce = (text: string) => {
    setLive("");
    setTimeout(() => setLive(text), 10);
  };
  const replace = (app: DevApp) => setApps((list) => list.map((a) => (a.id === app.id ? app : a)));

  async function refresh() {
    const r = await api<{ apps: DevApp[] }>("/api/developers/apps");
    if (r.ok) setApps(r.body.apps);
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setBusy("create");
    setNote(null);
    const r = await api<{ app: DevApp; clientSecret: string; apiKey: string }>("/api/developers/apps", { method: "POST", body: JSON.stringify({ name }) });
    setBusy(null);
    if (!r.ok) {
      setNote({ tone: "error", text: r.error === "bad_request" ? "Give the application a name of up to 80 characters." : `The application could not be created (${r.error}).` });
      return;
    }
    setApps((list) => [r.body.app, ...list]);
    setIssued({ heading: `Credentials for ${r.body.app.name}`, app: r.body.app, clientSecret: r.body.clientSecret, apiKey: r.body.apiKey });
    setCreating(false);
    setNewName("");
    announce(`Application ${r.body.app.name} created. Save its credentials now; they are shown once.`);
  }

  async function rename(id: string) {
    if (!editing) return;
    const name = editing.name.trim();
    const current = apps.find((a) => a.id === id);
    if (!name || !current || name === current.name) {
      setEditing(null);
      return;
    }
    setBusy(`rename:${id}`);
    const r = await api<{ app: DevApp }>(`/api/developers/apps/${id}`, { method: "PATCH", body: JSON.stringify({ name }) });
    setBusy(null);
    if (!r.ok) {
      setNote({ tone: "error", text: `The application could not be renamed (${r.error}).` });
      return;
    }
    replace(r.body.app);
    setEditing(null);
    announce(`Renamed to ${r.body.app.name}.`);
  }

  async function rotate(app: DevApp) {
    setBusy(`rotate:${app.id}`);
    setNote(null);
    const r = await api<{ app: DevApp; clientSecret: string; apiKey: string }>(`/api/developers/apps/${app.id}/rotate`, { method: "POST" });
    setBusy(null);
    setPending(null);
    if (!r.ok) {
      setNote({ tone: "error", text: r.status === 404 ? "This application is revoked or no longer exists." : `The credentials could not be rotated (${r.error}).` });
      void refresh();
      return;
    }
    replace(r.body.app);
    setIssued({ heading: `New credentials for ${r.body.app.name}`, app: r.body.app, clientSecret: r.body.clientSecret, apiKey: r.body.apiKey });
    announce(`Credentials rotated for ${r.body.app.name}. The old ones have stopped working. Save the new ones now.`);
  }

  async function revoke(app: DevApp) {
    setBusy(`revoke:${app.id}`);
    setNote(null);
    const r = await api<{ app: DevApp }>(`/api/developers/apps/${app.id}`, { method: "DELETE" });
    setBusy(null);
    setPending(null);
    if (!r.ok) {
      setNote({ tone: "error", text: `The application could not be revoked (${r.error}).` });
      void refresh();
      return;
    }
    replace(r.body.app);
    if (issued?.app.id === app.id) setIssued(null);
    setNote({ tone: "ok", text: `${r.body.app.name} is revoked. Its client and API key no longer work.` });
    announce(`${r.body.app.name} revoked.`);
  }

  const active = apps.filter((a) => !a.revokedAt);
  const revoked = apps.filter((a) => a.revokedAt);

  return (
    <div>
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {live}
      </span>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[24px] font-semibold text-ink">Applications</h1>
          <p className="mt-1 max-w-[62ch] text-[14px] text-muted">
            Each application is an OAuth client and an API key for the sandbox agent. The secret and the key are shown once, when created or rotated.
          </p>
        </div>
        <Button onClick={() => setCreating((v) => !v)} aria-expanded={creating} aria-controls="new-app" className="shrink-0">
          <Plus size={16} strokeWidth={2.2} />
          New application
        </Button>
      </div>

      {creating ? (
        <form id="new-app" onSubmit={create} className="mt-5 rounded-xl border border-[var(--color-line)] bg-surface p-4  sm:p-5">
          <div className="flex flex-col gap-1.5 sm:max-w-[420px]">
            <Label htmlFor="new-app-name">Application name</Label>
            <Input
              id="new-app-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              autoFocus
              maxLength={80}
              placeholder="e.g. PMO citizen agent, staging"
              aria-describedby="new-app-hint"
            />
            <span id="new-app-hint" className="text-xs text-muted">
              A name for your own records; it does not appear to citizens. The application may call every sandbox agent with scope <span className="mono">tasks</span>.
            </span>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <Button type="submit" size="sm" disabled={busy === "create" || !newName.trim()}>
              {busy === "create" ? "Creating…" : "Create application"}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => { setCreating(false); setNewName(""); }}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      <div aria-live="polite" aria-atomic="true">
        {note ? (
          <div
            role={note.tone === "error" ? "alert" : "status"}
            className={cn(
              "mt-5 flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-[13.5px] ",
              note.tone === "error" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-[var(--color-line)] bg-surface text-ink-2"
            )}
          >
            <span>{note.text}</span>
            <button type="button" onClick={() => setNote(null)} className="shrink-0 text-[12.5px] font-medium text-muted hover:text-ink">
              Dismiss
            </button>
          </div>
        ) : null}
      </div>

      {issued ? (
        <IssuedPanel ref={issuedRef} issued={issued} onCopied={announce} onDone={() => setIssued(null)} />
      ) : null}

      {apps.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-[var(--color-line)] bg-surface px-5 py-8 ">
          <KeyRound size={20} strokeWidth={2} className="text-brand" />
          <h2 className="mt-3 text-[16px] font-semibold text-ink">No applications yet</h2>
          <p className="mt-1 max-w-[56ch] text-[13.5px] leading-relaxed text-ink-2">
            Create one to get a client ID, a client secret and an API key for the sandbox agent. Then exchange the client credentials for a token
            and send your first task.
          </p>
          {!creating ? (
            <Button className="mt-4" size="sm" onClick={() => setCreating(true)}>
              <Plus size={15} strokeWidth={2.2} />
              New application
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          <ul className="mt-6 flex flex-col gap-3" aria-label="Active applications">
            {active.map((app) => (
              <AppCard
                key={app.id}
                app={app}
                now={now}
                busy={busy}
                pending={pending?.id === app.id ? pending.kind : null}
                editing={editing?.id === app.id ? editing.name : null}
                onEdit={(name) => setEditing(name === null ? null : { id: app.id, name })}
                onRename={() => rename(app.id)}
                onAsk={(kind) => { setPending(kind ? { id: app.id, kind } : null); setNote(null); }}
                onRotate={() => rotate(app)}
                onRevoke={() => revoke(app)}
                onCopied={announce}
              />
            ))}
          </ul>
          {revoked.length ? (
            <section className="mt-8" aria-labelledby="revoked-heading">
              <h2 id="revoked-heading" className="text-[14px] font-semibold text-ink">
                Revoked
              </h2>
              <ul className="mt-3 flex flex-col gap-3" aria-label="Revoked applications">
                {revoked.map((app) => (
                  <AppCard
                    key={app.id}
                    app={app}
                    now={now}
                    busy={busy}
                    pending={null}
                    editing={editing?.id === app.id ? editing.name : null}
                    onEdit={(name) => setEditing(name === null ? null : { id: app.id, name })}
                    onRename={() => rename(app.id)}
                    onAsk={() => {}}
                    onRotate={() => {}}
                    onRevoke={() => {}}
                    onCopied={announce}
                  />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

// ─── One application ─────────────────────────────────────────────────────────

function AppCard(props: {
  app: DevApp;
  now: number | null;
  busy: string | null;
  pending: "rotate" | "revoke" | null;
  editing: string | null;
  onEdit: (name: string | null) => void;
  onRename: () => void;
  onAsk: (kind: "rotate" | "revoke" | null) => void;
  onRotate: () => void;
  onRevoke: () => void;
  onCopied: (text: string) => void;
}) {
  const { app, now, busy, pending, editing } = props;
  const revoked = Boolean(app.revokedAt);
  const renaming = busy === `rename:${app.id}`;

  return (
    <li className={cn("rounded-xl border border-[var(--color-line)] bg-surface ", revoked && "opacity-75")}>
      <div className="flex flex-col gap-3 px-5 pt-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          {editing !== null ? (
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                props.onRename();
              }}
            >
              <Label htmlFor={`rename-${app.id}`} className="sr-only">
                New name
              </Label>
              <Input
                id={`rename-${app.id}`}
                value={editing}
                onChange={(e) => props.onEdit(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") props.onEdit(null);
                }}
                autoFocus
                maxLength={80}
                className="h-9 w-full max-w-[320px] text-[14px] font-semibold"
              />
              <Button type="submit" size="sm" disabled={renaming || !editing.trim()}>
                {renaming ? "Saving…" : "Save"}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => props.onEdit(null)}>
                Cancel
              </Button>
            </form>
          ) : (
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <h3 className="truncate text-[16px] font-semibold text-ink">{app.name}</h3>
              <button
                type="button"
                onClick={() => props.onEdit(app.name)}
                aria-label={`Rename ${app.name}`}
                title="Rename"
                className="grid h-7 w-7 place-items-center rounded-md text-muted outline-none transition-colors hover:bg-[var(--color-line-soft)] hover:text-ink focus-visible:ring-4 focus-visible:ring-[var(--color-ring)]"
              >
                <Pencil size={13} strokeWidth={2} />
              </button>
              {revoked ? (
                <Badge tone="muted" dot>Revoked</Badge>
              ) : (
                <Badge tone="live" dot>Active</Badge>
              )}
            </div>
          )}
          <p className="mt-1 text-[12.5px] text-muted">
            Created <Time iso={app.createdAt} now={null} />
            {app.rotatedAt ? (
              <>
                {" "}· Rotated <Time iso={app.rotatedAt} now={null} />
              </>
            ) : null}
            {app.revokedAt ? (
              <>
                {" "}· Revoked <Time iso={app.revokedAt} now={null} />
              </>
            ) : null}
            {" "}· Last used {app.lastUsedAt ? <Time iso={app.lastUsedAt} now={now} /> : <span>never</span>}
          </p>
        </div>

        {!revoked ? (
          <div className="flex shrink-0 items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => props.onAsk(pending === "rotate" ? null : "rotate")} aria-expanded={pending === "rotate"} disabled={Boolean(busy)}>
              <RefreshCw size={14} strokeWidth={2} />
              Rotate credentials
            </Button>
            <Button size="sm" variant="outline" onClick={() => props.onAsk(pending === "revoke" ? null : "revoke")} aria-expanded={pending === "revoke"} disabled={Boolean(busy)} className="text-[#b42318] hover:bg-rose-50">
              <ShieldOff size={14} strokeWidth={2} />
              Revoke
            </Button>
          </div>
        ) : null}
      </div>

      <dl className="mt-4 grid gap-x-8 gap-y-3 border-t border-[var(--color-line-soft)] px-5 py-4 text-[13.5px] sm:grid-cols-2 lg:grid-cols-4">
        <div className="min-w-0">
          <dt className="text-[12px] font-medium text-muted">Client ID</dt>
          <dd className="mt-1 flex items-center gap-1">
            <code className="mono truncate text-[12.5px] text-ink">{app.clientId}</code>
            <CopyButton value={app.clientId} label="client ID" onCopied={props.onCopied} />
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[12px] font-medium text-muted">API key</dt>
          <dd className="mono mt-1 truncate text-[12.5px] text-ink" title="Only the last four characters are kept. Rotate to get a new key.">
            dlgk_sandbox_…{app.apiKeyHint}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[12px] font-medium text-muted">Agents</dt>
          <dd className="mt-1 flex flex-wrap gap-1.5">
            {app.agentSlugs.length ? (
              app.agentSlugs.map((slug) => (
                <Badge key={slug} tone="brand" className="mono normal-case">
                  {slug}
                </Badge>
              ))
            ) : (
              <span className="text-muted">none</span>
            )}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[12px] font-medium text-muted">Scopes</dt>
          <dd className="mt-1 flex flex-wrap gap-1.5">
            {app.scopes.length ? (
              app.scopes.map((s) => (
                <Badge key={s} tone="muted" className="mono normal-case">
                  {s}
                </Badge>
              ))
            ) : (
              <span className="text-muted">none</span>
            )}
          </dd>
        </div>
      </dl>

      {pending === "rotate" ? (
        <ConfirmPanel
          label="Confirm rotation"
          text={`Rotate the credentials of ${app.name}? A new client secret and a new API key are issued and shown once. The current ones, and every access token issued with them, stop working immediately. The client ID stays the same.`}
          confirmLabel={busy === `rotate:${app.id}` ? "Rotating…" : "Rotate credentials"}
          busy={Boolean(busy)}
          onConfirm={props.onRotate}
          onCancel={() => props.onAsk(null)}
        />
      ) : null}
      {pending === "revoke" ? (
        <ConfirmPanel
          label="Confirm revocation"
          text={`Revoke ${app.name}? Its client and API key stop working immediately and cannot be restored. Tasks it created stay in your activity log.`}
          confirmLabel={busy === `revoke:${app.id}` ? "Revoking…" : "Revoke application"}
          destructive
          busy={Boolean(busy)}
          onConfirm={props.onRevoke}
          onCancel={() => props.onAsk(null)}
        />
      ) : null}
    </li>
  );
}

function ConfirmPanel({ label, text, confirmLabel, destructive, busy, onConfirm, onCancel }: { label: string; text: string; confirmLabel: string; destructive?: boolean; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-3 rounded-b-xl border-t border-[var(--color-line)] bg-[var(--color-canvas)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="max-w-[72ch] text-[13.5px] leading-relaxed text-ink-2">{text}</p>
      <div className="flex shrink-0 items-center gap-2">
        <Button size="sm" onClick={onConfirm} disabled={busy} className={destructive ? "bg-[#b42318] hover:bg-[#912018]" : undefined}>
          {confirmLabel}
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ─── Credentials, shown once ─────────────────────────────────────────────────

const IssuedPanel = forwardRef<HTMLElement, { issued: Issued; onCopied: (text: string) => void; onDone: () => void }>(function IssuedPanel({ issued, onCopied, onDone }, ref) {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://HOST";
  const curl = `curl -X POST ${origin}/a2a/oauth/token \\
  -u "${issued.app.clientId}:${issued.clientSecret}" \\
  -d grant_type=client_credentials \\
  -d scope=tasks`;
  return (
    <section
      ref={ref}
      aria-labelledby="issued-heading"
      className="mt-5 scroll-mt-20 rounded-xl border border-[var(--color-ring)] bg-[color-mix(in_srgb,var(--color-brand)_4%,white)] shadow-[var(--shadow-sm)]"
    >
      <div className="border-b border-[var(--color-ring)] px-5 py-4">
        <h2 id="issued-heading" className="text-[16px] font-semibold text-ink">
          Save these now
        </h2>
        <p className="mt-1 max-w-[72ch] text-[13.5px] leading-relaxed text-ink-2">
          {issued.heading}. The client secret and the API key are shown only once: they are not stored in a readable form and cannot be shown
          again. Put them in your secret manager before you leave this page. If they are lost, rotate the application.
        </p>
      </div>
      <dl className="flex flex-col gap-3 px-5 py-4">
        <Secret label="client_id" value={issued.app.clientId} onCopied={onCopied} />
        <Secret label="client_secret" value={issued.clientSecret} onCopied={onCopied} />
        <Secret label="api_key" value={issued.apiKey} onCopied={onCopied} />
      </dl>
      <div className="px-5 pb-4">
        <CodeBlock code={curl} title="Token exchange, with these values" lang="bash" />
      </div>
      <div className="flex items-center gap-3 border-t border-[var(--color-ring)] px-5 py-3.5">
        <Button size="sm" variant="outline" onClick={onDone}>
          <Check size={14} strokeWidth={2.2} />
          I have saved these
        </Button>
        <span className="text-[12.5px] text-muted">Closing this panel removes the secret and the key from the page.</span>
      </div>
    </section>
  );
});

function Secret({ label, value, onCopied }: { label: string; value: string; onCopied: (text: string) => void }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[120px_1fr] sm:items-center sm:gap-4">
      <dt className="mono text-[12.5px] font-medium text-ink-2">{label}</dt>
      <dd className="flex min-w-0 items-center gap-1.5 rounded-lg border border-[var(--color-line)] bg-surface py-1.5 pl-3 pr-1.5">
        <code className="mono min-w-0 flex-1 break-all text-[12.5px] leading-relaxed text-ink">{value}</code>
        <CopyButton value={value} label={label} onCopied={onCopied} />
      </dd>
    </div>
  );
}

// ─── Shared bits ─────────────────────────────────────────────────────────────

function CopyButton({ value, label, onCopied }: { value: string; label: string; onCopied?: (text: string) => void }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={done ? `${label} copied` : `Copy ${label}`}
      title={`Copy ${label}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          onCopied?.(`Copied ${label}.`);
          setTimeout(() => setDone(false), 1400);
        } catch {
          onCopied?.(`Could not copy ${label}; select it and copy by hand.`);
        }
      }}
      className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted outline-none transition-colors hover:bg-[var(--color-line-soft)] hover:text-ink focus-visible:ring-4 focus-visible:ring-[var(--color-ring)]"
    >
      {done ? <Check size={13} strokeWidth={2.4} className="text-[#067647]" /> : <Copy size={13} strokeWidth={2} />}
    </button>
  );
}

/** Relative when `now` is known (after mount), absolute otherwise; always absolute in the title. */
function Time({ iso, now }: { iso: string; now: number | null }) {
  const abs = when(iso) ?? "";
  return (
    <time dateTime={iso} title={abs} suppressHydrationWarning>
      {now === null ? abs : relative(iso, now)}
    </time>
  );
}
