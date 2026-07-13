"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  Camera,
  UploadSimple,
  CheckCircle,
  ArrowClockwise,
  FileText,
  Info,
  Warning,
} from "@phosphor-icons/react";
import { tr, type Locale, type LocalizedString } from "@dialog/config";

/**
 * Mobile document-upload hand-off page (feedback FB-6). A desktop user scans the
 * case panel's QR code, which opens this page on their phone for a specific
 * conversation. It shows the same document slots and posts to the same
 * /api/upload endpoint, so uploads land on the exact case the agent is building;
 * the desktop panel polls the conversation and reflects them live.
 */

type PublicDoc = {
  key: string;
  label: LocalizedString;
  requirement: "mandatory" | "conditional" | "optional";
  condition?: string;
  acceptedFormats: string[];
  maxSizeMb: number;
};
type PublicJourney = { key: string; title: LocalizedString; steps: { key: string; documents: PublicDoc[] }[] };
type PublicAgent = {
  slug: string;
  name: string;
  locales: Locale[];
  theme: {
    brandName?: string;
    logoUrl?: string;
    fontFamily?: string;
    bodyFont?: string;
    headingFont?: string;
    colors: Record<string, string>;
  };
  documentsDisclaimer?: LocalizedString;
  journeys: PublicJourney[];
};
type CaseDoc = { key: string; status: string; fileName?: string; rejectionReason?: string };
type CaseState = { journeyKey: string | null; data: Record<string, unknown>; documents: CaseDoc[] };

const STR = {
  en: {
    title: "Upload your documents",
    subtitle: "Add the documents for your application. They sync back to your session automatically.",
    takePhoto: "Take photo",
    upload: "Upload file",
    uploading: "Uploading…",
    replace: "Replace",
    optional: "optional",
    upTo: "up to",
    allDone: "All documents received. You can return to your other device.",
    notFound: "This upload link is no longer valid. Please scan the QR code again from your session.",
    noDocs: "There are no documents to upload for this application yet.",
    done: "Received",
  },
  ar: {
    title: "ارفع مستنداتك",
    subtitle: "أضف مستندات طلبك. تتم مزامنتها مع جلستك تلقائياً.",
    takePhoto: "التقاط صورة",
    upload: "رفع ملف",
    uploading: "جارٍ الرفع…",
    replace: "استبدال",
    optional: "اختياري",
    upTo: "حتى",
    allDone: "تم استلام جميع المستندات. يمكنك العودة إلى جهازك الآخر.",
    notFound: "رابط الرفع هذا لم يعد صالحاً. يرجى مسح رمز QR مرة أخرى من جلستك.",
    noDocs: "لا توجد مستندات لرفعها لهذا الطلب بعد.",
    done: "تم الاستلام",
  },
} as const;

// Mirror of the engine's tiny document-condition evaluator.
function condHolds(condition: string | undefined, data: Record<string, unknown>): boolean {
  if (!condition) return true;
  const eq = condition.match(/^\s*([\w.]+)\s*(==|!=)\s*'([^']*)'\s*$/);
  if (eq) {
    const [, key, op, val] = eq;
    const actual = String(data[key!] ?? "");
    return op === "==" ? actual === val : actual !== val;
  }
  return Boolean(data[condition.trim()]);
}

export default function MobileUploadPage() {
  const params = useParams<{ agent: string; cid: string }>();
  const slug = String(params.agent);
  const cid = String(params.cid);
  const [agent, setAgent] = useState<PublicAgent | null>(null);
  const [cs, setCs] = useState<CaseState | null>(null);
  const [locale, setLocale] = useState<Locale>("en");
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [ar, cr] = await Promise.all([
          fetch(`/api/agents/${slug}`),
          fetch(`/api/conversations/${cid}`),
        ]);
        if (!alive) return;
        if (ar.ok) setAgent(await ar.json());
        if (cr.ok) {
          const d = await cr.json();
          setCs(d.case);
          if (d.locale === "ar" || d.locale === "en") setLocale(d.locale);
        } else {
          setNotFound(true);
        }
      } catch {
        if (alive) setNotFound(true);
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [slug, cid]);

  const docSlots = useMemo(() => {
    if (!agent || !cs?.journeyKey) return [];
    const j = agent.journeys.find((x) => x.key === cs.journeyKey);
    if (!j) return [];
    const byKey = new Map(cs.documents.map((d) => [d.key, d]));
    return j.steps
      .flatMap((s) => s.documents)
      .filter((d) => condHolds(d.condition, cs.data) || byKey.has(d.key))
      .map((d) => ({
        ...d,
        status: byKey.get(d.key)?.status ?? "pending",
        fileName: byKey.get(d.key)?.fileName,
        rejectionReason: byKey.get(d.key)?.rejectionReason,
      }));
  }, [agent, cs]);

  const upload = useCallback(
    async (key: string, file: File) => {
      setUploadingKey(key);
      try {
        const fd = new FormData();
        fd.append("agentSlug", slug);
        fd.append("conversationId", cid);
        fd.append("key", key);
        fd.append("file", file);
        const res = await fetch("/api/upload", { method: "POST", body: fd });
        const json = await res.json();
        if (json.case) setCs(json.case);
      } catch {
        /* ignore — the slot stays pending so the user can retry */
      } finally {
        setUploadingKey(null);
      }
    },
    [slug, cid]
  );

  const t = STR[locale];
  const dir = locale === "ar" ? "rtl" : "ltr";
  const c = agent?.theme.colors ?? {};
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

  const allDone = docSlots.length > 0 && docSlots.every((d) => d.status === "uploaded" || d.status === "accepted");

  return (
    <div className="dlg-root dlg-m" style={rootStyle} dir={dir}>
      <header className="dlg-m-head">
        {agent?.theme.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="dlg-header-logo" src={agent.theme.logoUrl} alt={agent.theme.brandName || agent.name} />
        ) : (
          <span className="dlg-m-brand">{agent?.theme.brandName || agent?.name || ""}</span>
        )}
      </header>

      <main className="dlg-m-body">
        {!loaded ? (
          <div className="dlg-m-note">
            <ArrowClockwise size={18} weight="bold" className="spin" />
          </div>
        ) : notFound || !agent ? (
          <div className="dlg-m-note">{t.notFound}</div>
        ) : (
          <>
            <h1 className="dlg-m-title">{t.title}</h1>
            <p className="dlg-m-sub">{t.subtitle}</p>
            {agent.documentsDisclaimer ? (
              <div className="dlg-doc-disclaimer">
                <Info size={15} weight="fill" />
                <span>{tr(agent.documentsDisclaimer, locale)}</span>
              </div>
            ) : null}

            {docSlots.length === 0 ? (
              <div className="dlg-m-note">{t.noDocs}</div>
            ) : (
              <div className="dlg-m-slots">
                {docSlots.map((d) => {
                  const uploaded = d.status === "uploaded" || d.status === "accepted";
                  const busy = uploadingKey === d.key;
                  const accept = d.acceptedFormats.map((f) => "." + f).join(",");
                  return (
                    <div className="dlg-m-slot" key={d.key}>
                      <div className="dlg-docslot-head">
                        <span className="dlg-docslot-name">
                          <FileText size={15} weight="regular" /> {tr(d.label, locale)}
                          {d.requirement === "optional" ? <em> ({t.optional})</em> : null}
                        </span>
                        {uploaded ? (
                          <span className="dlg-doc-status uploaded">
                            <CheckCircle size={13} weight="fill" /> {t.done}
                          </span>
                        ) : null}
                      </div>
                      {uploaded ? (
                        <div className="dlg-m-fname">{d.fileName}</div>
                      ) : (
                        <div className="dlg-m-actions">
                          <label className="dlg-upload">
                            <Camera size={15} weight="bold" /> {t.takePhoto}
                            <input
                              type="file"
                              hidden
                              disabled={busy}
                              accept="image/*"
                              capture="environment"
                              onChange={(e) => e.target.files?.[0] && upload(d.key, e.target.files[0])}
                            />
                          </label>
                          <label className={`dlg-upload ghost ${busy ? "busy" : ""}`}>
                            {busy ? (
                              <>
                                <ArrowClockwise size={14} weight="bold" className="spin" /> {t.uploading}
                              </>
                            ) : (
                              <>
                                <UploadSimple size={15} weight="bold" /> {t.upload}
                              </>
                            )}
                            <input
                              type="file"
                              hidden
                              disabled={busy}
                              accept={accept}
                              onChange={(e) => e.target.files?.[0] && upload(d.key, e.target.files[0])}
                            />
                          </label>
                        </div>
                      )}
                      <div className="dlg-m-hint">
                        {d.acceptedFormats.join(", ").toUpperCase()} · {t.upTo} {d.maxSizeMb}MB
                      </div>
                      {d.status === "rejected" && d.rejectionReason ? (
                        <div className="dlg-docslot-error">
                          <Warning size={13} weight="fill" /> {d.rejectionReason}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}

            {allDone ? (
              <div className="dlg-m-done">
                <CheckCircle size={20} weight="fill" /> {t.allDone}
              </div>
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}
