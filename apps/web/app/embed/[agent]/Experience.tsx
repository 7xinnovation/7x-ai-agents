"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PaperPlaneRight,
  GlobeSimple,
  SignIn,
  UserCircleCheck,
  ArrowsOutSimple,
  ArrowsInSimple,
  X,
  ChatsCircle,
  TextAlignLeft,
  FileText,
  ListChecks,
  CheckCircle,
  Circle,
  Warning,
  ArrowRight,
  UploadSimple,
  ArrowClockwise,
  LockSimple,
  ArrowSquareOut,
  Camera,
  DeviceMobile,
  Info,
  CaretLeft,
} from "@phosphor-icons/react";
import QRCode from "qrcode";
import { tr, type CaseState, type Locale } from "@dialog/config";
import { Markdown, TypewriterMarkdown } from "./Markdown";
import type { PublicAgent } from "./types";

interface PaymentInfo {
  reference: string;
  link?: string;
  amount: number;
  currency: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  citations?: string[];
  payment?: PaymentInfo;
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
    reset: "New chat",
    documents: "Documents",
    details: "Details",
    online: "Online",
    upload: "Upload",
    uploading: "Uploading…",
    replace: "Replace",
    optional: "optional",
    upTo: "up to",
    suggestions: "Suggested",
    askAnything: "Ask anything, or start with",
    enterToSend: "Enter to send",
    poweredBy: "AI assistant",
    securePayment: "Secure payment",
    payNow: "Pay now",
    payWaiting: "Complete the payment in the secure window…",
    payPaid: "Payment received",
    payFailed: "Payment unsuccessful",
    payRetry: "Try again",
    payNote: "Processed by the payment gateway. Card details never touch this chat.",
    payWindowClosed: "The payment window was closed.",
    takePhoto: "Take photo",
    fromPhone: "From phone",
    scanTitle: "Upload from your phone",
    scanHint: "Scan this code with your phone camera to open the upload page for this application. Files you add there appear here automatically.",
    done: "Done",
    caseTab: "Your case",
    backToChat: "Back to chat",
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
    reset: "محادثة جديدة",
    documents: "المستندات",
    details: "التفاصيل",
    online: "متصل",
    upload: "رفع",
    uploading: "جارٍ الرفع…",
    replace: "استبدال",
    optional: "اختياري",
    upTo: "حتى",
    suggestions: "مقترحات",
    askAnything: "اسأل أي شيء، أو ابدأ بـ",
    enterToSend: "اضغط Enter للإرسال",
    poweredBy: "مساعد ذكي",
    securePayment: "دفع آمن",
    payNow: "ادفع الآن",
    payWaiting: "أكمل الدفع في النافذة الآمنة…",
    payPaid: "تم استلام الدفعة",
    payFailed: "لم تكتمل عملية الدفع",
    payRetry: "حاول مرة أخرى",
    payNote: "تتم المعالجة عبر بوابة الدفع. بيانات البطاقة لا تمر عبر هذه المحادثة.",
    payWindowClosed: "تم إغلاق نافذة الدفع.",
    takePhoto: "التقاط صورة",
    fromPhone: "من الهاتف",
    scanTitle: "الرفع من هاتفك",
    scanHint: "امسح هذا الرمز بكاميرا هاتفك لفتح صفحة رفع المستندات لهذا الطلب. الملفات التي تضيفها هناك تظهر هنا تلقائياً.",
    done: "تم",
    caseTab: "طلبك",
    backToChat: "العودة للمحادثة",
  },
} as const;

function postToParent(action: "expand" | "collapse" | "close") {
  try {
    window.parent?.postMessage({ source: "dialog", action }, "*");
  } catch {
    /* not embedded */
  }
}

/**
 * QR hand-off (feedback FB-6, web): on a computer the customer scans this to open
 * the per-conversation mobile upload page on their phone; whatever they upload
 * there flows into the same case (the desktop polls the conversation and the
 * panel updates live). The QR is rendered locally (no external image service).
 */
function QrModal({
  url,
  strings,
  onClose,
}: {
  url: string;
  strings: { scanTitle: string; scanHint: string; done: string };
  onClose: () => void;
}) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(url, { margin: 1, width: 360, errorCorrectionLevel: "M" })
      .then((d) => alive && setDataUrl(d))
      .catch(() => alive && setDataUrl(null));
    return () => {
      alive = false;
    };
  }, [url]);
  return (
    <div className="dlg-qr-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="dlg-qr-card" onClick={(e) => e.stopPropagation()}>
        <h4>{strings.scanTitle}</h4>
        <p>{strings.scanHint}</p>
        {dataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="dlg-qr-img" src={dataUrl} alt="QR code" />
        ) : (
          <div className="dlg-qr-img" />
        )}
        <a className="dlg-qr-link" href={url} target="_blank" rel="noreferrer">
          {url}
        </a>
        <button className="dlg-qr-close" onClick={onClose}>
          {strings.done}
        </button>
      </div>
    </div>
  );
}

/**
 * Maps a streamed tool/lookup event to a short, human status line shown while the
 * assistant works through a (silent, multi-second) tool round. Matches on generic
 * keywords so it never leaks a raw internal tool name; falls back to a neutral line.
 */
function toolStatusLabel(ev: { type: string; tool?: string; kind?: string }, ar: boolean): string {
  const t = (ev.tool || "").toLowerCase();
  const L = (en: string, arb: string) => (ar ? arb : en);
  if (ev.type === "lookup") return L("Tracking your shipment…", "جارٍ تتبّع شحنتك…");
  if (/details/.test(t)) return L("Looking up your box…", "جارٍ جلب بيانات صندوقك…");
  if (/pricing|charges/.test(t)) return L("Checking pricing…", "جارٍ حساب السعر…");
  if (/boxlocations|branch/.test(t)) return L("Finding branches…", "جارٍ إيجاد الفروع…");
  if (/bundle/.test(t)) return L("Fetching packages…", "جارٍ جلب الباقات…");
  if (/options|entities|expiry/.test(t)) return L("Getting the details…", "جارٍ جلب التفاصيل…");
  return L("Working on it…", "جارٍ العمل على طلبك…");
}

/**
 * In-chat secure payment card. The hosted gateway page opens in a centered
 * popup (card data never touches the chat — PCI stays with the gateway); while
 * it's open we poll the payment status, and the moment the webhook settles it
 * the card flips to paid/failed and `onPaid` lets the conversation continue.
 */
function PaymentCard({
  payment,
  conversationId,
  strings,
  locale,
  onPaid,
}: {
  payment: PaymentInfo;
  conversationId: string | null;
  strings: (typeof STR)[Locale];
  locale: Locale;
  onPaid: () => void;
}) {
  const [phase, setPhase] = useState<"ready" | "waiting" | "paid" | "failed">("ready");
  const [note, setNote] = useState<string | null>(null);
  const popupRef = useRef<Window | null>(null);
  const paidRef = useRef(false);

  const amountFmt = useMemo(() => {
    try {
      return new Intl.NumberFormat(locale === "ar" ? "ar-AE" : "en-AE", {
        style: "currency",
        currency: payment.currency,
      }).format(payment.amount);
    } catch {
      return `${payment.amount} ${payment.currency}`;
    }
  }, [payment.amount, payment.currency, locale]);

  const openPopup = useCallback(() => {
    if (!payment.link) return;
    const w = 480;
    const h = 720;
    const left = Math.max(0, Math.round(((window.screen?.width ?? w) - w) / 2));
    const top = Math.max(0, Math.round(((window.screen?.height ?? h) - h) / 2));
    const win = window.open(payment.link, "dlg-pay", `popup=yes,width=${w},height=${h},left=${left},top=${top}`);
    // Popup blocked → new tab; polling picks the result up either way.
    popupRef.current = win ?? window.open(payment.link, "_blank");
    setNote(null);
    setPhase("waiting");
  }, [payment.link]);

  useEffect(() => {
    if (phase !== "waiting" || !conversationId) return;
    let cancelled = false;
    let closedPolls = 0;
    let polls = 0;
    const tick = async () => {
      polls++;
      try {
        const res = await fetch(
          `/api/payments/status?reference=${encodeURIComponent(payment.reference)}&conversationId=${encodeURIComponent(conversationId)}`
        );
        if (!res.ok || cancelled) return;
        const { status } = (await res.json()) as { status?: string };
        if (cancelled) return;
        if (status === "paid") {
          setPhase("paid");
          if (!paidRef.current) {
            paidRef.current = true;
            onPaid();
          }
          return;
        }
        if (status === "failed") {
          setPhase("failed");
          return;
        }
      } catch {
        /* transient — keep polling */
      }
      // Customer dismissed the payment window without paying → offer the button again.
      if (popupRef.current?.closed) {
        closedPolls++;
        if (closedPolls >= 2) {
          setPhase("ready");
          setNote(strings.payWindowClosed);
        }
      }
      if (polls > 240) setPhase("ready"); // ~10 min safety stop
    };
    const id = setInterval(() => void tick(), 2500);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [phase, conversationId, payment.reference, onPaid, strings]);

  return (
    <div className={`dlg-paycard ${phase}`}>
      <div className="dlg-paycard-head">
        <span className="dlg-paycard-icon">
          <LockSimple size={14} weight="fill" />
        </span>
        <span className="dlg-paycard-title">{strings.securePayment}</span>
        <span className="dlg-paycard-amount">{amountFmt}</span>
      </div>
      {phase === "ready" ? (
        <>
          <button className="dlg-paybtn" onClick={openPopup} disabled={!payment.link}>
            {strings.payNow}
            <ArrowSquareOut size={15} weight="bold" />
          </button>
          {note ? <div className="dlg-paycard-note warn">{note}</div> : null}
          <div className="dlg-paycard-note">{strings.payNote}</div>
        </>
      ) : null}
      {phase === "waiting" ? (
        <div className="dlg-paycard-status">
          <span className="dlg-tool-spinner" />
          {strings.payWaiting}
        </div>
      ) : null}
      {phase === "paid" ? (
        <div className="dlg-paycard-status paid">
          <CheckCircle size={16} weight="fill" />
          {strings.payPaid}
        </div>
      ) : null}
      {phase === "failed" ? (
        <>
          <div className="dlg-paycard-status failed">
            <Warning size={16} weight="fill" />
            {strings.payFailed}
          </div>
          <button className="dlg-paybtn ghost" onClick={openPopup} disabled={!payment.link}>
            {strings.payRetry}
          </button>
        </>
      ) : null}
    </div>
  );
}

export function Experience({
  agent,
  initialLocale,
  initialConversationId,
  uaePassToken,
}: {
  agent: PublicAgent;
  initialLocale: Locale;
  initialConversationId?: string;
  uaePassToken?: string;
}) {
  const uaePass = useRef<string | undefined>(uaePassToken);
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [caseState, setCaseState] = useState<CaseState | null>(null);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [authReason, setAuthReason] = useState<string | null>(null);
  // Friendly "what the assistant is doing" line shown during silent tool rounds.
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  // Resume completion + a one-shot flag to fire the account pulse after sign-in.
  const [resumed, setResumed] = useState(false);
  const [signedInPulse, setSignedInPulse] = useState(false);
  // One-shot flag: the in-chat payment card saw the webhook settle → have the
  // assistant confirm + continue as soon as no turn is streaming.
  const [paymentPulse, setPaymentPulse] = useState(false);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  // Mobile (feedback FB-5): the case panel is a full-screen overlay toggled here.
  const [mobileCaseOpen, setMobileCaseOpen] = useState(false);
  // QR hand-off modal (feedback FB-6): the mobile upload URL currently shown.
  const [qrUrl, setQrUrl] = useState<string | null>(null);
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

  // Conversation starters — surfaced from the agent's own journeys so the empty
  // state guides the user toward what this assistant can actually do.
  const starters = useMemo(
    () => agent.journeys.slice(0, 4).map((j) => ({ key: j.key, label: tr(j.title, locale) })),
    [agent, locale]
  );

  // Mirror of the engine's document `condition` evaluator (key == 'v', key != 'v',
  // bare-key truthy) so conditional slots only surface once their gate field says so.
  const docApplies = useCallback(
    (condition: string | undefined) => {
      if (!condition) return true;
      const data = (caseState?.data ?? {}) as Record<string, unknown>;
      const eq = condition.match(/^\s*([\w.]+)\s*(==|!=)\s*'([^']*)'\s*$/);
      if (eq) {
        const [, key, op, val] = eq;
        const actual = String(data[key!] ?? "");
        return op === "==" ? actual === val : actual !== val;
      }
      return Boolean(data[condition.trim()]);
    },
    [caseState]
  );

  // Submission progress for the active journey (legitimate form feedback).
  const progress = useMemo(() => {
    if (!caseState?.journeyKey) return null;
    const j = agent.journeys.find((x) => x.key === caseState.journeyKey);
    if (!j) return null;
    let total = 0;
    for (const s of j.steps) {
      total += s.fields.filter((f) => f.required).length;
      total += s.documents.filter((d) => d.requirement === "mandatory" && docApplies(d.condition)).length;
    }
    if (total === 0) return null;
    const done = Math.max(0, total - caseState.readiness.missing.length);
    return { done, total, pct: Math.round((done / total) * 100) };
  }, [caseState, agent, docApplies]);

  // Document slots for the active journey, merged with current upload status, so
  // the user can upload proactively (PRD: document collection step). Conditional
  // documents stay hidden until their condition holds (e.g. agent EID only after
  // the customer chooses to add an agent) — unless already uploaded.
  const docSlots = useMemo(() => {
    if (!caseState?.journeyKey) return [];
    const j = agent.journeys.find((x) => x.key === caseState.journeyKey);
    if (!j) return [];
    const byKey = new Map(caseState.documents.map((d) => [d.key, d]));
    return j.steps.flatMap((s) => s.documents).filter((d) => docApplies(d.condition) || byKey.has(d.key)).map((d) => ({
      ...d,
      status: byKey.get(d.key)?.status ?? "pending",
      fileName: byKey.get(d.key)?.fileName,
      rejectionReason: byKey.get(d.key)?.rejectionReason,
    }));
  }, [caseState, agent, docApplies]);

  // Documents still awaiting an upload — drives the mobile toggle badge and the
  // live-sync poll (so a phone/QR upload doesn't need to keep polling forever).
  const pendingDocCount = useMemo(
    () => docSlots.filter((d) => d.status !== "uploaded" && d.status !== "accepted").length,
    [docSlots]
  );

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

  // Open the QR hand-off for the current conversation (feedback FB-6, web →
  // phone). The mobile page keys off agent slug + conversation id.
  const openQrHandoff = useCallback(() => {
    if (!convId.current || typeof window === "undefined") return;
    setQrUrl(`${window.location.origin}/m/${agent.slug}/${convId.current}`);
  }, [agent.slug]);

  // Live-sync: while documents are still pending (and nothing local is in
  // flight), poll the conversation so uploads made on a phone via the QR
  // hand-off appear in this panel without a manual refresh.
  useEffect(() => {
    if (!convId.current || pendingDocCount === 0 || streaming || uploadingKey) return;
    let alive = true;
    const id = window.setInterval(async () => {
      if (!convId.current) return;
      try {
        const res = await fetch(`/api/conversations/${convId.current}`);
        if (!res.ok) return;
        const data = await res.json();
        if (alive && data.case) setCaseState(data.case);
      } catch {
        /* transient */
      }
    }, 4000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [pendingDocCount, streaming, uploadingKey]);

  // Host site can push/refresh the UAE PASS session token at any time.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const m = e.data as { source?: string; uaePassToken?: string };
      if (m?.source === "dialog-host" && typeof m.uaePassToken === "string") uaePass.current = m.uaePassToken;
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  // Resume a prior session for this agent (PRD: partial-application retention).
  useEffect(() => {
    const saved =
      initialConversationId ??
      (typeof window !== "undefined" ? window.localStorage.getItem(storageKey) : null);
    if (!saved) { setResumed(true); return; }
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
      } finally {
        setResumed(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle the return from UAE PASS sign-in (we redirect back to the chat here).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const status = params.get("uaepass");
    if (!status) return;
    if (status === "ok") {
      // Signed in via UAE PASS — reflect it and pin the conversation the callback
      // attached the session to, so the next message continues authenticated.
      setAuthenticated(true);
      setAuthReason(null);
      const cid = params.get("cid");
      if (cid) {
        convId.current = cid;
        try { window.localStorage.setItem(storageKey, cid); } catch { /* ignore */ }
      }
      // Fire the proactive account pulse once resume has settled.
      setSignedInPulse(true);
    } else if (status === "cancelled") setAuthReason(locale === "ar" ? "تم إلغاء تسجيل الدخول." : "Sign-in was cancelled.");
    else if (status === "error" || status === "invalid_state")
      setAuthReason(locale === "ar" ? "تعذّر إكمال تسجيل الدخول. حاول مرة أخرى." : "Sign-in could not be completed. Please try again.");
    // Clean the status param from the URL (keep cid for resume).
    params.delete("uaepass");
    const qs = params.toString();
    window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streaming]);

  // Reset: start a brand-new conversation (clears the view + the persisted session).
  const resetChat = useCallback(() => {
    if (streaming) return;
    try { window.localStorage.removeItem(storageKey); } catch { /* ignore */ }
    convId.current = null;
    setMessages([]);
    setCaseState(null);
    setInput("");
    setAuthReason(null);
    setAuthenticated(false);
  }, [streaming, storageKey]);

  // Sign-in: real UAE PASS OIDC when configured, else the dev mock toggle.
  // UAE PASS forbids being framed, so from the embedded widget it opens in a
  // centered popup; the callback posts the result back and the chat continues in
  // place. Falls back to a full redirect if the popup is blocked.
  const signIn = useCallback(() => {
    if (agent.uaePassEnabled && typeof window !== "undefined") {
      const base =
        `/api/uaepass/login?agent=${encodeURIComponent(agent.slug)}` +
        `&cid=${encodeURIComponent(convId.current ?? "")}`;
      const w = 480;
      const h = 720;
      const left = Math.max(0, Math.round(((window.screen?.width ?? w) - w) / 2));
      const top = Math.max(0, Math.round(((window.screen?.height ?? h) - h) / 2));
      const win = window.open(`${base}&popup=1`, "dlg-uaepass", `popup=yes,width=${w},height=${h},left=${left},top=${top}`);
      if (!win) {
        const returnTo = window.location.href.split("?")[0] ?? window.location.href;
        window.location.href = `${base}&returnTo=${encodeURIComponent(returnTo)}`;
      }
    } else {
      setAuthenticated(true);
      setAuthReason(null);
    }
  }, [agent.uaePassEnabled, agent.slug]);

  // Result of the popup sign-in, posted by the callback page.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const m = e.data as { source?: string; status?: string; cid?: string | null };
      if (m?.source !== "dialog-uaepass") return;
      if (m.status === "ok") {
        setAuthenticated(true);
        setAuthReason(null);
        if (m.cid) {
          convId.current = m.cid;
          try { window.localStorage.setItem(storageKey, m.cid); } catch { /* ignore */ }
        }
        setSignedInPulse(true);
      } else if (m.status === "cancelled") {
        setAuthReason(locale === "ar" ? "تم إلغاء تسجيل الدخول." : "Sign-in was cancelled.");
      } else {
        setAuthReason(locale === "ar" ? "تعذّر إكمال تسجيل الدخول. حاول مرة أخرى." : "Sign-in could not be completed. Please try again.");
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [storageKey, locale]);

  const toggleFull = useCallback(() => {
    setFull((prev) => {
      postToParent(prev ? "collapse" : "expand");
      return !prev;
    });
  }, []);

  const send = useCallback(async (override?: string, opts?: { proactive?: boolean; paymentSettled?: boolean }) => {
    const proactive = opts?.proactive ?? false;
    const paymentSettled = opts?.paymentSettled ?? false;
    const silent = proactive || paymentSettled;
    const text = silent ? "" : (override ?? input).trim();
    if (streaming) return;
    if (!silent && !text) return;
    if (!silent) setInput("");
    setAuthReason(null);
    // Silent turns (post-sign-in account pulse, payment settled) add no user
    // bubble — only the assistant's response is shown.
    setMessages((prev) => [
      ...prev,
      ...(silent ? [] : [{ role: "user" as const, content: text }]),
      { role: "assistant" as const, content: "", citations: [] },
    ]);
    setStreaming(true);
    setToolStatus(null);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentSlug: agent.slug,
          userMessage: proactive ? "account_pulse" : paymentSettled ? "payment_settled" : text,
          pulse: proactive || undefined,
          paymentSettled: paymentSettled || undefined,
          conversationId: convId.current ?? undefined,
          locale,
          authenticated,
          uaePassToken: uaePass.current,
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
          if (ev.delta) setToolStatus(null); // real text is arriving — drop the status
          // Pure updater: never mutate the previous message object — StrictMode
          // double-invokes updaters, and a mutation would append the delta twice.
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (!last) return prev;
            const next = prev.slice();
            next[next.length - 1] = { ...last, content: last.content + ev.delta };
            return next;
          });
        } else if (ev.type === "integration" || ev.type === "lookup") {
          setToolStatus(toolStatusLabel(ev, locale === "ar"));
        } else if (ev.type === "payment_initiated") {
          // Attach the secure payment card to the assistant message being streamed.
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (!last) return prev;
            const next = prev.slice();
            next[next.length - 1] = {
              ...last,
              payment: { reference: ev.reference, link: ev.link, amount: ev.amount, currency: ev.currency },
            };
            return next;
          });
        } else if (ev.type === "case") {
          setCaseState(ev.state);
        } else if (ev.type === "citation") {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (!last || last.citations?.includes(ev.source)) return prev;
            const next = prev.slice();
            next[next.length - 1] = { ...last, citations: [...(last.citations ?? []), ev.source] };
            return next;
          });
        } else if (ev.type === "auth_required") {
          setAuthReason(ev.reason);
        } else if (ev.type === "error") {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (!last) return prev;
            const next = prev.slice();
            next[next.length - 1] = { ...last, content: `${last.content}\n\n⚠ ${ev.message}` };
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
        const last = prev[prev.length - 1];
        if (!last) return prev;
        const next = prev.slice();
        next[next.length - 1] = { ...last, content: `${last.content}\n\n⚠ ${err instanceof Error ? err.message : "error"}` };
        return next;
      });
    } finally {
      setStreaming(false);
      setToolStatus(null);
    }
  }, [input, streaming, agent.slug, locale, authenticated, storageKey]);

  // Tap-to-select: clicking an option card sends its title as the customer's
  // choice, so they can pick without typing. Ignored while a turn is streaming.
  const handleCardSelect = useCallback(
    (choice: string) => {
      if (streaming) return;
      void send(choice);
    },
    [streaming, send]
  );

  // After sign-in, once the session has resumed, proactively run the account
  // pulse exactly once (no user bubble — just the assistant's summary).
  useEffect(() => {
    if (signedInPulse && resumed && authenticated && !streaming) {
      setSignedInPulse(false);
      void send(undefined, { proactive: true });
    }
  }, [signedInPulse, resumed, authenticated, streaming, send]);

  // The payment card saw the gateway settle the payment → as soon as no turn is
  // streaming, have the assistant confirm and finish the journey (no user bubble).
  useEffect(() => {
    if (paymentPulse && !streaming) {
      setPaymentPulse(false);
      void send(undefined, { paymentSettled: true });
    }
  }, [paymentPulse, streaming, send]);

  // Stable callback for PaymentCard so its polling effect isn't reset each render.
  const onPaymentPaid = useCallback(() => setPaymentPulse(true), []);

  const fallbackFont = "'SF Pro Display', -apple-system, 'Segoe UI', system-ui, sans-serif";
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
    ["--c-font-body" as string]: agent.theme.bodyFont ? `${agent.theme.bodyFont}, ${fallbackFont}` : agent.theme.fontFamily,
    ["--c-font-heading" as string]: agent.theme.headingFont
      ? `${agent.theme.headingFont}, ${agent.theme.bodyFont ?? ""}, ${fallbackFont}`
      : undefined,
  } as React.CSSProperties;

  const missing = caseState?.readiness.missing ?? [];
  const dataEntries = Object.entries(caseState?.data ?? {});
  // Show the assembled panel as soon as a journey is active and has document
  // slots (so the upload buttons appear immediately when the agent asks for
  // documents), or once any data / document exists. Only a journey with no
  // documents and no data yet falls back to the empty state.
  const hasCase =
    caseState && (dataEntries.length > 0 || caseState.documents.length > 0 || docSlots.length > 0);
  const iconWeight = "regular" as const;

  return (
    <div className={`dlg-root ${full ? "is-full" : ""} ${mobileCaseOpen ? "is-mobile-case" : ""}`} dir={dir} style={rootStyle}>
      <header className="dlg-header">
        <div className="dlg-brand">
          {agent.theme.logoUrl ? (
            <img className="dlg-header-logo" src={agent.theme.logoUrl} alt={agent.theme.brandName || agent.name} />
          ) : (
            <span className="dlg-avatar">
              <ChatsCircle size={19} weight="fill" />
            </span>
          )}
          <span className="dlg-brand-text">
            {!agent.theme.logoUrl && <span className="dlg-brand-name">{agent.theme.brandName || agent.name}</span>}
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
              <GlobeSimple size={16} weight={iconWeight} />
              <span className="dlg-chip-tag">{locale === "ar" ? "EN" : "عربي"}</span>
            </button>
          ) : null}
          <button
            className={`dlg-chip icon-only ${authenticated ? "is-on" : ""}`}
            onClick={() => {
              if (authenticated) { setAuthenticated(false); setAuthReason(null); }
              else signIn();
            }}
            aria-label={authenticated ? t.signedIn : t.signIn}
            title={authenticated ? t.signedIn : t.signIn}
          >
            {authenticated ? <UserCircleCheck size={17} weight="fill" /> : <SignIn size={16} weight={iconWeight} />}
          </button>
          <button
            className="dlg-chip icon-only"
            onClick={resetChat}
            disabled={streaming || (messages.length === 0 && !caseState)}
            aria-label={t.reset}
            title={t.reset}
          >
            <ArrowClockwise size={16} weight={iconWeight} />
          </button>
          {hasCase ? (
            <button
              className="dlg-chip dlg-mobile-toggle"
              onClick={() => setMobileCaseOpen((v) => !v)}
              aria-label={t.caseTab}
              title={t.caseTab}
            >
              <ListChecks size={16} weight={iconWeight} />
              {pendingDocCount > 0 ? <span className="count">{pendingDocCount}</span> : null}
            </button>
          ) : null}
          <button className="dlg-chip icon-only expand-toggle" onClick={toggleFull} aria-label={full ? t.collapse : t.expand}>
            {full ? <ArrowsInSimple size={16} weight={iconWeight} /> : <ArrowsOutSimple size={16} weight={iconWeight} />}
          </button>
          <button className="dlg-chip icon-only danger" onClick={() => postToParent("close")} aria-label="Close">
            <X size={16} weight={iconWeight} />
          </button>
        </div>
      </header>

      <div className="dlg-split">
        {/* LEFT: conversation */}
        <section className="dlg-chat">
          <div className="dlg-messages" ref={scrollRef}>
            <div className="dlg-msg assistant">
              <span className="dlg-orb" aria-hidden="true" />
              <div className="dlg-bubble"><Markdown text={tr(agent.greeting, locale)} /></div>
            </div>
            {messages.length === 0 && starters.length > 0 ? (
              <div className="dlg-starters">
                <span className="dlg-starters-label">{t.askAnything}</span>
                <div className="dlg-starters-grid">
                  {starters.map((s, si) => (
                    <button
                      key={s.key}
                      className="dlg-starter"
                      style={{ ["--i" as string]: si }}
                      onClick={() => void send(s.label)}
                      disabled={streaming}
                    >
                      <span>{s.label}</span>
                      <ArrowRight size={14} weight="bold" />
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {messages.map((m, i) => (
              <div key={i} className={`dlg-msg ${m.role}`}>
                {m.role === "assistant" ? (
                  <span className="dlg-orb" aria-hidden="true" />
                ) : null}
                <div className="dlg-bubble">
                  {m.content ? (
                    m.role === "assistant" ? (
                      <TypewriterMarkdown text={m.content} animate={streaming && i === messages.length - 1} onSelect={handleCardSelect} />
                    ) : (
                      m.content
                    )
                  ) : null}
                  {streaming && i === messages.length - 1
                    ? toolStatus ? (
                        // Shows during a silent tool round — as a standalone line on an
                        // empty bubble, or a trailing line under an in-progress reply.
                        <span className={`dlg-tool-status${m.content ? " trailing" : ""}`}>
                          <span className="dlg-tool-spinner" />
                          {toolStatus}
                        </span>
                      ) : !m.content ? (
                        <span className="dlg-typing">
                          <span />
                          <span />
                          <span />
                        </span>
                      ) : null
                    : null}
                  {m.payment ? (
                    <PaymentCard
                      payment={m.payment}
                      conversationId={convId.current}
                      strings={t}
                      locale={locale}
                      onPaid={onPaymentPaid}
                    />
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
              <button className="dlg-chip" onClick={signIn}>
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
            <div className="dlg-input-hint" aria-hidden="true">
              <span>{t.poweredBy}</span>
              <span className="sep" />
              <span>{t.enterToSend}</span>
            </div>
          </div>
        </section>

        {/* RIGHT: realtime case builder */}
        <aside className="dlg-case">
          <div className="dlg-case-inner">
            <div className="dlg-case-head">
              <button className="dlg-back-chat" onClick={() => setMobileCaseOpen(false)} aria-label={t.backToChat}>
                <CaretLeft size={14} weight="bold" /> {t.backToChat}
              </button>
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
                    {agent.documentsDisclaimer ? (
                      <div className="dlg-doc-disclaimer">
                        <Info size={15} weight="fill" />
                        <span>{tr(agent.documentsDisclaimer, locale)}</span>
                      </div>
                    ) : null}
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
                              <div className="dlg-upload-group">
                                {/* Camera capture — only visible on touch devices (FB-6, mobile). */}
                                <label className="dlg-upload cam" title={t.takePhoto} aria-label={t.takePhoto}>
                                  <Camera size={14} weight="bold" />
                                  <input
                                    type="file"
                                    hidden
                                    disabled={busy}
                                    accept="image/*"
                                    capture="environment"
                                    onChange={(e) => e.target.files?.[0] && uploadDoc(d.key, e.target.files[0])}
                                  />
                                </label>
                                {/* Upload from phone via QR — only on desktop (FB-6, web). */}
                                <button
                                  type="button"
                                  className="dlg-upload-phone"
                                  onClick={openQrHandoff}
                                  title={t.fromPhone}
                                >
                                  <DeviceMobile size={14} weight="bold" /> {t.fromPhone}
                                </button>
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
      {qrUrl ? <QrModal url={qrUrl} strings={t} onClose={() => setQrUrl(null)} /> : null}
    </div>
  );
}
