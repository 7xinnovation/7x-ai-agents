"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AdminHeader } from "@/components/developers/admin/AdminNav";
import { Notice, adminApi, type NoteValue } from "@/components/developers/admin/ui";
import { btnPrimary, btnSecondary, inputCls } from "@/components/developers/admin/styles";
import { SETTING_LABELS, absolute, byLabel } from "@/components/developers/admin/labels";
import type { AgentOption, PortalSettings, SettingsMeta } from "@/components/developers/admin/types";
import { cn } from "@/lib/utils";

type Key = keyof PortalSettings;
type Draft = Omit<PortalSettings, "rateLimitPerMinute" | "codeTtlMinutes" | "codeMaxAttempts"> & {
  rateLimitPerMinute: string;
  codeTtlMinutes: string;
  codeMaxAttempts: string;
};

const RANGES = { rateLimitPerMinute: [0, 100_000], codeTtlMinutes: [2, 60], codeMaxAttempts: [1, 20] } as const;
type NumKey = keyof typeof RANGES;
const NUM_KEYS = Object.keys(RANGES) as NumKey[];
const BANNER_MAX = 200;

const toDraft = (s: PortalSettings): Draft => ({
  ...s,
  rateLimitPerMinute: String(s.rateLimitPerMinute),
  codeTtlMinutes: String(s.codeTtlMinutes),
  codeMaxAttempts: String(s.codeMaxAttempts),
});

function parseInt_(v: string): number | null {
  if (!/^\d+$/.test(v.trim())) return null;
  return Number(v.trim());
}

const sameList = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");

function equal(k: Key, a: unknown, b: unknown): boolean {
  if (k === "defaultAgents") return sameList(a as string[], b as string[]);
  return a === b;
}

export function SettingsClient({
  initial,
  defaults,
  initialMeta,
  agents,
}: {
  initial: PortalSettings;
  defaults: PortalSettings;
  initialMeta: SettingsMeta;
  agents: AgentOption[];
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial));
  const [meta, setMeta] = useState(initialMeta);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<NoteValue | null>(null);

  // The draft as values, and what is wrong with it before the server is asked.
  const invalid: Partial<Record<Key, string>> = {};
  const values: Partial<PortalSettings> = { doorwayEnabled: draft.doorwayEnabled, defaultAgents: draft.defaultAgents, bannerText: draft.bannerText.trim() };
  for (const k of NUM_KEYS) {
    const n = parseInt_(draft[k]);
    const [min, max] = RANGES[k];
    if (n === null || n < min || n > max) invalid[k] = `A whole number from ${min} to ${max}.`;
    else values[k] = n;
  }
  if (draft.bannerText.trim().length > BANNER_MAX) invalid.bannerText = `At most ${BANNER_MAX} characters.`;

  const changed = (Object.keys(saved) as Key[]).filter((k) => !invalid[k] && values[k] !== undefined && !equal(k, values[k], saved[k]));
  const dirty = changed.length > 0 || Object.keys(invalid).length > 0;
  const canSave = changed.length > 0 && Object.keys(invalid).length === 0 && !busy;

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setNote(null);
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    setBusy(true);
    setNote(null);
    const body = Object.fromEntries(changed.map((k) => [k, values[k]]));
    const r = await adminApi<{ settings: PortalSettings }>("/api/developers/admin/settings", { method: "PATCH", body: JSON.stringify(body) });
    if (!r.ok) {
      setBusy(false);
      const key = typeof r.body.key === "string" ? r.body.key : null;
      setNote({
        tone: "error",
        text: key ? `Nothing was saved: the value for "${SETTING_LABELS[key] ?? key}" is not accepted.` : `Nothing was saved (${r.error}).`,
      });
      return;
    }
    setSaved(r.body.settings);
    setDraft(toDraft(r.body.settings));
    const m = await adminApi<{ meta: SettingsMeta }>("/api/developers/admin/settings");
    if (m.ok) setMeta(m.body.meta);
    setBusy(false);
    setNote({
      tone: "ok",
      text: `Saved ${changed.map((k) => SETTING_LABELS[k] ?? k).join(", ")}. Every server applies the change within 30 seconds.`,
    });
    // The banner lives in the layout; refresh it so this page shows the new text at once.
    router.refresh();
  }

  const footer = (k: Key, show: (v: PortalSettings[Key]) => string) => {
    const lines: string[] = [];
    if (!equal(k, saved[k], defaults[k])) lines.push(`Default: ${show(defaults[k])}`);
    const m = meta[k];
    if (m) lines.push(`Last changed by ${byLabel(m.updatedBy) ?? "unknown"}, ${absolute(m.updatedAt)}`);
    return lines;
  };
  const agentNames = (v: unknown) => {
    const list = v as string[];
    return list.length ? list.map((key) => agents.find((a) => a.key === key)?.name ?? key).join(", ") : "none";
  };

  return (
    <form onSubmit={save}>
      <AdminHeader title="Settings" subtitle="How the doorway, sign-in and new applications behave. Changes apply to every server within 30 seconds." />

      <Notice note={note} onDismiss={() => setNote(null)} />

      <div className="mt-6 flex flex-col gap-6">
        <Section title="Doorway">
          <Field
            id="doorwayEnabled"
            label="Doorway enabled"
            hint="When off, every call to the A2A endpoints answers 503 with error -32013. The portal stays available."
            changed={changed.includes("doorwayEnabled")}
            footer={footer("doorwayEnabled", (v) => (v ? "on" : "off"))}
            inline={
              <Switch
                id="doorwayEnabled"
                checked={draft.doorwayEnabled}
                onChange={(v) => set("doorwayEnabled", v)}
              />
            }
          >
            {!draft.doorwayEnabled ? (
              <p className="mt-2 border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-[13px] text-[#b54708]">
                {saved.doorwayEnabled ? "Saving this closes the doorway for every application." : "The doorway is closed. Every application gets 503 until it is turned back on."}
              </p>
            ) : null}
          </Field>
          <Field
            id="rateLimitPerMinute"
            label="Rate limit per application per minute"
            hint="Calls one application may make in a minute. 0 means no limit."
            changed={changed.includes("rateLimitPerMinute")}
            error={invalid.rateLimitPerMinute}
            footer={footer("rateLimitPerMinute", (v) => String(v))}
          >
            <NumberInput id="rateLimitPerMinute" value={draft.rateLimitPerMinute} onChange={(v) => set("rateLimitPerMinute", v)} min={0} max={100_000} suffix="calls" />
          </Field>
        </Section>

        <Section title="Sign-in">
          <Field
            id="codeTtlMinutes"
            label="Code lifetime in minutes"
            hint="How long an emailed sign-in code stays valid."
            changed={changed.includes("codeTtlMinutes")}
            error={invalid.codeTtlMinutes}
            footer={footer("codeTtlMinutes", (v) => `${v} minutes`)}
          >
            <NumberInput id="codeTtlMinutes" value={draft.codeTtlMinutes} onChange={(v) => set("codeTtlMinutes", v)} min={2} max={60} suffix="minutes" />
          </Field>
          <Field
            id="codeMaxAttempts"
            label="Wrong attempts allowed"
            hint="Wrong codes accepted before a new code must be requested."
            changed={changed.includes("codeMaxAttempts")}
            error={invalid.codeMaxAttempts}
            footer={footer("codeMaxAttempts", (v) => String(v))}
          >
            <NumberInput id="codeMaxAttempts" value={draft.codeMaxAttempts} onChange={(v) => set("codeMaxAttempts", v)} min={1} max={20} suffix="attempts" />
          </Field>
        </Section>

        <Section title="Applications">
          <Field
            id="defaultAgents"
            label="Agents a new application may call"
            hint="Applied when an application is created. Existing applications keep their own list; change those on the Applications page."
            changed={changed.includes("defaultAgents")}
            footer={footer("defaultAgents", agentNames)}
            group
          >
            <div className="mt-1 flex flex-col gap-2">
              {agents.map((a) => (
                <label key={a.key} className="flex items-start gap-2.5 text-[13.5px] text-ink-2">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 accent-[#1330f0]"
                    checked={draft.defaultAgents.includes(a.key)}
                    onChange={(e) => set("defaultAgents", e.target.checked ? [...draft.defaultAgents, a.key] : draft.defaultAgents.filter((k) => k !== a.key))}
                  />
                  <span>
                    {a.name}
                    <span className="mono ml-2 text-[12px] text-muted">{a.key}</span>
                  </span>
                </label>
              ))}
              {draft.defaultAgents.length === 0 ? <p className="text-[12.5px] text-[#b54708]">New applications will not be able to call any agent until an admin allows one.</p> : null}
            </div>
          </Field>
        </Section>

        <Section title="Portal">
          <Field
            id="bannerText"
            label="Banner text"
            hint={`Shown in the dark strip at the top of every page, after "Sandbox environment."`}
            changed={changed.includes("bannerText")}
            error={invalid.bannerText}
            footer={footer("bannerText", (v) => `"${v}"`)}
          >
            <input id="bannerText" className={cn(inputCls, "max-w-[640px]")} value={draft.bannerText} onChange={(e) => set("bannerText", e.target.value)} maxLength={BANNER_MAX + 50} />
            <p className={cn("mt-1 text-[12px] tabular-nums", draft.bannerText.trim().length > BANNER_MAX ? "text-[#b42318]" : "text-muted")}>
              {draft.bannerText.trim().length} of {BANNER_MAX} characters
            </p>
            <div className="mt-3">
              <span className="text-[12px] text-muted">Preview</span>
              <div className="mt-1 flex min-h-8 items-center border border-[#0f1720] bg-[#0f1720] px-4 py-1.5 text-[12px] text-white/70">
                <span>
                  <span className="font-medium text-white">Sandbox environment.</span> {draft.bannerText.trim()}
                </span>
              </div>
            </div>
          </Field>
        </Section>
      </div>

      <div className="sticky bottom-0 z-10 mt-6 flex flex-wrap items-center gap-3 border-t border-[var(--color-line)] bg-[var(--color-canvas)] py-4">
        <button type="submit" className={btnPrimary} disabled={!canSave}>
          {busy ? "Saving…" : "Save changes"}
        </button>
        <button
          type="button"
          className={btnSecondary}
          disabled={!dirty || busy}
          onClick={() => {
            setDraft(toDraft(saved));
            setNote(null);
          }}
        >
          Discard
        </button>
        <span className="text-[12.5px] text-muted" aria-live="polite">
          {changed.length ? `${changed.length} unsaved ${changed.length === 1 ? "change" : "changes"}` : Object.keys(invalid).length ? "Fix the highlighted values to save." : "No changes"}
        </span>
      </div>
    </form>
  );
}

// ─── Parts ───────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="border border-[var(--color-line)] bg-white">
      <h2 className="border-b border-[var(--color-line)] px-5 py-3 text-[13px] font-semibold text-ink">{title}</h2>
      <div className="divide-y divide-[var(--color-line-soft)]">{children}</div>
    </section>
  );
}

function Field({
  id,
  label,
  hint,
  changed,
  error,
  footer,
  inline,
  group,
  children,
}: {
  id: string;
  label: string;
  hint: string;
  changed: boolean;
  error?: string;
  footer: string[];
  inline?: React.ReactNode;
  group?: boolean;
  children?: React.ReactNode;
}) {
  const head = (
    <span className="flex flex-wrap items-center gap-2">
      <span className="text-[13.5px] font-medium text-ink">{label}</span>
      {changed ? <span className="rounded-[3px] border border-[var(--color-ring)] px-1.5 text-[11.5px] font-medium text-[#1330f0]">Changed</span> : null}
    </span>
  );
  return (
    <div className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,300px)_minmax(0,1fr)] md:gap-8">
      <div>
        {group ? <span id={`${id}-label`}>{head}</span> : <label htmlFor={id}>{head}</label>}
        <p id={`${id}-hint`} className="mt-1 text-[12.5px] leading-relaxed text-muted">
          {hint}
        </p>
      </div>
      <div className="min-w-0" role={group ? "group" : undefined} aria-labelledby={group ? `${id}-label` : undefined}>
        {inline}
        {children}
        {error ? (
          <p role="alert" className="mt-1.5 text-[12.5px] text-[#b42318]">
            {error}
          </p>
        ) : null}
        {footer.map((line) => (
          <p key={line} className="mt-1.5 text-[12px] text-muted">
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}

function NumberInput({ id, value, onChange, min, max, suffix }: { id: string; value: string; onChange: (v: string) => void; min: number; max: number; suffix: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={`${id}-hint`}
        className={cn(inputCls, "w-[140px] tabular-nums")}
      />
      <span className="text-[13px] text-muted">{suffix}</span>
    </span>
  );
}

function Switch({ id, checked, onChange }: { id: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <span className="inline-flex items-center gap-3">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={`${id}-hint`}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-[3px] border transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--color-ring)]",
          checked ? "border-[#1330f0] bg-[#1330f0]" : "border-[#c9cfd6] bg-[var(--color-line-soft)]"
        )}
      >
        <span
          aria-hidden
          className={cn("absolute top-[3px] h-4 w-4 rounded-[2px] bg-white transition-[left] motion-reduce:transition-none", checked ? "left-[22px]" : "left-[3px] border border-[#c9cfd6]")}
        />
      </button>
      <span className="text-[13.5px] text-ink-2">{checked ? "On" : "Off"}</span>
    </span>
  );
}
