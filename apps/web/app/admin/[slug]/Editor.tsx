"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Copy, Check, ExternalLink, Sparkles, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Textarea, Select, Label } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { KbManager } from "./KbManager";

const TEMPLATE = {
  slug: "", tenantSlug: "", name: "",
  persona: "You are a calm, professional, accurate assistant. Guide users step by step and route to a human when needed.",
  locales: ["en"], allowedOrigins: [] as string[],
  greeting: { en: "Hi, how can I help you today?", ar: "" }, model: "",
  theme: { brandName: "", logoUrl: "", colors: { primary: "#1330F0", primaryForeground: "#FFFFFF", surface: "#FFFFFF", surfaceMuted: "#F4F6FB", text: "#0B1020", textMuted: "#5B6478", border: "#E2E6F0", success: "#0F9D58", warning: "#E8A100", danger: "#D23F31" }, radius: "soft", fontFamily: "Inter, system-ui, sans-serif", launcher: { position: "bottom-right", label: "" } },
  intents: [], journeys: [], guardrails: { confidenceThreshold: 0.6, refusalTopics: [], requireGroundedAnswers: true },
  integrations: { crm: { provider: "mock", settings: {}, secretRefs: [] }, auth: { provider: "mock", settings: {}, secretRefs: [] }, knowledge: { provider: "neon", settings: {}, secretRefs: [] }, storage: { provider: "mock", settings: {}, secretRefs: [] } },
};
type Def = typeof TEMPLATE & Record<string, unknown>;
const TABS = ["Identity", "Branding", "Knowledge", "Configuration", "Embed"] as const;
type Tab = (typeof TABS)[number];

export function Editor({ slug }: { slug: string }) {
  const router = useRouter();
  const isNew = slug === "new";
  const [tab, setTab] = useState<Tab>("Identity");
  const [def, setDef] = useState<Def>(TEMPLATE);
  const [status, setStatus] = useState<"draft" | "live" | "disabled">("draft");
  const [tenantName, setTenantName] = useState("");
  const [nested, setNested] = useState("");
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [msg, setMsg] = useState<{ k: "ok" | "err"; t: string } | null>(null);
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  const syncNested = (d: Def) => setNested(JSON.stringify({ intents: d.intents, journeys: d.journeys, guardrails: d.guardrails, integrations: d.integrations }, null, 2));

  useEffect(() => {
    if (isNew) { syncNested(TEMPLATE); return; }
    (async () => {
      const res = await fetch(`/api/admin/agents/${slug}`);
      if (!res.ok) { setMsg({ k: "err", t: "Agent not found." }); setLoading(false); return; }
      const row = await res.json();
      const d = { ...TEMPLATE, ...row.definition } as Def;
      setDef(d); syncNested(d); setStatus(row.status); setTenantName(row.tenantName ?? ""); setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const patch = (p: Partial<Def>) => setDef((x) => ({ ...x, ...p }));
  const patchTheme = (p: Record<string, unknown>) => setDef((x) => ({ ...x, theme: { ...x.theme, ...p } }));
  const patchColor = (k: string, v: string) => setDef((x) => ({ ...x, theme: { ...x.theme, colors: { ...x.theme.colors, [k]: v } } }));
  const toggleLocale = (l: string) => patch({ locales: def.locales.includes(l) ? def.locales.filter((x) => x !== l) : [...def.locales, l] });

  const snippet = useMemo(() => `<script src="${origin}/dialog.js"\n        data-agent="${def.slug || "agent-slug"}"\n        data-host="${origin}"\n        data-locale="${def.locales[0] ?? "en"}"></script>`, [origin, def.slug, def.locales]);

  const save = useCallback(async () => {
    setMsg(null);
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(nested); } catch (e) { setTab("Configuration"); setMsg({ k: "err", t: `Invalid JSON: ${(e as Error).message}` }); return; }
    const definition = { ...def, model: def.model || undefined, ...parsed };
    setSaving(true);
    try {
      const res = await fetch("/api/admin/agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ definition, status, tenantName: tenantName || def.name }) });
      const j = await res.json();
      if (!res.ok) setMsg({ k: "err", t: `Validation failed: ${JSON.stringify(j.error?.fieldErrors ?? j.error)}` });
      else { setMsg({ k: "ok", t: "Saved." }); if (isNew) router.push(`/admin/${j.slug}`); }
    } catch (e) { setMsg({ k: "err", t: (e as Error).message }); } finally { setSaving(false); }
  }, [def, nested, status, tenantName, isNew, router]);

  const copy = async () => { try { await navigator.clipboard.writeText(snippet); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch {} };

  if (loading) return <div className="grid h-64 place-items-center text-muted">Loading…</div>;
  const c = def.theme.colors;

  return (
    <>
      <header className="sticky top-0 z-10 -mx-8 -mt-8 mb-6 flex items-center justify-between gap-4 border-b border-[var(--color-line)] bg-bg/80 px-8 py-4 backdrop-blur-xl">
        <div>
          <h1 className="text-[20px] font-extrabold tracking-tight">{isNew ? "New agent" : def.name || slug}</h1>
          <p className="mt-0.5 flex items-center gap-1 text-[13px] text-muted"><Link href="/admin/agents" className="font-semibold text-[var(--color-brand)]">Agents</Link><ChevronRight className="h-3.5 w-3.5" />{isNew ? "new" : def.slug}</p>
        </div>
        <div className="flex items-center gap-2.5">
          {!isNew && <a href={`/embed/${def.slug}`} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-xl border border-[var(--color-line)] bg-surface px-4 text-sm font-semibold hover:bg-bg"><ExternalLink className="h-4 w-4" /> Open</a>}
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save agent"}</Button>
        </div>
      </header>

      {msg && <div className={cn("mb-5 rounded-xl px-4 py-3 text-[13.5px]", msg.k === "ok" ? "border border-emerald-200 bg-emerald-50 text-emerald-700" : "border border-rose-200 bg-rose-50 text-rose-700")}>{msg.t}</div>}

      <div className="mb-6 inline-flex gap-1 rounded-xl border border-[var(--color-line)] bg-surface p-1 shadow-sm">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cn("rounded-lg px-3.5 py-2 text-[13.5px] font-semibold transition-colors", tab === t ? "bg-[linear-gradient(140deg,var(--color-brand-2),var(--color-brand))] text-white shadow-[0_6px_16px_-6px_rgba(19,48,240,.5)]" : "text-muted hover:bg-bg hover:text-ink")}>{t}</button>
        ))}
      </div>

      {tab === "Identity" && (
        <Card><CardContent className="grid gap-5 pt-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Name"><Input value={def.name} onChange={(e) => patch({ name: e.target.value })} placeholder="EPGL Dialog" /></Field>
            <Field label="Status"><Select value={status} onChange={(e) => setStatus(e.target.value as any)}><option value="draft">draft</option><option value="live">live</option><option value="disabled">disabled</option></Select></Field>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Agent slug"><Input value={def.slug} onChange={(e) => patch({ slug: e.target.value })} placeholder="epgl-dialog" /></Field>
            <Field label="Tenant slug"><Input value={def.tenantSlug} onChange={(e) => patch({ tenantSlug: e.target.value })} placeholder="epgl" /></Field>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Tenant name"><Input value={tenantName} onChange={(e) => setTenantName(e.target.value)} placeholder="Company legal name" /></Field>
            <Field label="Languages">
              <div className="flex gap-2">{["en", "ar"].map((l) => <button key={l} type="button" onClick={() => toggleLocale(l)} className={cn("h-10 flex-1 rounded-xl border text-[13px] font-bold transition-colors", def.locales.includes(l) ? "border-[var(--color-brand)] bg-[color-mix(in_srgb,var(--color-brand)_8%,white)] text-[var(--color-brand)]" : "border-[var(--color-line)] bg-surface text-muted")}>{l.toUpperCase()}</button>)}</div>
            </Field>
          </div>
          <Field label="Persona (system instructions)"><Textarea rows={4} value={def.persona} onChange={(e) => patch({ persona: e.target.value })} /></Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Model override (optional)"><Input value={def.model} onChange={(e) => patch({ model: e.target.value })} placeholder="claude-opus-4-8" /></Field>
            <Field label="Allowed origins (comma-separated)" hint="Restricts which sites may embed this agent."><Input value={def.allowedOrigins.join(", ")} onChange={(e) => patch({ allowedOrigins: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} placeholder="https://example.com" /></Field>
          </div>
          <Field label="Greeting (English)"><Input value={def.greeting.en} onChange={(e) => patch({ greeting: { ...def.greeting, en: e.target.value } })} /></Field>
          {def.locales.includes("ar") && <Field label="Greeting (Arabic)"><Input dir="rtl" value={def.greeting.ar} onChange={(e) => patch({ greeting: { ...def.greeting, ar: e.target.value } })} /></Field>}
        </CardContent></Card>
      )}

      {tab === "Branding" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card><CardContent className="grid gap-5 pt-5">
            <Field label="Brand name"><Input value={def.theme.brandName} onChange={(e) => patchTheme({ brandName: e.target.value })} /></Field>
            <Field label="Logo URL (optional)"><Input value={def.theme.logoUrl} onChange={(e) => patchTheme({ logoUrl: e.target.value })} placeholder="https://…/logo.svg" /></Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Primary color"><div className="flex items-center gap-2"><input type="color" value={c.primary} onChange={(e) => patchColor("primary", e.target.value)} className="h-10 w-12 cursor-pointer rounded-lg border border-[var(--color-line)] p-1" /><Input value={c.primary} onChange={(e) => patchColor("primary", e.target.value)} /></div></Field>
              <Field label="Launcher label"><Input value={def.theme.launcher.label} onChange={(e) => patchTheme({ launcher: { ...def.theme.launcher, label: e.target.value } })} placeholder="Ask us" /></Field>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Corner radius"><Select value={def.theme.radius} onChange={(e) => patchTheme({ radius: e.target.value })}><option value="sharp">sharp</option><option value="soft">soft</option><option value="round">round</option></Select></Field>
              <Field label="Launcher position"><Select value={def.theme.launcher.position} onChange={(e) => patchTheme({ launcher: { ...def.theme.launcher, position: e.target.value } })}><option value="bottom-right">bottom-right</option><option value="bottom-left">bottom-left</option></Select></Field>
            </div>
          </CardContent></Card>
          <Card>
            <CardHeader><CardTitle>Live preview</CardTitle></CardHeader>
            <CardContent>
              <div className="relative overflow-hidden rounded-2xl border border-[var(--color-line)] bg-bg p-4">
                <div className="flex items-center gap-3 border-b border-[var(--color-line)] pb-3.5">
                  <span className="grid h-9 w-9 place-items-center rounded-xl text-white shadow-[inset_0_1px_0_rgba(255,255,255,.3)]" style={{ background: c.primary }}><Sparkles className="h-4 w-4" /></span>
                  <div><div className="text-sm font-bold">{def.theme.brandName || def.name || "Your brand"}</div><div className="flex items-center gap-1.5 text-xs text-muted"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Online</div></div>
                </div>
                <div className="mt-3.5 max-w-[88%] rounded-2xl rounded-tl-md border border-[var(--color-line)] bg-surface px-3.5 py-2.5 text-[13.5px] leading-relaxed shadow-sm">{def.greeting.en || "Greeting preview…"}</div>
                <div className="absolute bottom-4 right-4 grid h-12 w-12 place-items-center rounded-full text-white shadow-[0_12px_30px_-8px_rgba(0,0,0,.4)]" style={{ background: c.primary }}><Sparkles className="h-5 w-5" /></div>
                <div className="h-16" />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "Knowledge" && (isNew ? <Card><CardContent className="pt-5 text-sm text-muted">Save the agent first, then add knowledge-base documents here.</CardContent></Card> : <KbManager slug={def.slug} />)}

      {tab === "Configuration" && (
        <Card><CardHeader><CardTitle>Journeys · Intents · Guardrails · Integrations</CardTitle></CardHeader><CardContent>
          <p className="mb-3 text-[12.5px] text-muted">Advanced configuration as JSON. Validated against the agent schema on save.</p>
          <Textarea rows={22} value={nested} onChange={(e) => setNested(e.target.value)} spellCheck={false} className="font-mono text-[12.5px] leading-relaxed" />
        </CardContent></Card>
      )}

      {tab === "Embed" && (
        <Card><CardHeader><CardTitle>Install snippet</CardTitle><Button variant="outline" size="sm" onClick={copy}>{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? "Copied" : "Copy"}</Button></CardHeader><CardContent>
          <pre className="overflow-x-auto rounded-xl bg-[#0b1020] p-4 font-mono text-[12.5px] leading-relaxed text-slate-100">{snippet}</pre>
          <p className="mt-3 text-[12.5px] text-muted">Drop this on any approved site. The launcher adopts this agent&apos;s brand color automatically.{def.allowedOrigins.length ? ` Embedding is restricted to: ${def.allowedOrigins.join(", ")}.` : " Add Allowed origins (Identity tab) to restrict where it can be embedded."}</p>
          <div className="mt-4 flex flex-wrap gap-2.5">
            <a href={`/embed/${def.slug}`} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-xl border border-[var(--color-line)] bg-surface px-4 text-sm font-semibold hover:bg-bg"><ExternalLink className="h-4 w-4" /> Full-page experience</a>
            <a href="/demo" target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-xl border border-[var(--color-line)] bg-surface px-4 text-sm font-semibold hover:bg-bg"><ExternalLink className="h-4 w-4" /> Host page demo</a>
          </div>
        </CardContent></Card>
      )}
    </>
  );
}
