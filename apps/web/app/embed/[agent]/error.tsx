"use client";

import { useEffect } from "react";

/**
 * Segment error boundary for the embed chat. Without it, any render-time throw
 * (a malformed assistant block, an unexpected event shape) crashes the whole
 * conversation and surfaces the raw Next.js "ErrorEvent" overlay in dev / a blank
 * widget in prod. Here it degrades gracefully: the customer sees a small recovery
 * card and can retry without losing their conversation (it's restored from the
 * saved conversation id on reload).
 *
 * Stale-chunk case: after a deploy (or a dev hot-reload while the tab was open),
 * a code-split chunk can 404, throwing a ChunkLoadError. That isn't a real app
 * fault — the fix is to load the fresh assets, so we auto-reload once (guarded
 * against a reload loop).
 */
/** Recovery-card copy in both languages (FB-1445 — no English-only surfaces). */
const ERR_STR = {
  en: {
    title: "The chat hit a snag",
    body: "Something interrupted the conversation. Your progress is saved — pick up where you left off.",
    resume: "Resume chat",
  },
  ar: {
    title: "حدث خطأ في المحادثة",
    body: "حدث ما أوقف المحادثة. تم حفظ ما أنجزته، ويمكنك المتابعة من حيث توقفت.",
    resume: "متابعة المحادثة",
  },
} as const;

export default function EmbedError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // The embed carries its session language in the URL (?locale=ar), which is all
  // this boundary can rely on — it renders when the chat itself failed to mount.
  const locale =
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("locale") === "ar" ? "ar" : "en";
  const t = ERR_STR[locale];
  const rtl = locale === "ar";

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("[embed] chat error boundary:", error);
    const isChunk =
      error?.name === "ChunkLoadError" ||
      /Loading chunk|Loading CSS chunk|dynamically imported module|import\(\)/i.test(error?.message ?? "");
    if (isChunk && typeof window !== "undefined") {
      const KEY = "dlg-chunk-reloaded";
      if (!sessionStorage.getItem(KEY)) {
        sessionStorage.setItem(KEY, "1");
        window.location.reload();
      }
    }
  }, [error]);

  return (
    <div
      role="alert"
      dir={rtl ? "rtl" : "ltr"}
      style={{
        display: "grid",
        placeItems: "center",
        minHeight: "100dvh",
        padding: "24px",
        fontFamily: "-apple-system, system-ui, sans-serif",
        color: "#5b6478",
        background: "#fbfbfd",
      }}
    >
      <div style={{ maxWidth: 340, textAlign: "center" }}>
        <div
          style={{
            width: 44,
            height: 44,
            margin: "0 auto 14px",
            borderRadius: 12,
            display: "grid",
            placeItems: "center",
            background: "#eef0f6",
            fontSize: 22,
          }}
          aria-hidden="true"
        >
          ↻
        </div>
        <p style={{ margin: "0 0 4px", fontWeight: 600, color: "#2b3242", fontSize: 15 }}>{t.title}</p>
        <p style={{ margin: "0 0 16px", fontSize: 13.5, lineHeight: 1.5 }}>{t.body}</p>
        <button
          type="button"
          onClick={() => {
            try {
              reset();
            } catch {
              window.location.reload();
            }
          }}
          style={{
            border: "none",
            borderRadius: 999,
            padding: "10px 22px",
            fontSize: 14,
            fontWeight: 600,
            color: "#fff",
            background: "#3d33d1",
            cursor: "pointer",
          }}
        >
          {t.resume}
        </button>
      </div>
    </div>
  );
}
