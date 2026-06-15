"use client";

import { useCallback, useEffect, useState } from "react";
import { Plug, Plus, Trash2, ChevronDown, Boxes } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Badge } from "@/components/ui/field";
import { cn } from "@/lib/utils";

interface Op { toolName: string; method: string; path: string; summary: string }
interface Integration { id: string; name: string; baseUrl: string; authType: string; hasAuth: boolean; enabled: boolean; operationCount: number; operations: Op[] }

const METHOD_COLOR: Record<string, string> = { GET: "text-emerald-600", POST: "text-blue-600", PUT: "text-amber-600", PATCH: "text-amber-600", DELETE: "text-rose-600" };

export function IntegrationsManager({ slug }: { slug: string }) {
  const [items, setItems] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [specUrl, setSpecUrl] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [name, setName] = useState("");
  const [authType, setAuthType] = useState<"none" | "bearer" | "apiKey">("none");
  const [authValue, setAuthValue] = useState("");
  const [authHeader, setAuthHeader] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ k: "ok" | "err"; t: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/agents/${slug}/integrations`);
    if (res.ok) setItems((await res.json()).integrations);
    setLoading(false);
  }, [slug]);
  useEffect(() => { void load(); }, [load]);

  const importSpec = async () => {
    if (!specUrl.trim()) return;
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(`/api/admin/agents/${slug}/integrations`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ specUrl, baseUrl: baseUrl || undefined, name: name || undefined, authType, authValue: authValue || undefined, authHeader: authHeader || undefined }),
      });
      const j = await res.json();
      if (res.ok) { setMsg({ k: "ok", t: `Imported "${j.name}" — ${j.operationCount} operations now available to the agent.` }); setSpecUrl(""); setBaseUrl(""); setName(""); setAuthValue(""); setAuthHeader(""); await load(); }
      else setMsg({ k: "err", t: typeof j.error === "string" ? j.error : "Import failed — check the spec URL." });
    } catch (e) { setMsg({ k: "err", t: (e as Error).message }); } finally { setBusy(false); }
  };
  const toggle = async (it: Integration) => { await fetch(`/api/admin/agents/${slug}/integrations`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: it.id, enabled: !it.enabled }) }); await load(); };
  const remove = async (id: string) => { await fetch(`/api/admin/agents/${slug}/integrations?id=${id}`, { method: "DELETE" }); await load(); };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
      <Card className="self-start">
        <CardHeader><CardTitle>Connect an API</CardTitle></CardHeader>
        <CardContent className="grid gap-4">
          <p className="-mt-1 flex items-center gap-1.5 text-[12.5px] text-muted"><Plug className="h-3.5 w-3.5 text-[var(--color-brand)]" /> Paste an OpenAPI/Swagger URL. Each operation becomes a tool the chat can call.</p>
          <Field label="OpenAPI / Swagger URL"><Input value={specUrl} onChange={(e) => setSpecUrl(e.target.value)} placeholder="https://petstore3.swagger.io/api/v3/openapi.json" /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Base URL (optional)" hint="Override the spec server."><Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.example.com" /></Field>
            <Field label="Display name (optional)"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Pet Store" /></Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Auth"><Select value={authType} onChange={(e) => setAuthType(e.target.value as any)}><option value="none">None</option><option value="bearer">Bearer token</option><option value="apiKey">API key header</option></Select></Field>
            {authType !== "none" && <Field label={authType === "bearer" ? "Token" : "API key value"}><Input type="password" value={authValue} onChange={(e) => setAuthValue(e.target.value)} placeholder="••••••" /></Field>}
          </div>
          {authType === "apiKey" && <Field label="Header name"><Input value={authHeader} onChange={(e) => setAuthHeader(e.target.value)} placeholder="X-API-Key" /></Field>}
          {msg && <div className={cn("rounded-xl px-3.5 py-2.5 text-[13px]", msg.k === "ok" ? "border border-emerald-200 bg-emerald-50 text-emerald-700" : "border border-rose-200 bg-rose-50 text-rose-700")}>{msg.t}</div>}
          <Button onClick={importSpec} disabled={busy || !specUrl.trim()}><Plus className="h-4 w-4" /> {busy ? "Importing…" : "Import & connect"}</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Connected integrations</CardTitle><span className="text-[13px] text-muted">{items.length}</span></CardHeader>
        <CardContent>
          {loading ? <p className="py-2 text-sm text-muted">Loading…</p> : items.length === 0 ? (
            <div className="flex flex-col items-center gap-2.5 py-9 text-center text-muted"><Boxes className="h-7 w-7" /><p className="max-w-[36ch] text-[13.5px]">No integrations yet. Connect an API so the agent can fetch and act on real data during conversations.</p></div>
          ) : items.map((it) => (
            <div key={it.id} className="border-t border-[var(--color-line)] py-3 first:border-t-0">
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[color-mix(in_srgb,var(--color-brand)_10%,white)] text-[var(--color-brand)]"><Plug className="h-4 w-4" /></span>
                <button className="min-w-0 flex-1 text-left" onClick={() => setOpen(open === it.id ? null : it.id)}>
                  <span className="flex items-center gap-2 text-sm font-bold">{it.name}<ChevronDown className={cn("h-3.5 w-3.5 text-muted transition-transform", open === it.id && "rotate-180")} /></span>
                  <span className="block truncate font-mono text-[12px] text-muted">{it.baseUrl} · {it.operationCount} ops{it.hasAuth ? " · auth" : ""}</span>
                </button>
                <button onClick={() => toggle(it)} title="Toggle enabled"><Badge tone={it.enabled ? "live" : "draft"} className="cursor-pointer">{it.enabled ? "enabled" : "disabled"}</Badge></button>
                <button onClick={() => remove(it.id)} aria-label="Delete" className="grid h-8 w-8 place-items-center rounded-lg border border-[var(--color-line)] text-muted hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
              </div>
              {open === it.id && (
                <div className="mt-2 ml-12 grid gap-1 rounded-xl border border-[var(--color-line)] bg-bg p-2.5">
                  {it.operations.map((o) => (
                    <div key={o.toolName} className="flex items-center gap-2 text-[12.5px]">
                      <span className={cn("w-12 shrink-0 font-mono font-bold", METHOD_COLOR[o.method] ?? "text-muted")}>{o.method}</span>
                      <span className="font-mono text-muted">{o.path}</span>
                      <span className="truncate text-muted">— {o.summary}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
