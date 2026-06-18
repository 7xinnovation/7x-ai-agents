"use client";

import { useEffect } from "react";

/**
 * Blank host page — only the embedded Dialog agent's floating launcher is shown,
 * so the widget can be demoed on its own with no surrounding marketing content.
 */
export default function Demo() {
  useEffect(() => {
    const s = document.createElement("script");
    s.src = "/dialog.js";
    s.dataset.agent = "epgl-dialog";
    s.dataset.host = window.location.origin;
    s.dataset.locale = "en";
    s.async = true;
    document.body.appendChild(s);
    return () => {
      s.remove();
    };
  }, []);

  return <main style={{ minHeight: "100dvh", background: "#fafafa" }} />;
}
