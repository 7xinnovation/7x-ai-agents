"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PaperPlaneRight,
  Translate,
  SignIn,
  UserCircleCheck,
  ArrowsOutSimple,
  ArrowsInSimple,
  X,
  ChatsCircle,
  Sparkle,
  TextAlignLeft,
  FileText,
  ListChecks,
  CheckCircle,
  Circle,
  Warning,
  ArrowRight,
  UploadSimple,
  ArrowClockwise,
} from "@phosphor-icons/react";
import { tr, type CaseState, type Locale } from "@dialog/config";
import type { PublicAgent } from "./types";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  citations?: string[];
}

const STR = {
  en: {
    placeholder: "Type your message…",
    sources: "Sources",
    case: "Your case",
    emptyTitle: "Nothing to assemble yet",
    emptyBody: "As we talk, your application takes shape here: details, documents, and what's left.",
    missing: "Submission readiness",
    ready: "Ready to submit",
    readyShort: "ready",
    reference: "Reference",
    signIn: "Sign in",
    signedIn: "Signed in",
    expand: "Expand",
    collapse: "Collapse",
    documents: "Documents",
    details: "Details",
    online: "Online",
    upload: "Upload",
    uploading: "Uploading…",
    replace: "Replace",
    optional: "optional",
    upTo: "up to",
  },
  ar: {
    placeholder: "اكتب رسالتك…",
    sources: "المصادر",
    case: "طلبك",
    emptyTitle: "لا يوجد ما يُجمع بعد",
    emptyBody: "أثناء المحادثة، يتشكّل طلبك هنا: التفاصيل والمستندات وما تبقّى.",
    missing: "جاهزية الإرسال",
    ready: "جاهز للإرسال",
    readyShort: "جاهز",
    reference: "الرقم المرجعي",
    signIn: "تسجيل الدخول",
    signedIn: "تم الدخول",
    expand: "توسيع",
    collapse: "تصغير",
    documents: "المستندات",
    details: "التفاصيل",
    online: "متصل",
    upload: "رفع",
    uploading: "جارٍ الرفع…",
    replace: "استبدال",
    optional: "اختياري",
    upTo: "حتى",
  },
} as const;

function postToParent(action: "expand" | "collapse" | "close") {
  try {
    window.parent?.postMessage({ source: "dialog", action }, "*");
  } catch {
    /* not embedded */
  }
}

export function Experience({
  agent,
  initialLocale,
  initialConversationId,
}: {
  agent: PublicAgent;
  initialLocale: Locale;
  initialConversationId?: string;
}) {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [caseState, setCaseState] = useState<CaseState | null>(null);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [authReason, setAuthReason] = useState<string | null>(null);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const convId = useRef<string | null>(null);
  const storageKey = `dlg-conv-${agent.slug}`;

  const t = STR[locale];
  const dir = locale === "ar" ? "rtl" : "ltr";
  const c = agent.theme.colors;

  // Field/document key -> localized label, across all journeys.
  const labelMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const j of agent.journeys)
      for (const s of j.steps) {
        for (const f of s.fields) m.set(f.key, tr(f.label, locale));
        for (const d of s.documents) m.set(d.key, tr(d.label, locale));
      }
    return m;
  }, [agent, locale]);

  // Submission progress for the active journey (legitimate form feedback).
  const progress = useMemo(() => {
    if (!caseState?.journeyKey) return null;
    const j = agent.journeys.find((x) => x.key === caseState.journeyKey);
    if (!j) return null;
    let total = 0;
    for (const s of j.steps) {
      total += s.fields.filter((f) => f.required).length;
      total += s.documents.filter((d) => d.requirement === "mandatory").length;
    }
    if (total === 0) return null;
    const done = Math.max(0, total - caseState.readiness.missing.length);
    return { done, total, pct: Math.round((done / total) * 100) };
  }, [caseState, agent]);

  // Document slots for the active journey, merged with current upload status, so
  // the user can upload proactively (PRD: document collection step).
  const docSlots = useMemo(() => {
    if (!caseState?.journeyKey) return [];
    const j = agent.journeys.find((x) => x.key === caseState.journeyKey);
    if (!j) return [];
    const byKey = new Map(caseState.documents.map((d) => [d.key, d]));
    return j.steps.flatMap((s) => s.documents).map((d) => ({
      ...d,
      status: byKey.get(d.key)?.status ?? "pending",
      fileName: byKey.get(d.key)?.fileName,
      rejectionReason: byKey.get(d.key)?.rejectionReason,
    }));
  }, [caseState, agent]);

  const uploadDoc = useCallback(
    async (key: string, file: File) => {
      if (!convId.current) return;
      setUploadingKey(key);
      try {
        const fd = new FormData();
        fd.append("agentSlug", agent.slug);
        fd.append("conversationId", convId.current);
        fd.append("key", key);
        fd.append("file", file);
        const res = await fetch("/api/upload", { method: "POST", body: fd });
        const json = await res.json();
        if (json.case) setCaseState(json.case);
      } catch {
        /* ignore */
      } finally {
        setUploadingKey(null);
      }
    },
    [agent.slug]
  );

  // Resume a prior session for this agent (PRD: partial-application retention).
  useEffect(() => {
    const saved =
      initialConversationId ??
      (typeof window !== "undefined" ? window.localStorage.getItem(storageKey) : null);
    if (!saved) return;
    (async () => {
      try {
        const res = await fetch(`/api/conversations/${saved}`);
        if (!res.ok) {
          window.localStorage.removeItem(storageKey);
          return;
        }
        const data = await res.json();
        convId.current = data.conversationId;
        setAuthenticated(Boolean(data.authenticated));
        setCaseState(data.case);
        setMessages(data.messages ?? []);
      } catch {
        /* ignore */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streaming]);

  const toggleFull = useCallback(() => {
    setFull((prev) => {
      postToParent(prev ? "collapse" : "expand");
      return !prev;
    });
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    setAuthReason(null);
    setMessages((prev) => [...prev, { role: "user", content: text }, { role: "assistant", content: "", citations: [] }]);
    setStreaming(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentSlug: agent.slug,
          userMessage: text,
          conversationId: convId.current ?? undefined,
          locale,
          authenticated,
        }),
      });
      if (!res.body) throw new Error("no stream");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const apply = (ev: any) => {
        if (ev.type === "session") {
          convId.current = ev.conversationId;
          try {
            window.localStorage.setItem(storageKey, ev.conversationId);
          } catch {
            /* ignore */
          }
        } else if (ev.type === "text") {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last) last.content += ev.delta;
            return next;
          });
        } else if (ev.type === "case") {
          setCaseState(ev.state);
        } else if (ev.type === "citation") {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last && !last.citations?.includes(ev.source)) last.citations = [...(last.citations ?? []), ev.source];
            return next;
          });
        } else if (ev.type === "auth_required") {
          setAuthReason(ev.reason);
        } else if (ev.type === "error") {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last) last.content += `\n\n⚠ ${ev.message}`;
            return next;
          });
        }
      };

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          try {
            apply(JSON.parse(line.slice(6)));
          } catch {
            /* ignore partial */
          }
        }
      }
    } catch (err) {
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last) last.content += `\n\n⚠ ${err instanceof Error ? err.message : "error"}`;
        return next;
      });
    } finally {
      setStreaming(false);
    }
  }, [input, streaming, agent.slug, locale, authenticated, storageKey]);

  const rootStyle = {
    ["--c-primary" as string]: c.primary,
    ["--c-primary-fg" as string]: c.primaryForeground,
    ["--c-surface" as string]: c.surface,
    ["--c-surface-muted" as string]: c.surfaceMuted,
    ["--c-text" as string]: c.text,
    ["--c-text-muted" as string]: c.textMuted,
    ["--c-border" as string]: c.border,
    ["--c-success" as string]: c.success,
    ["--c-warning" as string]: c.warning,
    ["--c-danger" as string]: c.danger,
  } as React.CSSProperties;

  const missing = caseState?.readiness.missing ?? [];
  const dataEntries = Object.entries(caseState?.data ?? {});
  const hasCase = caseState && (dataEntries.length > 0 || caseState.documents.length > 0);
  const iconWeight = "regular" as const;

  return (
    <div className={`dlg-root ${full ? "is-full" : ""}`} dir={dir} style={rootStyle}>
      <header className="dlg-header">
        <div className="dlg-brand">
          <span className="dlg-avatar">
            {agent.theme.logoUrl ? (
              <img src={agent.theme.logoUrl} alt="" />
            ) : (
              <ChatsCircle size={19} weight="fill" />
            )}
          </span>
          <span className="dlg-brand-text">
            <span className="dlg-brand-name">{agent.theme.brandName || agent.name}</span>
            <span className="dlg-brand-status">
              <span className="dlg-dot" /> {t.online}
            </span>
          </span>
        </div>
        <div className="dlg-actions">
          {agent.locales.length > 1 ? (
            <button
              className="dlg-chip lang"
              onClick={() => setLocale(locale === "ar" ? "en" : "ar")}
              aria-label="Switch language"
            >
              <Translate size={16} weight={iconWeight} />
              <span className="dlg-chip-tag">{locale === "ar" ? "EN" : "ع"}</span>
            </button>
          ) : null}
          <button
            className={`dlg-chip icon-only ${authenticated ? "is-on" : ""}`}
            onClick={() => {
              setAuthenticated((a) => !a);
              setAuthReason(null);
            }}
            aria-label={authenticated ? t.signedIn : t.signIn}
            title={authenticated ? t.signedIn : t.signIn}
          >
            {authenticated ? <UserCircleCheck size={17} weight="fill" /> : <SignIn size={16} weight={iconWeight} />}
          </button>
          <button className="dlg-chip icon-only" onClick={toggleFull} aria-label={full ? t.collapse : t.expand}>
            {full ? <ArrowsInSimple size={16} weight={iconWeight} /> : <ArrowsOutSimple size={16} weight={iconWeight} />}
          </button>
          <button className="dlg-chip icon-only" onClick={() => postToParent("close")} aria-label="Close">
            <X size={16} weight={iconWeight} />
          </button>
        </div>
      </header>

      <div className="dlg-split">
        {/* LEFT: conversation */}
        <section className="dlg-chat">
          <div className="dlg-messages" ref={scrollRef}>
            <div className="dlg-msg assistant">
              <span className="dlg-msg-avatar">
                <Sparkle size={15} weight="fill" />
              </span>
              <div className="dlg-bubble">{tr(agent.greeting, locale)}</div>
            </div>
            {messages.map((m, i) => (
              <div key={i} className={`dlg-msg ${m.role}`}>
                {m.role === "assistant" ? (
                  <span className="dlg-msg-avatar">
                    <Sparkle size={15} weight="fill" />
                  </span>
                ) : null}
                <div className="dlg-bubble">
                  {m.content ? (
                    m.content
                  ) : streaming && i === messages.length - 1 ? (
                    <span className="dlg-typing">
                      <span />
                      <span />
                      <span />
                    </span>
                  ) : null}
                  {m.citations?.length ? (
                    <div className="dlg-sources">
                      {m.citations.map((s, k) => (
                        <span className="dlg-source" key={k}>
                          {s}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          {authReason ? (
            <div className="dlg-auth-banner">
              <Warning size={18} weight="fill" />
              <span>{authReason}</span>
              <button
                className="dlg-chip"
                onClick={() => {
                  setAuthenticated(true);
                  setAuthReason(null);
                }}
              >
                {t.signIn}
              </button>
            </div>
          ) : null}

          <div className="dlg-input-wrap">
            <div className="dlg-input">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder={t.placeholder}
                rows={1}
              />
              <button className="dlg-send" onClick={() => void send()} disabled={streaming || !input.trim()} aria-label="Send">
                <PaperPlaneRight size={18} weight="fill" />
              </button>
            </div>
          </div>
        </section>

        {/* RIGHT: realtime case builder */}
        <aside className="dlg-case">
          <div className="dlg-case-inner">
            <div className="dlg-case-head">
              <h2>{t.case}</h2>
              {caseState && hasCase ? <span className={`dlg-status ${caseState.status}`}>{caseState.status}</span> : null}
            </div>

            {!hasCase ? (
              <div className="dlg-empty">
                <span className="dlg-empty-icon">
                  <FileText size={26} weight={iconWeight} />
                </span>
                <h4>{t.emptyTitle}</h4>
                <p>{t.emptyBody}</p>
              </div>
            ) : (
              <>
                {caseState!.reference ? (
                  <div className="dlg-reference">
                    <CheckCircle size={20} weight="fill" color={c.success} />
                    <span className="ref-label">{t.reference}</span>
                    <strong>{caseState!.reference}</strong>
                  </div>
                ) : null}

                {progress ? (
                  <div className="dlg-progress">
                    <div className="dlg-progress-row">
                      <span>{progress.pct === 100 ? t.ready : t.missing}</span>
                      <span>
                        <strong>{progress.done}</strong> / {progress.total} {t.readyShort}
                      </span>
                    </div>
                    <div className="dlg-progress-track">
                      <div
                        className={`dlg-progress-fill ${progress.pct === 100 ? "done" : ""}`}
                        style={{ width: `${progress.pct}%` }}
                      />
                    </div>
                  </div>
                ) : null}

                {dataEntries.length ? (
                  <div className="dlg-card">
                    <h3>
                      <TextAlignLeft size={15} weight="bold" /> {t.details}
                    </h3>
                    {dataEntries.map(([k, v]) => (
                      <div className="dlg-field" key={k}>
                        <span className="dlg-field-label">{labelMap.get(k) ?? k}</span>
                        <span className="dlg-field-value">{typeof v === "object" ? JSON.stringify(v) : String(v)}</span>
                      </div>
                    ))}
                  </div>
                ) : null}

                {docSlots.length ? (
                  <div className="dlg-card">
                    <h3>
                      <FileText size={15} weight="bold" /> {t.documents}
                    </h3>
                    {docSlots.map((d) => {
                      const uploaded = d.status === "uploaded" || d.status === "accepted";
                      const busy = uploadingKey === d.key;
                      return (
                        <div className="dlg-docslot" key={d.key}>
                          <div className="dlg-docslot-head">
                            <span className="dlg-docslot-name">
                              {tr(d.label, locale)}
                              {d.requirement === "optional" ? <em> ({t.optional})</em> : null}
                            </span>
                            <span className={`dlg-doc-status ${d.status}`}>
                              {uploaded ? <CheckCircle size={12} weight="fill" /> : null}
                              {d.status}
                            </span>
                          </div>
                          {uploaded ? (
                            <div className="dlg-docslot-meta">
                              <span className="fname">{d.fileName}</span>
                              <label className="dlg-upload ghost">
                                {t.replace}
                                <input
                                  type="file"
                                  hidden
                                  accept={d.acceptedFormats.map((f) => "." + f).join(",")}
                                  onChange={(e) => e.target.files?.[0] && uploadDoc(d.key, e.target.files[0])}
                                />
                              </label>
                            </div>
                          ) : (
                            <div className="dlg-docslot-meta">
                              <span className="hint">
                                {d.acceptedFormats.join(", ").toUpperCase()} · {t.upTo} {d.maxSizeMb}MB
                              </span>
                              <label className={`dlg-upload ${busy ? "busy" : ""}`}>
                                {busy ? (
                                  <>
                                    <ArrowClockwise size={14} weight="bold" className="spin" /> {t.uploading}
                                  </>
                                ) : (
                                  <>
                                    <UploadSimple size={14} weight="bold" /> {t.upload}
                                  </>
                                )}
                                <input
                                  type="file"
                                  hidden
                                  disabled={busy}
                                  accept={d.acceptedFormats.map((f) => "." + f).join(",")}
                                  onChange={(e) => e.target.files?.[0] && uploadDoc(d.key, e.target.files[0])}
                                />
                              </label>
                            </div>
                          )}
                          {d.status === "rejected" && d.rejectionReason ? (
                            <div className="dlg-docslot-error">
                              <Warning size={13} weight="fill" /> {d.rejectionReason}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}

                <div className="dlg-card">
                  <h3>
                    <ListChecks size={15} weight="bold" /> {t.missing}
                  </h3>
                  {caseState!.readiness.complete ? (
                    <div className="dlg-check done">
                      <CheckCircle size={18} weight="fill" color={c.success} />
                      {t.ready}
                    </div>
                  ) : missing.length ? (
                    missing.map((m) => (
                      <div className="dlg-check todo" key={`${m.kind}:${m.key}`}>
                        <Circle size={18} weight={iconWeight} />
                        {labelMap.get(m.key) ?? m.key}
                        <span className="kind">{m.kind}</span>
                      </div>
                    ))
                  ) : (
                    <div className="dlg-check todo">
                      <ArrowRight size={16} weight="bold" />
                      {t.emptyBody}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
