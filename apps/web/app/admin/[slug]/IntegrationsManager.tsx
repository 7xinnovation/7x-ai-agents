"use client";

import { useCallback, useEffect, useState } from "react";
import { Plug, Plus, Trash2, ChevronDown, Boxes } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Badge } from "@/components/ui/field";
import { cn } from "@/lib/utils";

interface Op { toolName: string; method: string; path: string; summary: string }
interface EnvDetail { specUrl: string; baseUrl: string; authType: string; hasAuth: boolean; operationCount: number; operations: Op[] }
interface Integration { id: string; name: string; enabled: boolean; environments: Partial<Record<"staging" | "production", EnvDetail>> }

const METHOD_COLOR: Record<string, string> = { GET: "text-emerald-600", POST: "text-blue-600", PUT: "text-amber-600", PATCH: "text-amber-600", DELETE: "text-rose-600" };

export function IntegrationsManager({ slug }: { slug: string }) {
  const [items, setItems] = useState<Integration[]>([]);
  const [activeEnv, setActiveEnv] = useState<"staging" | "production">("production");
  const [loading, setLoading] = useState(true);
  const [environment, setEnvironment] = useState<"staging" | "production">("production");
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
    if (res.ok) { const j = await res.json(); setItems(j.integrations); setActiveEnv(j.activeEnvironment); }
    setLoading(false);
  }, [slug]);
  useEffect(() => { void load(); }, [load]);

  const importSpec = async () => {
    if (!specUrl.trim() || !name.trim()) { setMsg({ k: "err", t: "Name and spec URL are required." }); return; }
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(`/api/admin/agents/${slug}/integrations`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, environment, specUrl, baseUrl: baseUrl || undefined, authType, authValue: authValue || undefined, authHeader: authHeader || undefined }),
      });
      const j = await res.json();
      if (res.ok) { setMsg({ k: "ok", t: `Imported ${j.environment} spec for "${j.name}" — ${j.operationCount} operations.` }); setSpecUrl(""); setBaseUrl(""); setAuthValue(""); setAuthHeader(""); await load(); }
      else setMsg({ k: "err", t: typeof j.error === "string" ? j.error : "Import failed — check the spec URL." });
    } catch (e) { setMsg({ k: "err", t: (e as Error).message }); } finally { setBusy(false); }
  };
  const toggle = async (it: Integration) => { await fetch(`/api/admin/agents/${slug}/integrations`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: it.id, enabled: !it.enabled }) }); await load(); };
  const removeAll = async (id: string) => { await fetch(`/api/admin/agents/${slug}/integrations?id=${id}`, { method: "DELETE" }); await load(); };
  const removeEnv = async (id: string, env: string) => { await fetch(`/api/admin/agents/${slug}/integrations?id=${id}&env=${env}`, { method: "DELETE" }); await load(); };

  const envRow = (it: Integration, env: "staging" | "production") => {
    const d = it.environments[env];
    const isActive = activeEnv === env;
    return (
      <div className="flex items-center gap-2.5 rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] px-3 py-2">
        <Badge tone={env === "production" ? "brand" : "draft"}>{env === "production" ? "PROD" : "STG"}</Badge>
        {isActive && <Badge tone="live" dot>active</Badge>}
        {d ? (
          <>
            <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-muted">{d.baseUrl} · {d.operationCount} ops{d.hasAuth ? " · auth" : ""}</span>
            <button onClick={() => removeEnv(it.id, env)} aria-label={`Remove ${env}`} className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-white hover:text-rose-600"><Trash2 className="h-3.5 w-3.5" /></button>
          </>
        ) : (
          <span className="min-w-0 flex-1 text-[12.5px] text-muted">Not configured — import a {env} spec above.</span>
        )}
      </div>
    );
  };

  return (
    <div className="grid gap-5">
      <div className="flex items-center gap-2 rounded-lg border border-[var(--color-ring)] bg-[color-mix(in_srgb,var(--color-brand)_5%,white)] px-4 py-2.5 text-[13px]">
        <Plug className="h-4 w-4 text-[var(--color-brand)]" />
        <span className="text-ink-2">Active environment for this agent:</span>
        <Badge tone="brand">{activeEnv === "production" ? "Production" : "Staging"}</Badge>
        <span className="text-muted">— change it in the <span className="font-semibold text-ink-2">Identity</span> tab.</span>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_1.1fr]">
        <Card className="self-start">
          <CardHeader><CardTitle>Connect / update an API</CardTitle></CardHeader>
          <CardContent className="grid gap-4">
            <p className="-mt-1 text-[12.5px] text-muted">Import a Swagger/OpenAPI spec per environment. Same name + different environment adds STG and PROD to one integration.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Integration name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="PO Box" /></Field>
              <Field label="Environment"><Select value={environment} onChange={(e) => setEnvironment(e.target.value as any)}><option value="production">Production</option><option value="staging">Staging</option></Select></Field>
            </div>
            <Field label="OpenAPI / Swagger URL"><Input value={specUrl} onChange={(e) => setSpecUrl(e.target.value)} placeholder="https://box.emiratespost.ae/services/pobox/openapi.json" /></Field>
            <Field label="Base URL (optional)" hint="Override the spec server."><Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://box-stg.emiratespost.ae" /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Auth"><Select value={authType} onChange={(e) => setAuthType(e.target.value as any)}><option value="none">None</option><option value="bearer">Bearer token</option><option value="apiKey">API key header</option></Select></Field>
              {authType !== "none" && <Field label={authType === "bearer" ? "Token" : "API key value"}><Input type="password" value={authValue} onChange={(e) => setAuthValue(e.target.value)} placeholder="••••••" /></Field>}
            </div>
            {authType === "apiKey" && <Field label="Header name"><Input value={authHeader} onChange={(e) => setAuthHeader(e.target.value)} placeholder="X-API-Key" /></Field>}
            {msg && <div className={cn("rounded-lg px-3.5 py-2.5 text-[13px]", msg.k === "ok" ? "border border-emerald-200 bg-emerald-50 text-emerald-700" : "border border-rose-200 bg-rose-50 text-rose-700")}>{msg.t}</div>}
            <Button onClick={importSpec} disabled={busy || !specUrl.trim() || !name.trim()}><Plus className="h-4 w-4" /> {busy ? "Importing…" : "Import & connect"}</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Connected integrations</CardTitle><span className="text-[13px] text-muted">{items.length}</span></CardHeader>
          <CardContent>
            {loading ? <p className="py-2 text-sm text-muted">Loading…</p> : items.length === 0 ? (
              <div className="flex flex-col items-center gap-2.5 py-9 text-center text-muted"><Boxes className="h-7 w-7" /><p className="max-w-[36ch] text-[13.5px]">No integrations yet. Import a Swagger spec so the agent can call real APIs during conversations.</p></div>
            ) : items.map((it) => {
              const activeSpec = it.environments[activeEnv];
              return (
                <div key={it.id} className="border-t border-[var(--color-line-soft)] py-3 first:border-t-0">
                  <div className="flex items-center gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[color-mix(in_srgb,var(--color-brand)_16%,white)] bg-[color-mix(in_srgb,var(--color-brand)_7%,white)] text-[var(--color-brand)]"><Plug className="h-4 w-4" /></span>
                    <button className="min-w-0 flex-1 text-left" onClick={() => setOpen(open === it.id ? null : it.id)}>
                      <span className="flex items-center gap-2 text-sm font-semibold text-ink">{it.name}<ChevronDown className={cn("h-3.5 w-3.5 text-muted transition-transform", open === it.id && "rotate-180")} /></span>
                      <span className="block text-[12px] text-muted">{Object.keys(it.environments).length} environment(s){activeSpec ? ` · ${activeSpec.operationCount} ops active` : " · no active spec"}</span>
                    </button>
                    <button onClick={() => toggle(it)} title="Toggle enabled"><Badge tone={it.enabled ? "live" : "muted"} dot>{it.enabled ? "enabled" : "disabled"}</Badge></button>
                    <button onClick={() => removeAll(it.id)} aria-label="Delete" className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-[var(--color-line-soft)] hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
                  </div>
                  <div className="mt-2.5 ml-12 grid gap-1.5">
                    {envRow(it, "production")}
                    {envRow(it, "staging")}
                  </div>
                  {open === it.id && activeSpec && (
                    <div className="mt-2 ml-12 grid gap-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] p-2.5">
                      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{activeEnv} operations</div>
                      {activeSpec.operations.map((o) => (
                        <div key={o.toolName} className="flex items-center gap-2 text-[12.5px]">
                          <span className={cn("w-12 shrink-0 font-mono font-bold", METHOD_COLOR[o.method] ?? "text-muted")}>{o.method}</span>
                          <span className="font-mono text-muted">{o.path}</span>
                          <span className="truncate text-muted">— {o.summary}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
