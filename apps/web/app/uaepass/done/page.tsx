/**
 * Where UAE PASS sends the browser after clearing its session.
 *
 * Opened by the widget in a small window purely so the logout happens as a
 * top-level navigation on UAE PASS's origin — the only way a cookie there can
 * be cleared. There is nothing for anyone to read here, so it closes itself,
 * and says what it is for the second it exists and for a browser that refuses
 * to close a window it did not open.
 */
"use client";

import { useEffect } from "react";

export default function UaePassDone() {
  useEffect(() => {
    const t = window.setTimeout(() => {
      try { window.close(); } catch { /* a window we did not open stays open */ }
    }, 400);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <main style={{ font: "15px/1.5 system-ui, sans-serif", padding: 24, textAlign: "center", color: "#374151" }}>
      Signed out of UAE PASS. You can close this window.
    </main>
  );
}
