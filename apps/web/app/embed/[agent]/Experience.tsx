"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PaperPlaneRight,
  Stop,
  ShieldSlash,
  GlobeSimple,
  SignIn,
  UserCircleCheck,
  TextAlignLeft,
  FileText,
  ListChecks,
  CheckCircle,
  Circle,
  Warning,
  ArrowRight,
  UploadSimple,
  ArrowClockwise,
  NotePencil,
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
import { tr, evalCondition, type CaseState, type Locale } from "@dialog/config";
import { Microphone } from "@phosphor-icons/react";
import { docSignature } from "@/lib/caseDocs";
import { Markdown, TypewriterMarkdown, type UploadCtx } from "./Markdown";
import { useVoiceChat } from "./useVoiceChat";
import type { PublicAgent } from "./types";
import { showSurvey } from "./customerPulse";
import { maskForDisplay } from "@/lib/maskIdentity";
import { openExternal, isNative, postNative, nativeToken, nativeHandoff, onNativeEvent, type ExternalWindow } from "./nativeBridge";

/** Aisha's brand azure (from the AISHA wordmark) — the single accent, applied
 *  across every tenant so the assistant reads as Aisha, not the host brand. */
const AISHA_BLUE = "#2b90ee";

/** The Aisha presence: a small layered sphere (styled by .dlg-orb in globals). */
function Orb({ size = 25, state = "idle" }: { size?: number; state?: "idle" | "thinking" | "speaking" }) {
  return (
    <span className="dlg-orb" style={{ ["--orb-size" as string]: `${size}px` }} data-state={state} aria-hidden="true">
      <span className="dlg-orb-bloom" />
      <span className="dlg-orb-body">
        <span className="dlg-orb-flow a" />
        <span className="dlg-orb-flow b" />
        <span className="dlg-orb-sheen" />
        <span className="dlg-orb-spec" />
      </span>
    </span>
  );
}

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
  /** When this message was said, ISO. Absent on older persisted messages. */
  at?: string | null;
  /** The proactive account pulse — a long visual summary. Voice mode speaks only
   *  its intro line rather than reading the whole snapshot aloud. */
  pulse?: boolean;
}

/**
 * The clock beside a message.
 *
 * Emirates Post asked for a timestamp on each part of the conversation, in the
 * same breath as asking for the moment of consent to be auditable — so the
 * transcript reads as a record rather than a chat. Shown in the customer's own
 * locale and timezone, to the minute: the second belongs in the audit log, not
 * on screen beside "Which bundle suits you?".
 */
function messageTime(at: string | null | undefined, locale: string): string {
  if (!at) return "";
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return d.toLocaleTimeString(locale === "ar" ? "ar-AE" : "en-GB", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return d.toISOString().slice(11, 16);
  }
}

export const STR = {
  en: {
    placeholder: "Type your message…",
    sources: "Sources",
    case: "Your application",
    caseSub: "Builds itself as you talk",
    emptyTitle: "Nothing to assemble yet",
    emptyBody: "As we talk, your application takes shape here: details, documents, and what's left.",
    missing: "Submission readiness",
    requirements: "Requirements",
    ready: "Ready to submit",
    readyShort: "ready",
    reference: "Reference",
    receipt: "Download receipt",
    signIn: "Sign in",
    signedIn: "Signed in",
    signOut: "Sign out",
    signedOut: "You are signed out.",
    signOutConfirm: "Sign out?",
    expand: "Expand",
    collapse: "Collapse",
    reset: "New chat",
    stop: "Stop",
    send: "Send",
    /* The voice bar and the mic button. English-only until now, in a widget
       whose whole point is that it follows the customer's language — reported
       on 11 September alongside "Looking up your box". */
    voiceStart: "Talk to the assistant",
    voiceOn: "Voice on",
    voiceStop: "Turn off",
    voiceConnecting: "Connecting…",
    voiceSpeaking: "Speaking…",
    voiceListening: "Listening…",
    withdraw: "Withdraw & erase",
    withdrawHint: "Withdraw my permission — stop everything and erase what was collected",
    withdrawing: "Withdrawing…",
    documents: "Documents",
    details: "Details",
    activity: "What has been done",
    activityEmpty: "Nothing has been done on your behalf yet.",
    activityConsent: "Your approval",
    activityLoad: "Show what has been done",
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
    caseSub: "يُبنى أثناء حديثك",
    emptyTitle: "لا يوجد ما يُجمع بعد",
    emptyBody: "أثناء المحادثة، يتشكّل طلبك هنا: التفاصيل والمستندات وما تبقّى.",
    missing: "جاهزية الإرسال",
    requirements: "المتطلبات",
    ready: "جاهز للإرسال",
    readyShort: "جاهز",
    reference: "الرقم المرجعي",
    receipt: "تحميل الإيصال",
    signIn: "تسجيل الدخول",
    signedIn: "تم الدخول",
    signOut: "تسجيل الخروج",
    signedOut: "تم تسجيل خروجك.",
    signOutConfirm: "تسجيل الخروج؟",
    expand: "توسيع",
    collapse: "تصغير",
    reset: "محادثة جديدة",
    stop: "إيقاف",
    send: "إرسال",
    voiceStart: "تحدّث إلى المساعد",
    voiceOn: "الصوت مفعّل",
    voiceStop: "إيقاف",
    voiceConnecting: "جارٍ الاتصال…",
    voiceSpeaking: "جارٍ التحدث…",
    voiceListening: "جارٍ الاستماع…",
    withdraw: "سحب الإذن ومسح البيانات",
    withdrawHint: "اسحب إذني — أوقِف كل شيء وامسح ما تم جمعه",
    withdrawing: "جارٍ السحب…",
    documents: "المستندات",
    details: "التفاصيل",
    activity: "ما تم تنفيذه نيابةً عنك",
    activityEmpty: "لم يُنفَّذ أي إجراء نيابةً عنك بعد.",
    activityConsent: "موافقتك",
    activityLoad: "عرض ما تم تنفيذه",
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
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/;
export function displayValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  const s = String(v);
  const m = s.match(ISO_DATE_RE);
  if (!m) return s;
  const date = `${m[3]}-${m[2]}-${m[1]}`;
  // A CONSENT TIMESTAMP IS NOT A DATE. Emirates Post asked for the moment of
  // acceptance to be auditable, and this function used to throw the time away —
  // "2026-09-15T08:41:03.000Z" rendered as "15-09-2026", which is the one part
  // of it nobody needed. An expiry date still renders as a date, because that is
  // all it is.
  return m[4] ? `${date} ${m[4]}:${m[5]} UTC` : date;
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
/**
 * What to say while the turn is still running but nothing is arriving.
 *
 * Reported 16 September: "it took a while to load the buttons — after 10
 * seconds did the buttons load". The reply had already printed its prose and
 * the customer was looking at a finished-looking message with no sign that the
 * assistant was still working. It was: the model writes the prose, records what
 * the customer chose, and only then writes the buttons.
 *
 * The status line beside a tool round covered the INTEGRATION tools only —
 * anything that calls out to Emirates Post or EPGL — and recording a field is
 * not one of those, so the commonest silent stretch in any journey was the one
 * with nothing on screen.
 */
const WORKING = (ar: boolean) => (ar ? "جارٍ العمل على طلبك…" : "Working on it…");

/**
 * THE ARABIC VERB FOR WORK IN PROGRESS IS NOT THE ONE FOR SHOWING.
 *
 * Emirates Post's Arabic reviewer, 21 September, having read the live
 * transcripts: «سأجلب» is correct and reads as physically bringing something,
 * which is not what happens on a screen. «سأعرض» ("I will show you") is the
 * customer-facing verb, and «سأتحقق» ("I will check") is right when the thing
 * being described really is a check rather than a presentation.
 *
 * These lines are the second case. They appear WHILE the lookup runs, so
 * nothing is being shown yet — "checking" is what is happening. The other verb
 * belongs in the assistant's own sentence, which is a prompt rule; see
 * prompt.ts.
 */
function toolStatusLabel(ev: { type: string; tool?: string; kind?: string }, ar: boolean): string {
  const t = (ev.tool || "").toLowerCase();
  const L = (en: string, arb: string) => (ar ? arb : en);
  if (ev.type === "lookup") return L("Tracking your shipment…", "جارٍ تتبّع شحنتك…");
  /**
   * The account lookup had no label, and it is the longest wait in the product.
   *
   * Reported from the mobile app, 11 September: "the 'Working on it…' message
   * keeps loading for almost a minute". The account pulse walks every box on
   * the account and prices the ones that are due, and the tool that starts it —
   * nxn_boxes_for_customer — matched none of the patterns below, so the one
   * minute with the most going on behind it was the one with the vaguest thing
   * to say about it.
   */
  if (/boxes_for_customer|companies_for_customer|account/.test(t)) return L("Fetching your account…", "جارٍ التحقق من بيانات حسابك…");
  if (/saved_cards|cards/.test(t)) return L("Checking your saved cards…", "جارٍ التحقق من بطاقاتك المحفوظة…");
  if (/details/.test(t)) return L("Looking up your box…", "جارٍ التحقق من بيانات صندوقك…");
  if (/pricing|charges/.test(t)) return L("Checking pricing…", "جارٍ حساب السعر…");
  if (/boxlocations|branch/.test(t)) return L("Finding branches…", "جارٍ إيجاد الفروع…");
  if (/bundle/.test(t)) return L("Fetching packages…", "جارٍ التحقق من الباقات المتاحة…");
  if (/options|entities|expiry/.test(t)) return L("Getting the details…", "جارٍ التحقق من التفاصيل…");
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
  // On a language switch, the messages already on screen are translated into the
  // new language too (display-only, best-effort) so the whole conversation
  // follows — keyed by `${index}:${locale}`, original kept for switching back.
  const [xlate, setXlate] = useState<Record<string, string>>({});
  const xlateInflight = useRef<Set<string>>(new Set());
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
  /**
   * WHAT the assistant is doing, not the SENTENCE that says so.
   *
   * Reported from the mobile app, 11 September: "after changing the language
   * mid-conversation, a few texts (e.g. 'Looking up your box') continue to
   * display in English instead of Arabic." They did. The label was rendered
   * once, at the moment the tool event arrived, and stored as a finished string
   * — so a language switch a second later repainted the composer, the readiness
   * bar and the pickers around a status line frozen in the language the
   * customer had just left.
   *
   * Keeping the event and translating at render time is the whole fix: the line
   * is now in whatever language the conversation is in when it is read.
   */
  const [toolEvent, setToolEvent] = useState<{ type: string; tool?: string; kind?: string } | null>(null);
  const toolStatus = toolEvent ? toolStatusLabel(toolEvent, locale === "ar") : null;
  /**
   * THE CUSTOMER'S OWN ACCOUNT OF WHAT WAS DONE FOR THEM.
   *
   * The audit trail has always been complete and always been ours. The checklist
   * asks for it the other way round — an understandable log of what the
   * assistant did in the customer's name — so the panel reads it back from the
   * actions already recorded, in their language, with the consent beside each
   * one. Loaded when they ask for it rather than on every turn: it is a thing
   * you go and look at, and the conversation above is the live version.
   */
  const [activity, setActivity] = useState<
    { at: string; requestedBy: string; executedBy: string; action: string; consent: string; result: string; reference?: string }[] | null
  >(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [activityBusy, setActivityBusy] = useState(false);
  // One-tap permission withdrawal in flight (see withdrawPermission).
  const [withdrawBusy, setWithdrawBusy] = useState(false);
  /** Nothing has arrived for a couple of seconds and the turn is still open. */
  const [quiet, setQuiet] = useState(false);
  const lastDelta = useRef(0);
  // Resume completion + a one-shot flag to fire the account pulse after sign-in.
  const [resumed, setResumed] = useState(false);
  const [signedInPulse, setSignedInPulse] = useState(false);
  /**
   * The customer signed out and has not asked to sign in again.
   *
   * The host page keeps its own copy of the token and re-offers it — the loader
   * re-posts it on a timer and on any storage change — so without this, signing
   * out would last until the next tick. It is lifted only by an explicit sign-in.
   */
  const signedOut = useRef(false);
  /**
   * The customer was signed in by the NATIVE app, not by a token we hold.
   *
   * The distinction only matters when the conversation ends. A host page hands
   * us its token and keeps re-offering it, so `uaePass.current` survives a new
   * chat and so does the sign-in. A native handoff is the opposite by design:
   * the code is single-use, worth two minutes, and the real credential never
   * comes near this page — the session lives against the CONVERSATION on the
   * server. Start a new conversation and the identity is simply not there any
   * more.
   *
   * Which is what was reported on 11 September: "refreshing the chat window
   * using the refresh button prompts the user to sign in again." It did, and no
   * token was missing — a new chat had left the only thing that knew who they
   * were behind. See resetChat, which now asks the app for another code instead
   * of quietly dropping them to guest.
   */
  const nativeIdentity = useRef(false);
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
  // Aborts the in-flight turn so the customer can stop the agent mid-reply.
  const abortRef = useRef<AbortController | null>(null);
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
    /**
     * NOTHING IS EDITABLE ONCE IT HAS BEEN SUBMITTED OR PAID FOR.
     *
     * Every field carried a pencil, and it stayed there after the application
     * was confirmed and the terms accepted — so a customer could quietly change
     * a detail the order had already been placed on, with no re-confirmation and
     * no way for them to know whether it had changed the order or only the
     * panel. Reported 9 September as a data-integrity gap, and it is one: the
     * panel would no longer describe what was actually bought.
     *
     * A correction before submission is the point of the pencil and stays.
     */
    const settled =
      caseState?.status === "submitted" ||
      caseState?.status === "escalated" ||
      caseState?.payment?.status === "paid";
    if (settled) return set;

    const j = agent.journeys.find((x) => x.key === caseState?.journeyKey);
    const fields = (j?.steps ?? []).flatMap((s) => s.fields);
    const curated = fields.some((f) => f.editable !== undefined);
    for (const f of fields) {
      if (f.type === "boolean" || /(_consent|_accepted|_acknowledged)(_at)?$/.test(f.key)) continue;
      if (curated ? f.editable === true : true) set.add(f.key);
    }
    return set;
  }, [agent, caseState?.journeyKey, caseState?.status, caseState?.payment?.status]);
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

  // The engine's own evaluator, not a copy of it. The copy that used to live
  // here never handled `partner_count >= 2`, so every per-partner document was
  // invisible to this component's readiness count while the server counted them
  // all -- the bar the customer read and the bar the submission enforced were
  // different numbers.
  const docApplies = useCallback(
    (condition: string | undefined) => evalCondition(condition, (caseState?.data ?? {}) as Record<string, unknown>),
    [caseState]
  );

  // Submission progress for the active journey (legitimate form feedback).
  const progress = useMemo(() => {
    if (!caseState?.journeyKey) return null;
    const j = agent.journeys.find((x) => x.key === caseState.journeyKey);
    if (!j) return null;
    let total = 0;
    for (const s of j.steps) {
      total += s.fields.filter((f) => f.required && docApplies(f.condition)).length;
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
      for (const f of s.fields) if (f.required && docApplies(f.condition)) items.push({ kind: "field", key: f.key, done: !missingSet.has(`field:${f.key}`) });
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
        /**
         * A REPLACEMENT IS AN UPLOAD, even when nothing about the case COUNTS
         * differently afterwards.
         *
         * The effect below noticed uploads by counting them, and a Replace does
         * not change any count: the slot was "uploaded" before and is "uploaded"
         * after. So on 15 September a customer was asked for the current MOA,
         * replaced the stale one, and the agent never spoke again — it was
         * never told.
         *
         * An upload we performed ourselves does not have to be deduced. Said
         * here, it also covers the one case a state comparison cannot see: the
         * same file name replacing itself.
         */
        justUploaded.current = true;
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
  /**
   * IS THERE ANYTHING TO EXPAND INTO?
   *
   * Reported from the mobile app, 11 September: "the minimize/maximize icon in
   * the chat header is not functional — tapping it produces no visible effect".
   * It was not: the button posts `expand` to the page that framed us, and
   * inside a native WebView there is no such page. The message goes nowhere and
   * the customer taps a control that does nothing.
   *
   * The CSS has hidden it on a phone since FB-5 — `.dlg-chip.icon-only.expand-
   * toggle { display: none }` under the 599px breakpoint — but the button was
   * never given that class, so the rule matched nothing. It has it now; this
   * covers the other half, a WebView or a full-page load wide enough to miss
   * the breakpoint but with no host frame listening.
   */
  // Settled after mount, not during render: whether there is a parent frame is
  // a client-only fact, and deciding it while rendering on the server gives one
  // answer there and another here — a hydration mismatch. Same reason as
  // voiceReady above.
  const [canExpand, setCanExpand] = useState(false);
  useEffect(() => setCanExpand(!isNative() && window.parent !== window), []);
  // A phone has no tooltip, so a control whose meaning lives in one has to say
  // it another way. Settled after mount for the same hydration reason.
  const [coarsePointer, setCoarsePointer] = useState(false);
  useEffect(() => setCoarsePointer(window.matchMedia?.("(hover: none) and (pointer: coarse)").matches ?? false), []);
  /** The signed-in chip, tapped once on a phone: it asks before it acts. */
  const [signOutArmed, setSignOutArmed] = useState(false);
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
      const m = e.data as { source?: string; uaePassToken?: string; action?: string; locale?: string };
      if (m?.source !== "dialog-host") return;

      /**
       * The page changed language while we were open.
       *
       * Emirates Post's language toggle swaps <html lang> in place rather than
       * navigating, so the page turned Arabic and the assistant stayed English
       * until someone reloaded. The loader watches the attribute and tells us,
       * because the alternative -- reloading the panel with a new locale -- swaps
       * the language by discarding the conversation inside it.
       *
       * Deliberately NOT origin-gated. This carries no credential and grants
       * nothing: the worst a stray frame can do is show this reader their own
       * assistant in the other language, which they can change back with the
       * toggle in the header. allowedOrigins is often unset, and refusing to
       * follow the page's own language until someone configures it would fail
       * quietly on exactly the sites that need it.
       */
      if (m.action === "locale" && (m.locale === "en" || m.locale === "ar")) {
        setLocale(m.locale);
        return;
      }

      if (typeof m.uaePassToken !== "string") return;
      if (!permitted.has(e.origin)) return;
      // They signed out. The host page does not know that and will keep offering
      // its token; taking it would sign them back in without them asking.
      if (signedOut.current) return;
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
  /**
   * Redeem a native sign-in code for the conversation it names.
   *
   * Pulled out of the effect below because it is needed twice: once when the
   * app hands us one at load, and again when the customer starts a new chat and
   * the app sends a fresh one — see resetChat.
   */
  const redeemHandoff = useCallback(
    async (handoff: string): Promise<boolean> => {
      try {
        const res = await fetch("/api/embed/handoff", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agent: agent.slug, handoff }),
        });
        if (!res.ok) return false;
        const data = (await res.json()) as { conversationId?: string };
        if (data.conversationId) {
          convId.current = data.conversationId;
          try { window.localStorage.setItem(storageKey, data.conversationId); } catch { /* private mode */ }
        }
        nativeIdentity.current = true;
        signedOut.current = false;
        setAuthenticated(true);
        setAuthReason(null);
        setSignedInPulse(true);
        return true;
      } catch {
        /* leave signed out; the customer can still sign in from here */
        return false;
      }
    },
    [agent.slug, storageKey]
  );

  useEffect(() => {
    // Preferred: a handoff code. The app has already exchanged the real token
    // with us from native code, so there is nothing here worth stealing -- this
    // only says which conversation is already signed in.
    const handoff = nativeHandoff();
    if (handoff) {
      void redeemHandoff(handoff);
      return;
    }
    const token = nativeToken();
    if (!token || uaePass.current || signedOut.current) return;
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
  }, [agent.slug, redeemHandoff]);

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
    const leaving = convId.current;
    const wasSignedIn = authenticated;
    try { window.localStorage.removeItem(storageKey); } catch { /* ignore */ }
    convId.current = null;
    pulsed.current = false;
    setMessages([]);
    setCaseState(null);
    setInput("");
    setAuthReason(null);
    // The SIGN-IN SURVIVES A NEW CHAT. Clearing it here made the header say
    // signed-out while the identity token was still held and the very next turn
    // was still authenticated — so the customer could not tell whether they were
    // logged in, which is the one thing that header exists to answer. Starting a
    // fresh conversation is not signing out; the sign-out is the token going.
    //
    // A host page re-offers its token on a timer, so that case needs nothing.
    if (uaePass.current) return;
    if (!wasSignedIn || !leaving) { setAuthenticated(false); return; }
    /**
     * AND IT HAS TO SURVIVE ONE AFTER UAE PASS, WHICH IS THE CASE THAT WAS
     * ACTUALLY REPORTED.
     *
     * "Logged-in user — refreshing the chat window using the refresh button
     * prompts the user to sign in again." The first pass at this changed the
     * icon, which was right — the control starts a new chat and a circular
     * arrow said reload — and then handled the NATIVE HANDOFF, where the app
     * can mint another code. The app is not on that path. It signs in with UAE
     * PASS, and a UAE PASS session leaves nothing in the widget at all: the
     * token is stored server-side against the CONVERSATION, deliberately out of
     * this page's reach. So `uaePass.current` was empty, `nativeIdentity` was
     * false, and the customer was dropped to guest exactly as before.
     *
     * There is nothing here to re-present, so the SERVER moves the session into
     * the new conversation instead. The header holds "signed in" across the
     * round trip because that is what is true — they have not signed out of
     * anything — and follows the server if it cannot.
     */
    void (async () => {
      try {
        const res = await fetch("/api/embed/continue", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agent: agent.slug, from: leaving }),
        });
        if (res.ok) {
          const data = (await res.json()) as { conversationId?: string };
          if (data.conversationId) {
            convId.current = data.conversationId;
            try { window.localStorage.setItem(storageKey, data.conversationId); } catch { /* private mode */ }
            return;
          }
        }
      } catch {
        /* fall through to the app, and then to the honest answer */
      }
      // The server could not carry it. An app that implements the handoff can
      // still mint a fresh code; one that does not leaves them signed out, which
      // is then the truth rather than a guess.
      if (nativeIdentity.current && isNative()) {
        postNative({ action: "signin-needed", reason: "new-chat" });
        window.setTimeout(() => {
          if (convId.current) return;
          nativeIdentity.current = false;
          setAuthenticated(false);
        }, 5000);
        return;
      }
      setAuthenticated(false);
    })();
  }, [streaming, storageKey, authenticated, agent.slug]);

  /**
   * The app answering — with a sign-in code, or with the customer back from a
   * payment page. A browser never fires either; nothing here is web.
   */
  useEffect(
    () =>
      onNativeEvent((e) => {
        if (e.action === "handoff" && e.handoff) void redeemHandoff(e.handoff);
      }),
    [redeemHandoff]
  );

  // Sign-in: real UAE PASS OIDC when configured, else the dev mock toggle.
  // UAE PASS forbids being framed, so from the embedded widget it opens in a
  // centered popup; the callback posts the result back and the chat continues in
  // place. Falls back to a full redirect if the popup is blocked.
  /**
   * Sign out: the server's session, this widget's copy of the token, and the
   * header, in that order.
   *
   * The server first, because that is the one that decides whether the next turn
   * is authenticated. Clearing only the client's view of it was FB-1485 — the
   * header said signed out while the session was still live.
   */
  const signOut = useCallback(async () => {
    signedOut.current = true;
    uaePass.current = undefined;
    setAuthenticated(false);
    setAuthReason(null);
    try {
      if (convId.current) {
        await fetch("/api/embed/signout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId: convId.current, agentSlug: agent.slug }),
        });
      }
      // Tell the host page too, so its own header can follow and it can drop the
      // token it is holding. It may not be listening; that is its business.
      window.parent?.postMessage({ source: "dialog", action: "signed-out" }, "*");
      postNative({ source: "dialog-native", action: "signed-out" });
    } catch {
      /* the widget is signed out either way — never leave it saying otherwise */
    }
  }, [agent.slug]);

  const signIn = useCallback(() => {
    // Asking to sign in is what lifts a sign-out.
    signedOut.current = false;
    /**
     * Inside the app, ask the app first.
     *
     * Reported on 11 September (issues 3 and 10): signing in from the chat
     * takes the customer to the portal in an in-app browser, they sign in, and
     * the app lands them on the account home screen — the conversation they
     * were in the middle of is gone. It is the browser's own return that does
     * that, and no amount of care on this page can change where a separate
     * browser goes next.
     *
     * The app can: it already holds the customer's session, so it can mint a
     * handoff from native code and hand it straight to this page, and nobody
     * leaves the chat at all. So say what is wanted and let it answer. A host
     * that has not implemented this ignores the message, and the portal below
     * is still opened — nothing regresses for an app that is not listening.
     */
    if (isNative()) postNative({ action: "signin-needed", reason: "customer-asked" });
    /**
     * THE HOST PORTAL ROUTE CANNOT WORK INSIDE THE APP.
     *
     * Reported 19 September: "this button for the sign in, if clicked on I think
     * it takes to web so you basically can't sign in through that button."
     * Exactly right, and it is not the browser being awkward — it is that this
     * route needs a hosting PAGE and the app has not got one.
     *
     * The portal owns its own UAE PASS client and its own registered callback,
     * so signing in there leaves the token in box.emiratespost.ae's
     * localStorage. It reaches the widget because the embed LOADER runs
     * first-party on that page, reads it, and posts it into the iframe. In the
     * app the widget is the whole window: no host page, no loader, nobody to
     * read that token or hand it over. The customer signs in perfectly well and
     * the chat never hears about it.
     *
     * UAE PASS, by contrast, works there today — its callback returns to this
     * embed's own URL with ?uaepass=ok, which this page reads itself, and the
     * screenshots of the app show customers signed in exactly that way. So
     * inside a native host the portal is skipped and UAE PASS is used. The
     * ordering stays as it was on the web, where the portal is the right door
     * and the loader is standing behind it.
     */
    const hostLoginUsable = Boolean(agent.hostLoginUrl) && !isNative();
    if (hostLoginUsable && typeof window !== "undefined") {
      const win = openExternal(agent.hostLoginUrl!, { name: "dlg-host-login", kind: "signin" });
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
    const said = new Date().toISOString();
    setMessages((prev) => [
      ...prev,
      ...(silent ? [] : [{ role: "user" as const, content: text, at: said }]),
      { role: "assistant" as const, content: "", citations: [], at: said, ...(proactive ? { pulse: true } : {}) },
    ]);
    setStreaming(true);
    setToolEvent(null);
    lastDelta.current = Date.now();
    setQuiet(false);

    /**
     * Go and read what actually happened.
     *
     * The turn runs to completion on the server whether or not this page is
     * still listening, so a connection that dies mid-reply is a reason to fetch
     * the result, not a reason to apologise. Returns false only when there is
     * genuinely nothing to show — no conversation yet, the read failed too, or
     * the server's last word is not a finished assistant reply — which is the
     * one case where the customer needs telling.
     */
    const recoverTurn = async (): Promise<boolean> => {
      const cid = convId.current;
      if (!cid) return false;
      try {
        const res = await fetch(`/api/conversations/${cid}`);
        if (!res.ok) return false;
        const data = await res.json();
        if (data.case) setCaseState(data.case);
        const stored = Array.isArray(data.messages) ? data.messages : [];
        const last = stored[stored.length - 1];
        if (!last || last.role !== "assistant" || !String(last.content ?? "").trim()) return false;
        setMessages(stored);
        return true;
      } catch {
        /* offline too — the caller says so in the customer's language */
        return false;
      }
    };

    /** The connection dropped and there was nothing on the server to show for it. */
    const noteDropped = () => {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (!last) return prev;
        const next = prev.slice();
        const note =
          locale === "ar"
            ? "انقطع الاتصال قبل وصول الرد. تحقّق من اتصالك وأعد إرسال رسالتك."
            : "The connection dropped before the reply arrived. Check your connection and send that again.";
        next[next.length - 1] = { ...last, content: `${last.content}\n\n⚠ ${note}`.trim() };
        return next;
      });
    };

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        signal: controller.signal,
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
          if (ev.delta) {
            setToolEvent(null); // real text is arriving — drop the status
            lastDelta.current = Date.now();
            setQuiet(false);
          }
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
          setToolEvent({ type: ev.type, tool: ev.tool, kind: ev.kind });
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
        } else if (ev.type === "locale") {
          // The customer switched language by simply typing in it. Everything the
          // MODEL says follows them on its own; everything the WIDGET says —
          // the branch picker, the map button, the readiness bar, the composer —
          // was still reading off the host page's <html lang> and stayed English
          // through an entirely Arabic conversation.
          if (ev.locale === "ar" || ev.locale === "en") setLocale(ev.locale);
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

      /**
       * A STALLED STREAM IS NOT A STREAM THAT IS STILL THINKING.
       *
       * reader.read() waits forever on a connection that was dropped without a
       * FIN -- a proxy or a phone changing network -- and nothing below ever
       * runs, so the spinner spins for as long as the customer is willing to
       * watch it. 8 September: a rental whose order had been created, with the
       * payment link already written and stored, sat on "Working on it…" while
       * the reply that carried it never arrived.
       *
       * The server sends a heartbeat, so silence this long means the connection
       * is gone rather than the model being slow. Give up and go and read what
       * actually happened -- the turn finishes server-side whether or not we are
       * listening, which is what makes recovery possible at all.
       */
      const STALL_MS = 45_000;
      let stalled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const armStall = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => { stalled = true; void reader.cancel().catch(() => {}); }, STALL_MS);
      };
      armStall();

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        armStall();
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
      if (timer) clearTimeout(timer);

      // The connection died mid-turn. The reply is finished and stored on the
      // server, so fetch it rather than leaving the customer with half a
      // sentence and no payment link.
      if (stalled && !(await recoverTurn())) noteDropped();
    } catch (err) {
      // The customer stopped the turn: keep whatever was generated so far, and
      // drop a still-empty assistant bubble so nothing dangles. Not an error.
      if (controller.signal.aborted || (err instanceof Error && err.name === "AbortError")) {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === "assistant" && !last.content.trim() && !last.payment) return prev.slice(0, -1);
          return prev;
        });
      } else {
        /**
         * "LOAD FAILED" IS NOT A SENTENCE WE WROTE.
         *
         * Reported from the mobile app, 11 September: "sometimes, after the
         * 'Working on it…' message keeps loading continuously, the response ends
         * in a 'Load failed' error instead of the expected reply." That string is
         * WebKit's — it is what `TypeError.message` says when a fetch on iOS dies
         * before it delivers anything — and it was being printed into the
         * conversation verbatim, in English, whatever language the customer was
         * reading.
         *
         * Two things were wrong with that and only one of them is the wording.
         * A dropped connection does NOT mean the turn failed: the server runs it
         * to completion whether or not anyone is listening, which is exactly why
         * the stall path above goes and reads the result instead of apologising.
         * A fetch that dies on a phone changing cell is the same event arriving
         * through a different door, so it takes the same door out — and in the
         * screenshot the reply that never arrived was a lookup that had already
         * run.
         *
         * Only when that comes back with nothing does the customer get told, in
         * their own language, that the connection dropped and the message is
         * worth sending again.
         */
        if (!(await recoverTurn())) noteDropped();
      }
    } finally {
      abortRef.current = null;
      setStreaming(false);
      setToolEvent(null);
      setQuiet(false);
    }
  }, [input, streaming, agent.slug, locale, authenticated, storageKey]);

  /** Stop the agent mid-reply — aborts the in-flight turn (see abortRef in send). */
  const stopStreaming = useCallback(() => {
    try { abortRef.current?.abort(); } catch { /* ignore */ }
  }, []);

  /**
   * Withdraw permission in one step (pre-launch gate; FB-1737).
   *
   * Stops anything in flight, asks the server to revoke the session and consents
   * and erase what was collected, then shows the customer a plain-language
   * receipt — what had been done in their name, and what was just erased — and
   * clears the panel back to a fresh start. Signing out follows the server: this
   * is a withdrawal of consent, so it ends the session too.
   */
  const withdrawPermission = useCallback(async () => {
    if (withdrawBusy) return;
    const cid = convId.current;
    try { abortRef.current?.abort(); } catch { /* ignore */ }
    setWithdrawBusy(true);
    let receipt: string | null = null;
    try {
      if (cid) {
        const res = await fetch("/api/chat/withdraw", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentSlug: agent.slug, conversationId: cid, locale }),
        });
        if (res.ok) {
          const data = (await res.json()) as { message?: string };
          receipt = data.message?.trim() || null;
        }
      }
    } catch { /* the withdrawal still clears the client below */ }
    finally {
      // Clear the client like a new chat, but keep the receipt on screen so the
      // customer can read what was erased. The withdrawn conversation is done;
      // the next message starts a fresh one.
      try { window.localStorage.removeItem(storageKey); } catch { /* private mode */ }
      convId.current = null;
      pulsed.current = false;
      signedOut.current = true;
      uaePass.current = undefined;
      setCaseState(null);
      setInput("");
      setAuthReason(null);
      setActivity(null);
      setActivityOpen(false);
      setAuthenticated(false);
      setMessages(receipt ? [{ role: "assistant", content: receipt }] : []);
      // Tell the host page too, so its header follows and it drops any token.
      try { window.parent?.postMessage({ source: "dialog", action: "signed-out" }, "*"); } catch { /* not embedded */ }
      postNative({ source: "dialog-native", action: "signed-out" });
      setWithdrawBusy(false);
    }
  }, [withdrawBusy, agent.slug, locale, storageKey]);

  /**
   * Watch for a silent stretch inside a turn that has already said something.
   *
   * Polled rather than timed off each delta: a timer per token is a timer reset
   * a thousand times a reply, and this needs to be right to about a second.
   */
  /** Fetch the log when it is opened, and again once the turn that changed it ends. */
  useEffect(() => {
    if (!activityOpen || !convId.current || streaming) return;
    let live = true;
    setActivityBusy(true);
    void (async () => {
      try {
        const res = await fetch(`/api/activity/${convId.current}?agent=${encodeURIComponent(agent.slug)}&locale=${locale}`);
        if (live && res.ok) setActivity((await res.json()).entries ?? []);
      } catch {
        /* the panel shows what it has; a log is never worth an error in the chat */
      } finally {
        if (live) setActivityBusy(false);
      }
    })();
    return () => { live = false; };
  }, [activityOpen, streaming, agent.slug, locale, caseState]);

  useEffect(() => {
    if (!streaming) return;
    // 2.5s: long enough that the tail of a turn — saving the case, minting a
    // survey token — does not flash it after the last word, short enough that a
    // ten-second wait for a button is never silent.
    const id = setInterval(() => setQuiet(Date.now() - lastDelta.current > 2500), 500);
    return () => clearInterval(id);
  }, [streaming]);

  // Voice mode: speak the assistant's replies and turn the customer's speech into
  // chat messages (see useVoiceChat). Layered on the normal chat, not a separate
  // agent — voice input goes through the same send().
  const voice = useVoiceChat({ agentSlug: agent.slug, locale, messages, streaming, send: (t) => void send(t) });

  // Translate the on-screen transcript when the session language changes: any
  // message written in the other script is sent to /api/translate for the
  // current locale and shown translated. Best-effort — on failure the original
  // stays, so it can never blank a message or break the card/button flow.
  useEffect(() => {
    if (messages.length === 0) return;
    const wantArabic = locale === "ar";
    const batch: { key: string; text: string }[] = [];
    messages.forEach((m, i) => {
      const text = m.content?.trim();
      if (!text) return;
      if (streaming && i === messages.length - 1) return; // still arriving in the current language
      const key = `${i}:${locale}`;
      if (xlate[key] || xlateInflight.current.has(key)) return;
      // Translate anything carrying words in the OTHER language, so a mixed
      // message (Arabic prose with English card labels, or vice versa) is fully
      // converted, not just wholly-other-language ones. To Arabic: any English
      // word. To English: any Arabic. The endpoint returns already-target text
      // unchanged, and results are cached per message+locale.
      const mismatched = wantArabic ? /[A-Za-z]{2,}/.test(text) : /[؀-ۿ]/.test(text);
      if (mismatched) batch.push({ key, text: m.content });
    });
    if (!batch.length) return;
    batch.forEach((b) => xlateInflight.current.add(b.key));
    void (async () => {
      try {
        const res = await fetch("/api/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ texts: batch.map((b) => b.text), to: locale }),
        });
        if (res.ok) {
          const { texts } = (await res.json()) as { texts?: string[] };
          if (Array.isArray(texts)) {
            setXlate((prev) => {
              const next = { ...prev };
              batch.forEach((b, k) => { const v = texts[k]; if (v && v !== b.text) next[b.key] = v; });
              return next;
            });
          }
        }
      } catch { /* best-effort: originals remain */ } finally {
        batch.forEach((b) => xlateInflight.current.delete(b.key));
      }
    })();
  }, [locale, messages, streaming, xlate]);

  /** The message text to show now: a translation for the current locale if one
   *  has been fetched, otherwise the original as sent. */
  const displayContent = useCallback((i: number, m: ChatMessage) => xlate[`${i}:${locale}`] ?? m.content, [xlate, locale]);

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
  /**
   * WHAT THE DOCUMENTS ARE, not how many of them there are.
   *
   * This used to compare counts, which is blind to the one thing a Replace
   * does: the slot reads "uploaded" before and after, so the count is
   * unchanged and no turn fired. The customer replaced the stale MOA we had
   * just asked them to replace, and the conversation stopped dead.
   *
   * A signature of every document's key, status, file name and rejection
   * reason changes whenever any of them does — a new upload, a replacement, a
   * rejection, a rejection cleared by a better copy.
   */
  const uploadedBaseline = useRef<string | null>(null);
  const pendingDocNotify = useRef(false);
  const justUploaded = useRef(false);
  useEffect(() => {
    if (!resumed || !agent.documentsInChat) return;
    const docs = caseState?.documents ?? [];
    const sig = docSignature(docs);
    if (uploadedBaseline.current === null) {
      uploadedBaseline.current = sig; // establish baseline, do not fire
      return;
    }
    // An upload this widget performed is known, not deduced — it covers a file
    // replacing itself under the same name, which no comparison can see.
    const grew = sig !== uploadedBaseline.current || justUploaded.current;
    justUploaded.current = false;
    uploadedBaseline.current = sig;
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
    // Aisha's azure overrides the tenant primary so the orb, buttons, links,
    // progress and selected states all read as Aisha.
    ["--c-primary" as string]: AISHA_BLUE,
    ["--c-primary-fg" as string]: "#ffffff",
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
          {/* Aisha wordmark — the assistant's identity across every tenant. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="dlg-header-logo" src="/aisha-onlight.jpg" alt="Aisha" />
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
          {/* Signed in, this signs them OUT — and it does so properly.
              It was a status indicator only, because a single tap used to flip
              the client back to guest while the server kept the verified session
              (FB-1485), leaving the customer told to sign in again mid-
              conversation. That was a reason to make sign-out real, not a reason
              to have none: on a shared or public screen, an account with its
              addresses and its agents stayed one tap away for whoever sat down
              next. The server session is cleared first; the header follows it. */}
          {/* ONE TAP AND THEIR SESSION IS GONE, WITH NOTHING SAYING SO.
              Reported 19 September, and the way it was reported is the evidence:
              the customer took this green chip for a SIGN-IN button. Signed in,
              it signs them out — and the only thing that ever said so was a
              `title`, which is a tooltip, which a phone does not have. A stray
              tap mid-application ended the session in silence.
              So on a touch device it asks first: the tap arms it and says "Sign
              out?" in words, and a second tap within four seconds does it. On a
              desktop the tooltip is there and it behaves as it always has. */}
          <button
            className={`dlg-chip ${signOutArmed ? "" : "icon-only "}${authenticated ? "is-on" : ""}`}
            onClick={() => {
              if (!authenticated) { signIn(); return; }
              if (!coarsePointer || signOutArmed) { setSignOutArmed(false); void signOut(); return; }
              setSignOutArmed(true);
              window.setTimeout(() => setSignOutArmed(false), 4000);
            }}
            aria-label={authenticated ? t.signOut : t.signIn}
            title={authenticated ? `${t.signedIn} — ${t.signOut}` : t.signIn}
          >
            {authenticated ? <UserCircleCheck size={17} weight="fill" /> : <SignIn size={16} weight={iconWeight} />}
            {signOutArmed ? <span className="dlg-chip-tag">{t.signOutConfirm}</span> : null}
          </button>
          {/* Withdraw permission in one step (pre-launch gate; FB-1737). Shown
              once there is a granted permission or collected data to pull back —
              revokes consent, stops everything, and reports what was erased. */}
          {authenticated || dataEntries.length > 0 || caseState?.documents?.some((d) => d.status === "uploaded" || d.status === "accepted") ? (
            <button
              className="dlg-chip icon-only is-withdraw"
              onClick={() => void withdrawPermission()}
              disabled={withdrawBusy}
              aria-label={t.withdraw}
              title={t.withdrawHint}
            >
              <ShieldSlash size={16} weight={withdrawBusy ? "fill" : iconWeight} />
            </button>
          ) : null}
          <button
            className="dlg-chip icon-only"
            onClick={resetChat}
            disabled={streaming || (messages.length === 0 && !caseState)}
            aria-label={t.reset}
            title={t.reset}
          >
            {/* A PENCIL, NOT A RELOAD ARROW.
                Reported from the mobile app, 11 September: "refreshing the chat
                window using the refresh button prompts the user to sign in
                again." There is no refresh button. This one starts a NEW chat —
                it says so in its tooltip, and a phone has no tooltips, so the
                circular arrow was the only thing telling the customer what it
                did, and it was telling them the wrong thing. They pressed what
                they read as reload and lost the conversation. */}
            <NotePencil size={16} weight={iconWeight} />
          </button>
          {embedded && canExpand ? (
            <button
              className="dlg-chip icon-only expand-toggle"
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
              {/* The bar only. The full checklist used to sit here too, and above
                  a conversation it read as clutter — seven pills of things not
                  done yet, in front of someone who has only just started. The
                  list is still in the application panel, where it is one tap away
                  and has room to be read. */}
            </div>
          ) : null}
          <div className="dlg-messages" ref={scrollRef}>
            <div className="dlg-msg assistant">
              <Orb size={25} />
              {/* Greeting gets onSelect so a ```buttons service list in it is
                  tappable (feedback FB-1434: structured options, not prose). */}
              <div className="dlg-bubble" dir="auto"><Markdown text={tr(agent.greeting, locale)} onSelect={messages.length === 0 && !streaming ? handleCardSelect : undefined} locale={locale} /></div>
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
                  <Orb size={25} />
                ) : null}
                {/* EACH BUBBLE DECIDES ITS OWN DIRECTION.
                    The panel is right-to-left for an Arabic session, and an
                    English sentence rendered inside it has its trailing
                    punctuation pushed to the front: "Which bundle suits your
                    company?" appeared as "?Which bundle suits your company".
                    That is the bidirectional algorithm doing exactly what it is
                    told — the paragraph direction was RTL and the sentence was
                    not. It happens whenever the conversation changes language
                    mid-flow, because the replies already on screen do not.
                    dir="auto" lets each message be read in the direction of the
                    language it is actually written in. */}
                <div className="dlg-bubble" dir="auto">
                  {messageTime(m.at, locale) ? (
                    <time className="dlg-msg-time" dateTime={m.at ?? undefined}>{messageTime(m.at, locale)}</time>
                  ) : null}
                  {m.content ? (
                    m.role === "assistant" ? (
                      <TypewriterMarkdown text={displayContent(i, m)} animate={streaming && i === messages.length - 1} onSelect={handleCardSelect} uploadCtx={uploadCtx} locale={locale} />
                    ) : (
                      displayContent(i, m)
                    )
                  ) : null}
                  {streaming && i === messages.length - 1
                    ? toolStatus || (quiet && m.content) ? (
                        // Shows during a silent tool round — as a standalone line on an
                        // empty bubble, or a trailing line under an in-progress reply.
                        // Also shows when a reply has simply stopped arriving: the model
                        // recording a field is a silent stretch too, and a finished-
                        // looking message that is not finished reads as a hang.
                        <span className={`dlg-tool-status${m.content ? " trailing" : ""}`}>
                          <span className="dlg-tool-spinner" />
                          {toolStatus ?? WORKING(locale === "ar")}
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
                  {/* Say what these are.

                      They rendered as bare chips — "NXN Services Guide §7" with
                      nothing around it — and read as internal references leaking
                      into the chat, which is exactly how they were reported. The
                      label existed in the strings all along and was never used. */}
                  {m.citations?.length ? (
                    <div className="dlg-sources">
                      <span className="dlg-sources-label">{t.sources}</span>
                      {m.citations.map((s, k) => (
                        <span className="dlg-source" key={k} title={t.sources}>
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
                <span>{voice.error ? voice.error : voice.connecting ? t.voiceConnecting : voice.speaking ? t.voiceSpeaking : voice.listening ? t.voiceListening : t.voiceOn}</span>
                <button type="button" className="dlg-voice-bar-stop" onClick={voice.toggle}>{t.voiceStop}</button>
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
                  aria-label={voice.active ? t.voiceStop : t.voiceStart}
                  title={voice.active ? t.voiceOn : t.voiceStart}
                >
                  <Microphone size={18} weight={voice.active ? "fill" : iconWeight} />
                </button>
              ) : null}
              {streaming ? (
                // While the agent is replying, the send control becomes a stop
                // control — same spot — so the customer can halt it mid-reply.
                <button className="dlg-send is-stop" onClick={stopStreaming} aria-label={t.stop} title={t.stop}>
                  <Stop size={17} weight="fill" />
                </button>
              ) : (
                <button className="dlg-send" onClick={() => void send()} disabled={!input.trim()} aria-label={t.send}>
                  <PaperPlaneRight size={18} weight="fill" />
                </button>
              )}
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
              <div className="dlg-case-head-main">
                <span className="dlg-case-head-icon">
                  <FileText size={16} weight={iconWeight} />
                </span>
                <div className="dlg-case-head-text">
                  <h2>{t.case}</h2>
                  <span className="dlg-case-sub">{t.caseSub}</span>
                </div>
              </div>
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
                    {/* The number the customer can quote, when it is not the
                        same string the system of record is keyed by. EPGL's
                        submit answers with a Salesforce record id; the panel
                        showed a11FW000X3ht67kYIA where the customer needed
                        LR-37319. */}
                    <strong>{caseState!.referenceLabel ?? caseState!.reference}</strong>
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
                    {/* The bar alone here. The requirements themselves read as a
                        wall of pills directly beneath it — eighteen of them on an
                        EPGL licence — and pushed the details the customer came to
                        check off the screen. The list now sits under DETAILS. */}
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
                          // dir="auto" per VALUE, not per panel. EPGL, 11 September:
                          // "any data available in Arabic should also be extracted
                          // and displayed correctly". An Arabic company name inside
                          // an English session inherited the panel's ltr, which puts
                          // «ش.ذ.م.م» and any bracket or comma on the wrong end of
                          // the string -- the name is right and reads as gibberish.
                          // The reverse happens to a Latin trade licence number in
                          // an Arabic session. Each value is now laid out by its own
                          // script.
                          <span className="dlg-field-value" dir="auto">
                            {maskForDisplay(k, displayValue(v))}
                            {editableKeys.has(k) ? (
                              // Pencil correction for extracted values (FB-1325).
                              <button
                                type="button"
                                className="dlg-field-pencil"
                                // The unmasked value: a customer who retyped
                                // what the panel showed them would save the mask.
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

                {/* WHAT WAS DONE IN THEIR NAME. The conversation above is the
                    live account; this is the one you go back to a week later,
                    with the consent beside each action and the reference it
                    produced. Closed by default — it is a record, not a step. */}
                {caseState && agent.showActivityLog ? (
                  <div className="dlg-card">
                    <h3>
                      <ListChecks size={15} weight="bold" /> {t.activity}
                    </h3>
                    {!activityOpen ? (
                      <button type="button" className="dlg-activity-open" onClick={() => setActivityOpen(true)}>
                        {t.activityLoad}
                      </button>
                    ) : activityBusy && !activity ? (
                      <div className="dlg-activity-empty">…</div>
                    ) : !activity?.length ? (
                      <div className="dlg-activity-empty">{t.activityEmpty}</div>
                    ) : (
                      <ol className="dlg-activity">
                        {activity.map((a, i) => (
                          <li key={i} className={a.result === "ok" ? "ok" : a.result === "refused" ? "refused" : "failed"}>
                            <span className="dlg-activity-when">
                              {new Date(a.at).toLocaleString(locale === "ar" ? "ar-AE" : "en-GB", {
                                day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
                              })}
                            </span>
                            <span className="dlg-activity-what" dir="auto">{a.action}</span>
                            <span className="dlg-activity-meta" dir="auto">
                              {a.requestedBy} → {a.executedBy} · {t.activityConsent}: {a.consent}
                              {a.reference ? ` · ${a.reference}` : ""}
                            </span>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                ) : null}

                {/* What is actually LEFT (FB-1437), under the details rather than
                    above them, and one per line rather than wrapped into pills:
                    at eighteen requirements the wrapped version was a block of
                    text nobody read, and the order it implies — do this, then
                    this — was lost to whatever fitted on each row. Completed
                    items stay, ticked. */}
                {checklist.length ? (
                  <div className="dlg-card">
                    <h3>
                      <ListChecks size={15} weight="bold" /> {t.requirements}
                    </h3>
                    <ul className="dlg-checklist">
                      {checklist.map((m) => (
                        <li className={m.done ? "done" : "todo"} key={`${m.kind}:${m.key}`}>
                          {m.done ? <CheckCircle size={14} weight="fill" /> : <Circle size={14} weight={iconWeight} />}
                          <span>{labelMap.get(m.key) ?? m.key}</span>
                        </li>
                      ))}
                    </ul>
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
