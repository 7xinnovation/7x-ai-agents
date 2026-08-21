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
import { IntegrationsManager } from "./IntegrationsManager";

const TEMPLATE = {
  slug: "", tenantSlug: "", name: "",
  persona: "You are a calm, professional, accurate assistant. Guide users step by step and route to a human when needed.",
  locales: ["en"], allowedOrigins: [] as string[],
  greeting: { en: "Hi, how can I help you today?", ar: "" }, model: "", activeEnvironment: "production",
  theme: { brandName: "", logoUrl: "", colors: { primary: "#1330F0", primaryForeground: "#FFFFFF", surface: "#FFFFFF", surfaceMuted: "#F4F6FB", text: "#0B1020", textMuted: "#5B6478", border: "#E2E6F0", success: "#0F9D58", warning: "#E8A100", danger: "#D23F31" }, radius: "soft", fontFamily: "Inter, system-ui, sans-serif", launcher: { position: "bottom-right", label: "" } },
  intents: [], journeys: [], guardrails: { confidenceThreshold: 0.6, refusalTopics: [], requireGroundedAnswers: true },
  integrations: { crm: { provider: "mock", settings: {}, secretRefs: [] }, auth: { provider: "mock", settings: {}, secretRefs: [] }, knowledge: { provider: "neon", settings: {}, secretRefs: [] }, storage: { provider: "mock", settings: {}, secretRefs: [] } },
};
type Def = typeof TEMPLATE & Record<string, unknown>;
const TABS = ["Identity", "Branding", "Knowledge", "Integrations", "Configuration", "Embed"] as const;
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
  const [copiedRelay, setCopiedRelay] = useState(false);
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

  /**
   * Cookie domain for the token relay, guessed from the allowed origins.
   *
   * Taken as the registrable domain shared by MOST of them: EPGL's list includes a
   * Salesforce sandbox host, and treating every entry equally would offer
   * ".site.com". The last two labels are the right answer for a .ae or .com domain
   * and the wrong one for a multi-part suffix like .co.uk, so this is shown as a
   * value to confirm rather than one to paste blind.
   */
  const relayDomain = useMemo(() => {
    const counts = new Map<string, number>();
    for (const o of def.allowedOrigins) {
      let host = "";
      try {
        host = new URL(o).hostname;
      } catch {
        continue;
      }
      if (!host.includes(".") || /^(localhost|127\.0\.0\.1|\[?::1)/.test(host)) continue;
      const labels = host.split(".");
      const registrable = labels.slice(-2).join(".");
      counts.set(registrable, (counts.get(registrable) ?? 0) + 1);
    }
    let best = "";
    let bestN = 0;
    for (const [d, n] of counts) if (n > bestN) { best = d; bestN = n; }
    return best ? `.${best}` : ".example.ae";
  }, [def.allowedOrigins]);

  const relaySnippet = useMemo(
    () => `<script src="${origin}/dialog-relay.js"\n        data-domain="${relayDomain}"></script>`,
    [origin, relayDomain]
  );

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
  const copyRelay = async () => { try { await navigator.clipboard.writeText(relaySnippet); setCopiedRelay(true); setTimeout(() => setCopiedRelay(false), 1600); } catch {} };

  if (loading) return <div className="grid h-64 place-items-center text-muted">Loading…</div>;
  const c = def.theme.colors;

  return (
    <>
      <header className="sticky top-0 z-10 -mx-4 -mt-6 mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-line)] bg-surface/85 px-4 py-4 backdrop-blur-xl sm:-mx-6 sm:px-6 lg:-mx-10 lg:-mt-8 lg:px-10">
        <div className="min-w-0">
          <h1 className="truncate text-[20px] font-extrabold tracking-tight">{isNew ? "New agent" : def.name || slug}</h1>
          <p className="mt-0.5 flex items-center gap-1 text-[13px] text-muted"><Link href="/admin/agents" className="font-semibold text-[var(--color-brand)]">Agents</Link><ChevronRight className="h-3.5 w-3.5" />{isNew ? "new" : def.slug}</p>
        </div>
        <div className="flex items-center gap-2.5">
          {!isNew && <a href={`/embed/${def.slug}`} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-xl border border-[var(--color-line)] bg-surface px-4 text-sm font-semibold hover:bg-bg"><ExternalLink className="h-4 w-4" /> Open</a>}
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save agent"}</Button>
        </div>
      </header>

      {msg && <div className={cn("mb-5 rounded-xl px-4 py-3 text-[13.5px]", msg.k === "ok" ? "border border-emerald-200 bg-emerald-50 text-emerald-700" : "border border-rose-200 bg-rose-50 text-rose-700")}>{msg.t}</div>}

      <div className="mb-6 inline-flex gap-1 rounded-xl border border-[var(--color-line)] bg-[var(--color-canvas)] p-1">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cn("rounded-lg px-3.5 py-1.5 text-[13.5px] font-semibold transition-all", tab === t ? "bg-surface text-ink shadow-[var(--shadow-xs)]" : "text-muted hover:text-ink")}>{t}</button>
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
            <Field label="Model override (optional)"><Input value={def.model} onChange={(e) => patch({ model: e.target.value })} placeholder="claude-sonnet-4-6" /></Field>
            <Field label="Allowed origins (comma-separated)" hint="Restricts which sites may embed this agent."><Input value={def.allowedOrigins.join(", ")} onChange={(e) => patch({ allowedOrigins: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} placeholder="https://example.com" /></Field>
          </div>
          <Field label="Active integration environment" hint="Which Swagger environment the chat calls — staging or production.">
            <Select value={def.activeEnvironment} onChange={(e) => patch({ activeEnvironment: e.target.value })}>
              <option value="production">Production</option>
              <option value="staging">Staging</option>
            </Select>
          </Field>
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

      {tab === "Integrations" && (isNew ? <Card><CardContent className="pt-5 text-sm text-muted">Save the agent first, then connect API integrations here.</CardContent></Card> : <IntegrationsManager slug={def.slug} />)}

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
          {/*
            * Signed-in handoff, as two cases rather than prose.
            *
            * Same origin: the assistant tag is already the listener -- it reads
            * localStorage, follows `storage` and polls, so there is nothing to add.
            * Different subdomain: localStorage cannot cross an origin, so the relay
            * mirrors the token into a domain-scoped cookie and the tag reads that.
            *
            * The relay snippet is shown here, copyable, because the host team is the
            * audience and "ask 7X for a file" is where an integration stalls.
            */}
          <div className="mt-4 rounded-xl border border-[var(--color-line)] bg-bg p-4">
            <p className="text-[12.5px] font-semibold">Signed-in customers</p>
            <p className="mt-1.5 text-[12.5px] text-muted">
              The tag above is already the token listener. Where the customer signs in on the{" "}
              <strong>same origin</strong> that shows the assistant, it reads the session token from{" "}
              <code className="rounded bg-surface px-1 py-0.5 font-mono">localStorage</code> (key{" "}
              <code className="rounded bg-surface px-1 py-0.5 font-mono">accessToken</code>), follows later
              sign-ins, and hands it over &mdash; nothing else to install.
            </p>
            <p className="mt-2.5 text-[12.5px] text-muted">
              Signing in on a <strong>different subdomain</strong> (say the assistant on{" "}
              <code className="rounded bg-surface px-1 py-0.5 font-mono">www</code>, the portal on{" "}
              <code className="rounded bg-surface px-1 py-0.5 font-mono">box</code>)? Storage never crosses an
              origin, so add this second tag <strong>on the sign-in page</strong>. It copies the token into a
              cookie scoped to the whole domain, which the tag above then reads.
            </p>
            <div className="mt-2.5 flex items-center justify-between gap-2">
              <span className="text-[12.5px] font-semibold">Relay snippet &mdash; sign-in page only</span>
              <Button variant="outline" size="sm" onClick={copyRelay}>
                {copiedRelay ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copiedRelay ? "Copied" : "Copy"}
              </Button>
            </div>
            <pre className="mt-1.5 overflow-x-auto rounded-xl bg-[#0b1020] p-4 font-mono text-[12.5px] leading-relaxed text-slate-100">{relaySnippet}</pre>
            <ul className="mt-2.5 list-disc space-y-1 pl-5 text-[12.5px] text-muted">
              <li>
                Confirm <code className="rounded bg-surface px-1 py-0.5 font-mono">data-domain</code> is the
                domain both subdomains sit under &mdash; it is guessed from the allowed origins above. The
                relay refuses to install without it rather than guess for itself.
              </li>
              <li>
                Token under a different key? Add{" "}
                <code className="rounded bg-surface px-1 py-0.5 font-mono">data-token-key=&quot;yourKey&quot;</code>{" "}
                to <em>both</em> tags.
              </li>
              <li>
                Not in <code className="rounded bg-surface px-1 py-0.5 font-mono">localStorage</code> at all
                (a cookie-session portal)? Skip the relay and push it from their page:{" "}
                <code className="rounded bg-surface px-1 py-0.5 font-mono">window.Dialog.setUaePassToken(token)</code>.
              </li>
              <li>
                The cookie is readable by script on every subdomain of{" "}
                <code className="rounded bg-surface px-1 py-0.5 font-mono">{relayDomain}</code>. If that is
                not acceptable, ask 7X for the bridge-page alternative, which keeps the token on its own
                origin.
              </li>
            </ul>
            <p className="mt-2.5 text-[12.5px] text-muted">
              Either way the tag must be on the host page: a plain{" "}
              <code className="rounded bg-surface px-1 py-0.5 font-mono">&lt;iframe&gt;</code> in place of it
              renders the assistant but can never authenticate it.
            </p>
          </div>
          <div className="mt-4 flex flex-wrap gap-2.5">
            <a href={`/embed/${def.slug}`} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-xl border border-[var(--color-line)] bg-surface px-4 text-sm font-semibold hover:bg-bg"><ExternalLink className="h-4 w-4" /> Full-page experience</a>
            <a href={`/demo?agent=${def.slug}`} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-xl border border-[var(--color-line)] bg-surface px-4 text-sm font-semibold hover:bg-bg"><ExternalLink className="h-4 w-4" /> Host page demo</a>
          </div>
        </CardContent></Card>
      )}
    </>
  );
}
