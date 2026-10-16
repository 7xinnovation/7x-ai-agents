/**
 * Where UAE PASS sends the browser after clearing its session.
 *
 * Two ways to arrive here, and this page tells them apart:
 *
 *   - As the small window the widget opened on sign-out (the usual case). The
 *     widget cannot see UAE PASS's redirect chain — every hop is cross-origin —
 *     so this is the one place the end of it can be observed. The page tells
 *     the window that opened it, and closes.
 *   - As the tab itself, when pop-ups were blocked and the widget was a tab of
 *     its own: it sent the whole tab here, remembering in sessionStorage where
 *     to come back to. The path is the widget's own and same-origin, so the
 *     tab is sent back there, signed out.
 *
 * There is nothing for anyone to read here; it says what it is for the moment
 * it exists and for a browser that refuses to close a window it did not open.
 */
"use client";

import { useEffect } from "react";

export default function UaePassDone() {
  useEffect(() => {
    let told = false;
    try {
      if (window.opener && window.opener !== window) {
        // Our own origin opened this window; nobody else is told anything.
        window.opener.postMessage({ source: "dialog", action: "uaepass-logged-out" }, window.location.origin);
        told = true;
      }
    } catch { /* an opener we may not talk to */ }
    let back: string | null = null;
    try {
      back = window.sessionStorage.getItem("dlg-signout-return");
      window.sessionStorage.removeItem("dlg-signout-return");
    } catch { /* no storage: nothing to go back to */ }
    // A path on this origin only: "/embed/…", never "//elsewhere" or a scheme.
    if (!told && back && /^\/(?!\/)/.test(back)) {
      window.location.replace(back);
      return;
    }
    /**
     * TOLD, THE OPENER DRIVES THIS WINDOW — DO NOT CLOSE IT (16 October 2026).
     *
     * This used to close itself 150 ms after reporting. The widget polls for
     * the report, so it usually found the window already closed, read that as
     * "the customer closed it", and skipped the next hop: the Emirates Post
     * portal's ?dlg-signout=1, which is what clears the portal's stored token.
     * The portal kept the token we had just ended, and the next Sign in sat on
     * its dashboard ("Welcome MOHAMMAD!") with nothing to hand back.
     *
     * Now the widget takes the window on to the portal and closes it itself.
     * The long timer is only a fallback for an opener that went away.
     */
    const t = window.setTimeout(() => {
      try { window.close(); } catch { /* a window we did not open stays open */ }
    }, told ? 20000 : 400);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <main style={{ font: "15px/1.5 system-ui, sans-serif", padding: 24, textAlign: "center", color: "#374151" }}>
      Signed out of UAE PASS. You can close this window.
    </main>
  );
}
