"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Copy, Check, ArrowSquareOut, Sparkle } from "@phosphor-icons/react";
import { KbManager } from "./KbManager";

const TEMPLATE = {
  slug: "",
  tenantSlug: "",
  name: "",
  persona: "You are a calm, professional, accurate assistant. Guide users step by step and route to a human when needed.",
  locales: ["en"],
  allowedOrigins: [] as string[],
  greeting: { en: "Hi, how can I help you today?", ar: "" },
  model: "",
  theme: {
    brandName: "",
    logoUrl: "",
    colors: {
      primary: "#1330F0",
      primaryForeground: "#FFFFFF",
      surface: "#FFFFFF",
      surfaceMuted: "#F4F6FB",
      text: "#0B1020",
      textMuted: "#5B6478",
      border: "#E2E6F0",
      success: "#0F9D58",
      warning: "#E8A100",
      danger: "#D23F31",
    },
    radius: "soft",
    fontFamily: "Inter, system-ui, sans-serif",
    launcher: { position: "bottom-right", label: "" },
  },
  intents: [],
  journeys: [],
  guardrails: { confidenceThreshold: 0.6, refusalTopics: [], requireGroundedAnswers: true },
  integrations: {
    crm: { provider: "mock", settings: {}, secretRefs: [] },
    auth: { provider: "mock", settings: {}, secretRefs: [] },
    knowledge: { provider: "neon", settings: {}, secretRefs: [] },
    storage: { provider: "mock", settings: {}, secretRefs: [] },
  },
};

type Def = typeof TEMPLATE & Record<string, unknown>;
type Tab = "identity" | "branding" | "knowledge" | "config" | "embed";

export function Editor({ slug }: { slug: string }) {
  const router = useRouter();
  const isNew = slug === "new";
  const [tab, setTab] = useState<Tab>("identity");
  const [def, setDef] = useState<Def>(TEMPLATE);
  const [status, setStatus] = useState<"draft" | "live" | "disabled">("draft");
  const [tenantName, setTenantName] = useState("");
  const [nestedJson, setNestedJson] = useState("");
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  const setNested = (d: Def) =>
    setNestedJson(
      JSON.stringify(
        { intents: d.intents, journeys: d.journeys, guardrails: d.guardrails, integrations: d.integrations },
        null,
        2
      )
    );

  useEffect(() => {
    if (isNew) {
      setNested(TEMPLATE);
      return;
    }
    (async () => {
      const res = await fetch(`/api/admin/agents/${slug}`);
      if (!res.ok) {
        setMsg({ kind: "err", text: "Agent not found." });
        setLoading(false);
        return;
      }
      const row = await res.json();
      const d = { ...TEMPLATE, ...row.definition } as Def;
      setDef(d);
      setNested(d);
      setStatus(row.status);
      setTenantName(row.tenantName ?? "");
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const patch = (p: Partial<Def>) => setDef((prev) => ({ ...prev, ...p }));
  const patchTheme = (p: Record<string, unknown>) => setDef((prev) => ({ ...prev, theme: { ...prev.theme, ...p } }));
  const patchColor = (k: string, v: string) =>
    setDef((prev) => ({ ...prev, theme: { ...prev.theme, colors: { ...prev.theme.colors, [k]: v } } }));
  const toggleLocale = (l: string) =>
    patch({ locales: def.locales.includes(l) ? def.locales.filter((x) => x !== l) : [...def.locales, l] });

  const snippet = useMemo(
    () =>
      `<script src="${origin}/dialog.js"\n        data-agent="${def.slug || "agent-slug"}"\n        data-host="${origin}"\n        data-locale="${def.locales[0] ?? "en"}"></script>`,
    [origin, def.slug, def.locales]
  );

  const save = useCallback(async () => {
    setMsg(null);
    let nested: Record<string, unknown>;
    try {
      nested = JSON.parse(nestedJson);
    } catch (e) {
      setTab("config");
      setMsg({ kind: "err", text: `Invalid JSON in Configuration: ${(e as Error).message}` });
      return;
    }
    const definition = { ...def, model: def.model || undefined, ...nested };
    setSaving(true);
    try {
      const res = await fetch("/api/admin/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ definition, status, tenantName: tenantName || def.name }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMsg({ kind: "err", text: `Validation failed: ${JSON.stringify(json.error?.fieldErrors ?? json.error)}` });
      } else {
        setMsg({ kind: "ok", text: "Saved." });
        if (isNew) router.push(`/admin/${json.slug}`);
      }
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }, [def, nestedJson, status, tenantName, isNew, router]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  };

  if (loading) return <div className="sa-panel" style={{ marginTop: 12 }}>Loading…</div>;

  const c = def.theme.colors;

  return (
    <>
      <header className="sa-top">
        <div>
          <h1>{isNew ? "New agent" : def.name || slug}</h1>
          <p>
            <Link href="/admin/agents">Agents</Link> / {isNew ? "new" : def.slug}
          </p>
        </div>
        <div className="sa-top-actions">
          {!isNew ? (
            <a className="sa-btn" href={`/embed/${def.slug}`} target="_blank" rel="noreferrer">
              <ArrowSquareOut size={16} /> Open
            </a>
          ) : null}
          <button className="sa-btn primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save agent"}
          </button>
        </div>
      </header>

      {msg ? <div className={`sa-msg ${msg.kind}`}>{msg.text}</div> : null}

      <div className="sa-tabs">
        {(["identity", "branding", "knowledge", "config", "embed"] as Tab[]).map((t) => (
          <button key={t} className={`sa-tab ${tab === t ? "on" : ""}`} onClick={() => setTab(t)}>
            {t === "config" ? "Configuration" : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === "identity" ? (
        <div className="sa-panel sa-form">
          <div className="sa-2col">
            <label>
              Name
              <input value={def.name} onChange={(e) => patch({ name: e.target.value })} placeholder="EPGL Dialog" />
            </label>
            <label>
              Status
              <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
                <option value="draft">draft</option>
                <option value="live">live</option>
                <option value="disabled">disabled</option>
              </select>
            </label>
          </div>
          <div className="sa-2col">
            <label>
              Agent slug
              <input value={def.slug} onChange={(e) => patch({ slug: e.target.value })} placeholder="epgl-dialog" />
            </label>
            <label>
              Tenant slug
              <input value={def.tenantSlug} onChange={(e) => patch({ tenantSlug: e.target.value })} placeholder="epgl" />
            </label>
          </div>
          <div className="sa-2col">
            <label>
              Tenant name
              <input value={tenantName} onChange={(e) => setTenantName(e.target.value)} placeholder="Company legal name" />
            </label>
            <label>
              Languages
              <span className="sa-checks">
                {["en", "ar"].map((l) => (
                  <button key={l} type="button" className={`sa-pill ${def.locales.includes(l) ? "on" : ""}`} onClick={() => toggleLocale(l)}>
                    {l.toUpperCase()}
                  </button>
                ))}
              </span>
            </label>
          </div>
          <label>
            Persona (system instructions)
            <textarea rows={4} value={def.persona} onChange={(e) => patch({ persona: e.target.value })} />
          </label>
          <div className="sa-2col">
            <label>
              Model override (optional)
              <input value={def.model} onChange={(e) => patch({ model: e.target.value })} placeholder="claude-opus-4-8" />
            </label>
            <label>
              Allowed origins (comma-separated)
              <input
                value={def.allowedOrigins.join(", ")}
                onChange={(e) => patch({ allowedOrigins: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                placeholder="https://example.com"
              />
            </label>
          </div>
          <label>
            Greeting (English)
            <input value={def.greeting.en} onChange={(e) => patch({ greeting: { ...def.greeting, en: e.target.value } })} />
          </label>
          {def.locales.includes("ar") ? (
            <label>
              Greeting (Arabic)
              <input dir="rtl" value={def.greeting.ar} onChange={(e) => patch({ greeting: { ...def.greeting, ar: e.target.value } })} />
            </label>
          ) : null}
        </div>
      ) : null}

      {tab === "branding" ? (
        <div className="sa-cols">
          <div className="sa-panel sa-form">
            <label>
              Brand name
              <input value={def.theme.brandName} onChange={(e) => patchTheme({ brandName: e.target.value })} />
            </label>
            <label>
              Logo URL (optional)
              <input value={def.theme.logoUrl} onChange={(e) => patchTheme({ logoUrl: e.target.value })} placeholder="https://…/logo.svg" />
            </label>
            <div className="sa-2col">
              <label>
                Primary color
                <span className="sa-color">
                  <input type="color" value={c.primary} onChange={(e) => patchColor("primary", e.target.value)} />
                  <input value={c.primary} onChange={(e) => patchColor("primary", e.target.value)} />
                </span>
              </label>
              <label>
                Launcher label
                <input value={def.theme.launcher.label} onChange={(e) => patchTheme({ launcher: { ...def.theme.launcher, label: e.target.value } })} placeholder="Ask us" />
              </label>
            </div>
            <div className="sa-2col">
              <label>
                Corner radius
                <select value={def.theme.radius} onChange={(e) => patchTheme({ radius: e.target.value })}>
                  <option value="sharp">sharp</option>
                  <option value="soft">soft</option>
                  <option value="round">round</option>
                </select>
              </label>
              <label>
                Launcher position
                <select value={def.theme.launcher.position} onChange={(e) => patchTheme({ launcher: { ...def.theme.launcher, position: e.target.value } })}>
                  <option value="bottom-right">bottom-right</option>
                  <option value="bottom-left">bottom-left</option>
                </select>
              </label>
            </div>
          </div>

          <div className="sa-panel">
            <div className="sa-panel-head">
              <h2>Live preview</h2>
            </div>
            <div className="sa-preview" style={{ ["--p" as string]: c.primary }}>
              <div className="sa-preview-head">
                <span className="sa-chip-avatar" style={{ background: c.primary }}>
                  {(def.theme.brandName || def.name || "A").charAt(0)}
                </span>
                <div>
                  <div className="sa-preview-name">{def.theme.brandName || def.name || "Your brand"}</div>
                  <div className="sa-preview-status">
                    <span className="sa-dot ok" /> Online
                  </div>
                </div>
              </div>
              <div className="sa-preview-bubble">
                <Sparkle size={14} weight="fill" style={{ color: c.primary }} /> {def.greeting.en || "Greeting preview…"}
              </div>
              <div className="sa-preview-launcher" style={{ background: c.primary }}>
                <Sparkle size={20} weight="fill" />
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {tab === "knowledge" ? (
        isNew ? (
          <div className="sa-panel">
            <p className="sa-help">Save the agent first, then add knowledge-base documents here.</p>
          </div>
        ) : (
          <KbManager slug={def.slug} />
        )
      ) : null}

      {tab === "config" ? (
        <div className="sa-panel sa-form">
          <p className="sa-help">Journeys, intents, guardrails, and integration bindings as JSON. Validated against the agent schema on save.</p>
          <textarea className="sa-json" rows={22} value={nestedJson} onChange={(e) => setNestedJson(e.target.value)} spellCheck={false} />
        </div>
      ) : null}

      {tab === "embed" ? (
        <div className="sa-panel sa-form">
          <div className="sa-panel-head">
            <h2>Install snippet</h2>
            <button className="sa-btn" onClick={copy}>
              {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <pre className="sa-code">{snippet}</pre>
          <p className="sa-help">
            Drop this on any approved site. The launcher adopts this agent&apos;s brand color automatically.
            {def.allowedOrigins.length
              ? ` Embedding is restricted to: ${def.allowedOrigins.join(", ")}.`
              : " Add Allowed origins (Identity tab) to restrict where it can be embedded."}
          </p>
          <div className="sa-links-row">
            <a className="sa-btn" href={`/embed/${def.slug}`} target="_blank" rel="noreferrer">
              <ArrowSquareOut size={16} /> Full-page experience
            </a>
            <a className="sa-btn" href="/demo" target="_blank" rel="noreferrer">
              <ArrowSquareOut size={16} /> Host page demo
            </a>
          </div>
        </div>
      ) : null}
    </>
  );
}
