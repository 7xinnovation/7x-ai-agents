"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PaperPlaneRight,
  GlobeSimple,
  SignIn,
  UserCircleCheck,
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
  ArrowsOutSimple,
  ArrowsInSimple,
  Camera,
  DeviceMobile,
  Info,
  CaretLeft,
  PencilSimple,
  Check,
  X,
} from "@phosphor-icons/react";
import QRCode from "qrcode";
import { tr, type CaseState, type Locale } from "@dialog/config";
import { Microphone } from "@phosphor-icons/react";
import { Markdown, TypewriterMarkdown, type UploadCtx } from "./Markdown";
import { useVoiceChat } from "./useVoiceChat";
import type { PublicAgent } from "./types";
import { showSurvey } from "./customerPulse";
import { openExternal, isNative, postNative, nativeToken, nativeHandoff, type ExternalWindow } from "./nativeBridge";

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
    case: "Your application",
    emptyTitle: "Nothing to assemble yet",
    emptyBody: "As we talk, your application takes shape here: details, documents, and what's left.",
    missing: "Submission readiness",
    ready: "Ready to submit",
    readyShort: "ready",
    reference: "Reference",
    receipt: "Download receipt",
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
    uploaded: "Uploaded",
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
    caseTab: "Your application",
    backToChat: "Back to chat",
    caseStatus: { draft: "Draft", ready: "Ready", submitted: "Submitted", escalated: "Escalated" } as Record<string, string>,
    docStatus: { pending: "pending", uploaded: "uploaded", rejected: "rejected", accepted: "accepted" } as Record<string, string>,
    missingKind: { field: "field", document: "document" } as Record<string, string>,
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
    receipt: "تحميل الإيصال",
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
    uploaded: "تم الرفع",
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
    caseStatus: { draft: "مسودة", ready: "جاهز", submitted: "تم الإرسال", escalated: "محوّل لموظف" } as Record<string, string>,
    docStatus: { pending: "قيد الانتظار", uploaded: "تم الرفع", rejected: "مرفوض", accepted: "مقبول" } as Record<string, string>,
    missingKind: { field: "حقل", document: "مستند" } as Record<string, string>,
  },
} as const;


/**
 * Render a captured value for the application panel. Dates are stored ISO
 * (YYYY-MM-DD) but must always be SHOWN as DD-MM-YYYY (FB-1439), including any
 * ISO timestamp the backend returned, so the panel never contradicts the chat.
 */
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/;
export function displayValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  const s = String(v);
  const m = s.match(ISO_DATE_RE);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s;
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
  const popupRef = useRef<ExternalWindow | null>(null);
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
    // In a WebView the native host opens it; polling picks the result up either
    // way, so nothing here waits on the window itself.
    popupRef.current = openExternal(payment.link, { name: "dlg-pay", kind: "payment" });
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
          // Close the gateway window ourselves. It ends on "Thank you, your
          // payment has been received" with a Return to basket button that has no
          // basket to return to, so the customer is left looking at a finished
          // payment page while the conversation has already moved on behind it.
          try { popupRef.current?.close(); } catch { /* already gone, or blocked */ }
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
  embedded,
}: {
  agent: PublicAgent;
  initialLocale: Locale;
  initialConversationId?: string;
  uaePassToken?: string;
  /** Rendered inside the launcher iframe, so the host can be asked to expand. */
  embedded?: boolean;
}) {
  const uaePass = useRef<string | undefined>(uaePassToken);
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [caseState, setCaseState] = useState<CaseState | null>(null);

  /**
   * Tell a native host when the customer has actually finished.
   *
   * The wrapper exposes an onCompleted callback, and without this nothing ever
   * called it -- an app could not tell a completed rental from an abandoned one
   * except by watching the conversation. Fired once per reference: the case is
   * re-read on later turns and would otherwise repeat.
   */
  const announced = useRef<string | null>(null);
  useEffect(() => {
    const reference = caseState?.reference;
    if (!reference || caseState?.status !== "submitted") return;
    if (announced.current === reference) return;
    announced.current = reference;
    postNative({ action: "completed", reference, journey: caseState?.journeyKey ?? null });
  }, [caseState?.reference, caseState?.status, caseState?.journeyKey]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  /** Host sign-in popup, so a window closed without a token can be reported. */
  const hostLoginWin = useRef<ExternalWindow | null>(null);
  const [authReason, setAuthReason] = useState<string | null>(null);
  // Friendly "what the assistant is doing" line shown during silent tool rounds.
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  // Resume completion + a one-shot flag to fire the account pulse after sign-in.
  const [resumed, setResumed] = useState(false);
  const [signedInPulse, setSignedInPulse] = useState(false);
  /** Latches the post-sign-in pulse to one per conversation. */
  const pulsed = useRef(false);
  // One-shot flag: the in-chat payment card saw the webhook settle → have the
  // assistant confirm + continue as soon as no turn is streaming.
  const [paymentPulse, setPaymentPulse] = useState(false);
  const [uploadingKeys, setUploadingKeys] = useState<Set<string>>(() => new Set());
  const [full] = useState(false);
  // Mobile (feedback FB-5): the case panel is a full-screen overlay toggled here.
  const [mobileCaseOpen, setMobileCaseOpen] = useState(false);
  // QR hand-off modal (feedback FB-6): the mobile upload URL currently shown.
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  // Voice mode is a client-only capability; gate the button after mount to avoid
  // an SSR/client hydration mismatch.
  const [voiceReady, setVoiceReady] = useState(false);
  useEffect(() => setVoiceReady(true), []);
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
  // A greeting that carries its own ```buttons service list (FB-1434) replaces
  // the starter grid — showing both would duplicate the same options.
  const greetingHasButtons = useMemo(() => /```\s*buttons/.test(tr(agent.greeting, locale)), [agent, locale]);

  // Inline correction of captured values (feedback FB-1325): text-like fields of
  // the ACTIVE journey get a pencil; consents/timestamps stay locked.
  // FB-1566: a journey may narrow this to the fields it marks `editable` — the
  // customer's own contact details — leaving document-sourced values read-only.
  // Journeys that mark nothing keep the original every-text-field behaviour.
  const editableKeys = useMemo(() => {
    const set = new Set<string>();
    const j = agent.journeys.find((x) => x.key === caseState?.journeyKey);
    const fields = (j?.steps ?? []).flatMap((s) => s.fields);
    const curated = fields.some((f) => f.editable !== undefined);
    for (const f of fields) {
      if (f.type === "boolean" || /(_consent|_accepted|_acknowledged)(_at)?$/.test(f.key)) continue;
      if (curated ? f.editable === true : true) set.add(f.key);
    }
    return set;
  }, [agent, caseState?.journeyKey]);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editVal, setEditVal] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const saveEdit = useCallback(async () => {
    if (!editKey || !convId.current || editBusy) return;
    setEditBusy(true);
    try {
      // Dates are shown and edited as DD-MM-YYYY (FB-1439) but stored ISO.
      const dmy = editVal.trim().match(/^(\d{2})-(\d{2})-(\d{4})$/);
      const value = dmy ? `${dmy[3]}-${dmy[2]}-${dmy[1]}` : editVal;
      const res = await fetch("/api/case/field", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentSlug: agent.slug, conversationId: convId.current, key: editKey, value }),
      });
      const json = await res.json();
      if (res.ok && json.case) {
        setCaseState(json.case);
        setEditKey(null);
      }
    } catch {
      /* keep the editor open so the user can retry */
    } finally {
      setEditBusy(false);
    }
  }, [editKey, editVal, editBusy, agent.slug]);

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

  // Full requirements checklist (feedback FB-1437: completed items must STAY
  // visible, marked done — not vanish from the list once satisfied).
  const checklist = useMemo(() => {
    if (!caseState?.journeyKey) return [];
    const j = agent.journeys.find((x) => x.key === caseState.journeyKey);
    if (!j) return [];
    const missingSet = new Set(caseState.readiness.missing.map((m) => `${m.kind}:${m.key}`));
    const items: { kind: "field" | "document"; key: string; done: boolean }[] = [];
    for (const s of j.steps) {
      for (const f of s.fields) if (f.required) items.push({ kind: "field", key: f.key, done: !missingSet.has(`field:${f.key}`) });
      for (const d of s.documents)
        if (d.requirement === "mandatory" && docApplies(d.condition))
          items.push({ kind: "document", key: d.key, done: !missingSet.has(`document:${d.key}`) });
    }
    return items;
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
  const pendingDocKeys = useMemo(
    () => docSlots.filter((d) => d.status !== "uploaded" && d.status !== "accepted").map((d) => d.key),
    [docSlots]
  );
  const pendingDocCount = pendingDocKeys.length;

  // Uploads may overlap: the customer picks the trade licence and, while the
  // vision model is still reading it, picks the MOA. Both are legitimate, so
  // both are tracked, and the case is only applied by whichever finishes LAST —
  // an earlier response describes the case before the other document existed,
  // and applying it after would make that document vanish from the panel.
  const inflightUploads = useRef(0);
  const uploadDoc = useCallback(
    async (key: string, file: File) => {
      if (!convId.current) return;
      inflightUploads.current += 1;
      setUploadingKeys((prev) => new Set(prev).add(key));
      try {
        const fd = new FormData();
        fd.append("agentSlug", agent.slug);
        fd.append("conversationId", convId.current);
        fd.append("key", key);
        fd.append("file", file);
        const res = await fetch("/api/upload", { method: "POST", body: fd });
        const json = await res.json();
        inflightUploads.current -= 1;
        // Still uploading something else? That request commits after this one
        // and its response will carry both documents — let it do the update.
        if (json.case && inflightUploads.current === 0) setCaseState(json.case);
      } catch {
        inflightUploads.current = Math.max(0, inflightUploads.current - 1);
      } finally {
        setUploadingKeys((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [agent.slug]
  );

  // Open the QR hand-off for the current conversation (feedback FB-6, web →
  // phone). The mobile page keys off agent slug + conversation id.
  const openQrHandoff = useCallback(() => {
    if (!convId.current || typeof window === "undefined") return;
    setQrUrl(`${window.location.origin}/m/${agent.slug}/${convId.current}`);
  }, [agent.slug, storageKey]);

  // Context for in-chat upload widgets (feedback: keep the upload in the chat).
  // A ```upload block in an assistant message renders a control for that doc key.
  const uploadCtx = useMemo<UploadCtx>(() => {
    const docs: UploadCtx["docs"] = {};
    for (const j of agent.journeys)
      for (const s of j.steps)
        for (const d of s.documents)
          docs[d.key] = { label: d.label, requirement: d.requirement, acceptedFormats: d.acceptedFormats, maxSizeMb: d.maxSizeMb };
    const statuses: UploadCtx["statuses"] = {};
    for (const d of caseState?.documents ?? [])
      statuses[d.key] = { status: d.status, fileName: d.fileName, rejectionReason: d.rejectionReason };
    return {
      locale,
      docs,
      statuses,
      uploadingKeys,
      pendingDocs: pendingDocKeys,
      maxUploads: agent.uploadsPerMessage,
      onUpload: uploadDoc,
      onQr: openQrHandoff,
      strings: {
        upload: t.upload, uploading: t.uploading, replace: t.replace, optional: t.optional,
        upTo: t.upTo, takePhoto: t.takePhoto, fromPhone: t.fromPhone, uploaded: t.uploaded,
      },
    };
  }, [agent, caseState, locale, uploadingKeys, pendingDocKeys, uploadDoc, openQrHandoff, t]);

  // Live-sync: while documents are still pending (and nothing local is in
  // flight), poll the conversation so uploads made on a phone via the QR
  // hand-off appear in this panel without a manual refresh.
  useEffect(() => {
    if (!convId.current || pendingDocCount === 0 || streaming || uploadingKeys.size) return;
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
  }, [pendingDocCount, streaming, uploadingKeys]);

  /**
   * Ask the host page to give the widget the full window, and back again.
   *
   * The loader has always handled these messages; nothing ever sent one, so the
   * split view with the application panel was unreachable from inside the
   * iframe. Targeted at the referrer's origin rather than "*" — the action is
   * not sensitive, but a message broadcast to every frame is a habit worth not
   * forming.
   */
  const [expanded, setExpanded] = useState(false);
  const toggleExpanded = useCallback(() => {
    const next = !expanded;
    setExpanded(next);
    let target = "*";
    try {
      if (document.referrer) target = new URL(document.referrer).origin;
    } catch {
      /* keep "*" */
    }
    window.parent?.postMessage({ source: "dialog", action: next ? "expand" : "collapse" }, target);
  }, [expanded]);

  // Host site can push/refresh the UAE PASS session token at any time.
  //
  // `source: "dialog-host"` is a convention, not a credential — any frame can put
  // that string in a message. So the sender's ORIGIN is checked against the
  // agent's allowedOrigins before the token is taken. The token is still verified
  // server-side on every turn (lib/hostToken); this just stops an unrelated page
  // from feeding us one at all.
  //
  // With allowedOrigins unset the check cannot be made, so no token is accepted —
  // an agent that has not been told who may embed it has no way to know whose
  // message this is. Configure allowedOrigins for any agent using the handoff.
  const allowedOrigins = agent.allowedOrigins ?? [];
  useEffect(() => {
    const permitted = new Set(
      allowedOrigins
        .map((o: string) => {
          try {
            return new URL(o).origin;
          } catch {
            return "";
          }
        })
        .filter(Boolean)
    );
    const onMsg = (e: MessageEvent) => {
      const m = e.data as { source?: string; uaePassToken?: string };
      if (m?.source !== "dialog-host" || typeof m.uaePassToken !== "string") return;
      if (!permitted.has(e.origin)) return;
      const token = m.uaePassToken;
      uaePass.current = token;
      // Reflect the sign-in now rather than at the next message. The token is
      // verified SERVER-side before the UI changes -- a host that hands us junk
      // leaves the widget signed out, which is the honest outcome.
      void (async () => {
        try {
          const res = await fetch("/api/uaepass/host", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ agent: agent.slug, token, cid: convId.current ?? undefined }),
          });
          if (!res.ok) return;
          setAuthenticated(true);
          setAuthReason(null);
          setSignedInPulse(true);
          // Close the sign-in popup ourselves. It is cross-origin, so we cannot
          // watch it for a "done" signal and the host has no reason to close a
          // window it did not open -- when already signed in their login URL just
          // lands in the portal and sits there. A window opened by script may be
          // closed by script, so the arriving token IS the completion signal.
          try {
            hostLoginWin.current?.close();
          } catch {
            /* already gone, or refused -- nothing useful to do either way */
          }
          hostLoginWin.current = null;
        } catch {
          /* leave signed out; the next chat turn re-verifies the same token */
        }
      })();
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [allowedOrigins]);

  /**
   * The same handover, from a native app instead of a hosting page.
   *
   * A WebView has no parent frame to postMessage from and no allowedOrigins to
   * check -- the app IS the trusted host, and it reaches the page by setting a
   * global before our scripts run. What does not change is that the token is
   * verified SERVER-side here before the customer is treated as signed in, so a
   * bad one leaves them a guest rather than half signed in.
   */
  useEffect(() => {
    // Preferred: a handoff code. The app has already exchanged the real token
    // with us from native code, so there is nothing here worth stealing -- this
    // only says which conversation is already signed in.
    const handoff = nativeHandoff();
    if (handoff) {
      void (async () => {
        try {
          const res = await fetch("/api/embed/handoff", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ agent: agent.slug, handoff }),
          });
          if (!res.ok) return;
          const data = (await res.json()) as { conversationId?: string };
          if (data.conversationId) {
            convId.current = data.conversationId;
            try { window.localStorage.setItem(storageKey, data.conversationId); } catch { /* private mode */ }
          }
          setAuthenticated(true);
          setAuthReason(null);
          setSignedInPulse(true);
        } catch {
          /* leave signed out; the customer can still sign in from here */
        }
      })();
      return;
    }
    const token = nativeToken();
    if (!token || uaePass.current) return;
    uaePass.current = token;
    void (async () => {
      try {
        const res = await fetch("/api/uaepass/host", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agent: agent.slug, token, cid: convId.current ?? undefined }),
        });
        if (!res.ok) return;
        setAuthenticated(true);
        setAuthReason(null);
        setSignedInPulse(true);
      } catch {
        /* leave signed out; the next chat turn re-verifies the same token */
      }
    })();
  }, [agent.slug]);

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
    pulsed.current = false;
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
    // The host portal owns sign-in (its own UAE PASS client, its own registered
    // callback). Opening it in a POPUP rather than navigating keeps the
    // conversation alive; the token then arrives from the embed loader, which sees
    // the host's localStorage write because it runs first-party on that page.
    if (agent.hostLoginUrl && typeof window !== "undefined") {
      const win = openExternal(agent.hostLoginUrl, { name: "dlg-host-login", kind: "signin" });
      if (!win) {
        setAuthReason(
          locale === "ar"
            ? "يرجى السماح بالنوافذ المنبثقة لتسجيل الدخول، ثم المحاولة مرة أخرى."
            : "Please allow pop-ups to sign in, then try again."
        );
        return;
      }
      hostLoginWin.current = win;
      setAuthReason(null);
      return;
    }
    if (agent.uaePassEnabled && typeof window !== "undefined") {
      // Pass the embed's own URL so the server returns the user (and targets the
      // popup postMessage) at this exact origin — never the server's internal one.
      const returnTo = window.location.href.split("?")[0] ?? window.location.href;
      // Tester opt-in: opening the embed with ?mock=1 makes the UAE PASS button
      // simulate a login (only honoured where the server permits it). Real users on
      // the plain URL always get genuine UAE PASS.
      const mock = new URLSearchParams(window.location.search).get("mock") === "1" ? "&mock=1" : "";
      const base =
        `/api/uaepass/login?agent=${encodeURIComponent(agent.slug)}` +
        `&cid=${encodeURIComponent(convId.current ?? "")}` +
        `&returnTo=${encodeURIComponent(returnTo)}${mock}`;
      const win = openExternal(`${base}&popup=1`, { name: "dlg-uaepass", kind: "signin" });
      // Nothing opened, and only a browser can fall back by navigating itself:
      // in a WebView that would replace the conversation with a login page.
      if (!win && !isNative()) window.location.href = base;
    } else {
      setAuthenticated(true);
      setAuthReason(null);
    }
  }, [agent.uaePassEnabled, agent.hostLoginUrl, agent.slug, locale]);

  /**
   * The host sign-in popup closed. If no token reached us, say so instead of
   * leaving the customer looking at a button that appears to have done nothing.
   *
   * The token can land a moment after the window closes (the loader polls the
   * host's localStorage every 2s), so allow a grace period before reporting a
   * failure -- otherwise a successful sign-in is announced as a failed one.
   */
  useEffect(() => {
    if (authenticated) return;
    const id = setInterval(() => {
      const win = hostLoginWin.current;
      if (!win || !win.closed) return;
      hostLoginWin.current = null;
      setTimeout(() => {
        if (uaePass.current) return;
        setAuthReason(
          locale === "ar"
            ? "لم يكتمل تسجيل الدخول. حاول مرة أخرى."
            : "Sign-in did not complete. Please try again."
        );
      }, 3000);
    }, 700);
    return () => clearInterval(id);
  }, [authenticated, locale]);

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


  const send = useCallback(async (override?: string, opts?: { proactive?: boolean; paymentSettled?: boolean; documentUploaded?: boolean }) => {
    const proactive = opts?.proactive ?? false;
    const paymentSettled = opts?.paymentSettled ?? false;
    const documentUploaded = opts?.documentUploaded ?? false;
    const silent = proactive || paymentSettled || documentUploaded;
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
          userMessage: proactive ? "account_pulse" : paymentSettled ? "payment_settled" : documentUploaded ? "document_uploaded" : text,
          pulse: proactive || undefined,
          paymentSettled: paymentSettled || undefined,
          documentUploaded: documentUploaded || undefined,
          conversationId: convId.current ?? undefined,
          locale,
          authenticated,
          uaePassToken: uaePass.current,
          // Tester opt-in (?mock=1): let the server simulate the EP ops that can't
          // run in the demo (honoured only when the server allows mock).
          mock: typeof window !== "undefined" && new URLSearchParams(window.location.search).get("mock") === "1",
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
        } else if (ev.type === "survey") {
          // Customer Pulse, after a completed purchase. Fire and forget: the
          // server decided the purchase is real, and nothing in the chat waits
          // on whether the survey opens.
          void showSurvey(ev.token, ev.locale ?? locale, Boolean(ev.sandbox));
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

  // Voice mode: speak the assistant's replies and turn the customer's speech into
  // chat messages (see useVoiceChat). Layered on the normal chat, not a separate
  // agent — voice input goes through the same send().
  const voice = useVoiceChat({ agentSlug: agent.slug, locale, messages, streaming, send: (t) => void send(t) });

  // Tap-to-select: clicking an option card sends its title as the customer's
  // choice, so they can pick without typing. Ignored while a turn is streaming.
  const handleCardSelect = useCallback(
    (choice: string) => {
      if (streaming) return;
      void send(choice);
    },
    [streaming, send]
  );

  // In-chat documents flow: when a new document lands (uploaded in the chat or via
  // the phone QR hand-off), fire one proactive turn so the agent confirms what was
  // captured and asks for the next document. Server-side rejections (bad format,
  // expired Emirates ID) fire it too, so the agent explains and asks for a valid
  // document instead of the rejection sitting silently in the widget. A baseline
  // is taken on first load so resuming a conversation with prior uploads never
  // triggers it.
  const uploadedBaseline = useRef<{ up: number; rej: number } | null>(null);
  const pendingDocNotify = useRef(false);
  useEffect(() => {
    if (!resumed || !agent.documentsInChat) return;
    const docs = caseState?.documents ?? [];
    const up = docs.filter((d) => d.status === "uploaded" || d.status === "accepted").length;
    const rej = docs.filter((d) => d.status === "rejected").length;
    if (uploadedBaseline.current === null) {
      uploadedBaseline.current = { up, rej }; // establish baseline, do not fire
      return;
    }
    const grew = up > uploadedBaseline.current.up || rej > uploadedBaseline.current.rej;
    uploadedBaseline.current = { up, rej };
    // A document that lands mid-turn must not be swallowed: dropping the
    // notification is why a second upload could complete and still be asked for
    // again. Remember it and fire once the current turn finishes.
    if (grew) pendingDocNotify.current = true;
    if (pendingDocNotify.current && !streaming) {
      pendingDocNotify.current = false;
      void send(undefined, { documentUploaded: true });
    }
  }, [caseState, resumed, agent.documentsInChat, streaming, send]);

  // After sign-in, once the session has resumed, proactively run the account
  // pulse exactly once (no user bubble — just the assistant's summary).
  //
  // "Once" needs a latch, not just the flag. Three different things signal a
  // completed sign-in — the popup's postMessage, the redirect return, and the
  // host handing us a token — and the Emirates Post flow fires two of them. Each
  // set the flag again after the previous pulse had finished streaming, so the
  // customer got their account read out to them twice, twenty seconds apart.
  useEffect(() => {
    if (signedInPulse && resumed && authenticated && !streaming) {
      setSignedInPulse(false);
      if (pulsed.current) return;
      pulsed.current = true;
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
  // Internal bookkeeping keys (extraction provenance etc.) never render.
  const dataEntries = Object.entries(caseState?.data ?? {}).filter(([k]) => !k.startsWith("__"));
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
          {/* Once signed in this is a STATUS indicator, not a toggle (FB-1485): a
              single tap used to flip the client back to guest while the server kept
              the verified session, so the customer was told to sign in again
              mid-conversation. Starting a new chat is how a session is dropped. */}
          <button
            className={`dlg-chip icon-only ${authenticated ? "is-on" : ""}`}
            onClick={() => { if (!authenticated) signIn(); }}
            aria-disabled={authenticated || undefined}
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
          {embedded ? (
            <button
              className="dlg-chip icon-only"
              onClick={toggleExpanded}
              aria-label={expanded ? t.collapse : t.expand}
              title={expanded ? t.collapse : t.expand}
            >
              {expanded ? <ArrowsInSimple size={16} weight={iconWeight} /> : <ArrowsOutSimple size={16} weight={iconWeight} />}
            </button>
          ) : null}
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
        </div>
      </header>

      <div className="dlg-split">
        {/* LEFT: conversation */}
        <section className="dlg-chat">
          {/* Progress sits ABOVE the conversation, not in the side panel.
              Emirates Post asked for it where the customer is actually looking:
              on a phone the panel is a tab they have to leave the chat to see,
              so the one thing telling them how far through they are was the one
              thing out of sight. */}
          {progress && agent.progressPlacement === "top" ? (
            <div className="dlg-progress-top" role="status" aria-live="polite">
              <div className="dlg-progress-top-row">
                <span className="dlg-progress-step">{progress.pct === 100 ? t.ready : t.missing}</span>
                <span className="dlg-progress-count">
                  <strong>{progress.pct}%</strong>
                  <span className="sep">·</span>
                  {progress.done}/{progress.total} {t.readyShort}
                </span>
              </div>
              <div className="dlg-progress-track">
                <div
                  className={`dlg-progress-fill ${progress.pct === 100 ? "done" : ""}`}
                  style={{ width: `${progress.pct}%` }}
                />
              </div>
              {/* The requirements themselves, beside the bar rather than in the
                  side panel. A percentage says how far along they are; only the
                  list says what is actually LEFT, and that was the half they had
                  to leave the conversation to read. Completed items stay and stay
                  ticked (FB-1437) — the list is the whole set, not the remainder. */}
              {checklist.length ? (
                <div className="dlg-progress-checks">
                  {checklist.map((m) => (
                    <span
                      className={`dlg-progress-check ${m.done ? "done" : "todo"}`}
                      key={`${m.kind}:${m.key}`}
                      title={labelMap.get(m.key) ?? m.key}
                    >
                      {m.done ? <CheckCircle size={12} weight="fill" /> : <Circle size={12} weight={iconWeight} />}
                      {labelMap.get(m.key) ?? m.key}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="dlg-messages" ref={scrollRef}>
            <div className="dlg-msg assistant">
              <span className="dlg-orb" aria-hidden="true" />
              {/* Greeting gets onSelect so a ```buttons service list in it is
                  tappable (feedback FB-1434: structured options, not prose). */}
              <div className="dlg-bubble"><Markdown text={tr(agent.greeting, locale)} onSelect={messages.length === 0 && !streaming ? handleCardSelect : undefined} /></div>
            </div>
            {messages.length === 0 && starters.length > 0 && !greetingHasButtons ? (
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
                      <TypewriterMarkdown text={m.content} animate={streaming && i === messages.length - 1} onSelect={handleCardSelect} uploadCtx={uploadCtx} />
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
            {voice.active ? (
              <div className={`dlg-voice-bar${voice.error ? " is-error" : voice.speaking ? " is-speaking" : voice.listening ? " is-listening" : ""}`}>
                <span className="dlg-voice-bar-dot" />
                <span>{voice.error ? voice.error : voice.connecting ? "Connecting…" : voice.speaking ? "Speaking…" : voice.listening ? "Listening…" : "Voice on"}</span>
                <button type="button" className="dlg-voice-bar-stop" onClick={voice.toggle}>Turn off</button>
              </div>
            ) : null}
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
              {voiceReady && voice.supported ? (
                <button
                  type="button"
                  className={`dlg-mic${voice.active ? " is-on" : ""}${voice.listening ? " is-listening" : ""}${voice.speaking ? " is-speaking" : ""}`}
                  onClick={voice.toggle}
                  aria-label={voice.active ? "Turn off voice mode" : "Turn on voice mode"}
                  title={voice.active ? "Voice mode on" : "Talk to the assistant"}
                >
                  <Microphone size={18} weight={voice.active ? "fill" : iconWeight} />
                </button>
              ) : null}
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
              <button className="dlg-back-chat" onClick={() => setMobileCaseOpen(false)} aria-label={t.backToChat}>
                <CaretLeft size={14} weight="bold" /> {t.backToChat}
              </button>
              <h2>{t.case}</h2>
              {caseState && hasCase ? <span className={`dlg-status ${caseState.status}`}>{t.caseStatus[caseState.status] ?? caseState.status}</span> : null}
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
                    {/* The receipt has always been generated and never offered.
                        A customer who has just paid wants it now, not after
                        asking for it. Opens in a tab so it can be printed or
                        saved — a download attribute is inert inside an iframe. */}
                    {caseState!.payment.status === "paid" && convId.current ? (
                      <a
                        className="dlg-receipt-link"
                        href={`/api/receipt/${encodeURIComponent(caseState!.payment.reference ?? caseState!.reference!)}?c=${encodeURIComponent(convId.current)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t.receipt}
                      </a>
                    ) : null}
                  </div>
                ) : null}

                {/* The readiness bar in the panel, which is where it lived until
                    Emirates Post asked for theirs above the chat. Restored for
                    every agent that did not ask for the move. */}
                {progress && agent.progressPlacement !== "top" ? (
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
                        {editKey === k ? (
                          <span className="dlg-field-edit">
                            <input
                              value={editVal}
                              onChange={(e) => setEditVal(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") void saveEdit(); if (e.key === "Escape") setEditKey(null); }}
                              disabled={editBusy}
                              autoFocus
                            />
                            <button type="button" className="dlg-field-editbtn ok" onClick={() => void saveEdit()} disabled={editBusy} aria-label="Save">
                              <Check size={13} weight="bold" />
                            </button>
                            <button type="button" className="dlg-field-editbtn" onClick={() => setEditKey(null)} disabled={editBusy} aria-label="Cancel">
                              <X size={13} weight="bold" />
                            </button>
                          </span>
                        ) : (
                          <span className="dlg-field-value">
                            {displayValue(v)}
                            {editableKeys.has(k) ? (
                              // Pencil correction for extracted values (FB-1325).
                              <button
                                type="button"
                                className="dlg-field-pencil"
                                onClick={() => { setEditKey(k); setEditVal(displayValue(v)); }}
                                aria-label={`Edit ${labelMap.get(k) ?? k}`}
                                title={locale === "ar" ? "تعديل" : "Edit"}
                              >
                                <PencilSimple size={13} weight="bold" />
                              </button>
                            ) : null}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                ) : null}

                {docSlots.length && !agent.documentsInChat ? (
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
                      const busy = uploadingKeys.has(d.key);
                      return (
                        <div className="dlg-docslot" key={d.key}>
                          <div className="dlg-docslot-head">
                            <span className="dlg-docslot-name">
                              {tr(d.label, locale)}
                              {d.requirement === "optional" ? <em> ({t.optional})</em> : null}
                            </span>
                            <span className={`dlg-doc-status ${d.status}`}>
                              {uploaded ? <CheckCircle size={12} weight="fill" /> : null}
                              {t.docStatus[d.status] ?? d.status}
                            </span>
                          </div>
                          {uploaded ? (
                            <div className="dlg-docslot-meta">
                              <span className="fname">{d.fileName}</span>
                              <label className={`dlg-upload ghost ${busy ? "busy" : ""}`}>
                                {busy ? t.uploading : t.replace}
                                <input
                                  type="file"
                                  hidden
                                  accept={d.acceptedFormats.map((f) => "." + f).join(",")}
                                  onClick={(e) => { (e.currentTarget as HTMLInputElement).value = ""; }} onChange={(e) => e.target.files?.[0] && uploadDoc(d.key, e.target.files[0])}
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
                                    onClick={(e) => { (e.currentTarget as HTMLInputElement).value = ""; }} onChange={(e) => e.target.files?.[0] && uploadDoc(d.key, e.target.files[0])}
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
                                    onClick={(e) => { (e.currentTarget as HTMLInputElement).value = ""; }} onChange={(e) => e.target.files?.[0] && uploadDoc(d.key, e.target.files[0])}
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

              </>
            )}
          </div>
        </aside>
      </div>
      {qrUrl ? <QrModal url={qrUrl} strings={t} onClose={() => setQrUrl(null)} /> : null}
    </div>
  );
}
