"use client";

import { useEffect } from "react";

/**
 * Blank host page — only the embedded Dialog agent's floating launcher is shown,
 * so the widget can be demoed on its own with no surrounding marketing content.
 * The agent is selected via ?agent=<slug> (falls back to nxn-dialog).
 */
export default function Demo() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const s = document.createElement("script");
    s.src = "/dialog.js";
    s.dataset.agent = params.get("agent") || "nxn-dialog";
    s.dataset.host = window.location.origin;
    s.dataset.locale = params.get("locale") || "en";
    s.async = true;
    document.body.appendChild(s);
    return () => {
      s.remove();
    };
  }, []);

  return <main style={{ minHeight: "100dvh", background: "#fafafa" }} />;
}
