"use client";

import { useEffect } from "react";
import { ChatsCircle, ShieldCheck, Lightning, FileText } from "@phosphor-icons/react";

/**
 * A pretend customer website that installs the agent via the loader snippet —
 * a credible premium portal so the floating widget is shown in real context.
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

  const openAssistant = () => {
    document.querySelector<HTMLButtonElement>(".dlg-launcher")?.click();
  };

  return (
    <main className="host">
      <nav className="host-nav">
        <div className="host-logo">
          <span className="host-logo-mark">
            <ShieldCheck size={18} weight="fill" />
          </span>
          Northbridge Licensing
        </div>
        <div className="host-navlinks">
          <span>Services</span>
          <span>Licenses</span>
          <span>Support</span>
        </div>
        <button className="host-cta" onClick={openAssistant}>
          Get started
        </button>
      </nav>

      <section className="host-hero">
        <span className="host-eyebrow">
          <ChatsCircle size={15} weight="fill" /> Powered by Dialog
        </span>
        <h1>Licensing, handled in a conversation.</h1>
        <p>
          Apply for and renew courier licenses by chatting in plain language. No long forms, no guesswork.
          Your application assembles itself as you talk.
        </p>
        <div className="host-actions">
          <button className="host-primary" onClick={openAssistant}>
            Start with the assistant
          </button>
          <button className="host-ghost">Browse licenses</button>
        </div>
      </section>

      <section className="host-grid">
        <div className="host-feature">
          <span className="host-feature-icon">
            <FileText size={22} weight="regular" />
          </span>
          <h3>Guided, not bureaucratic</h3>
          <p>Answer a few questions and the right documents are requested for your license type. Nothing more.</p>
        </div>
        <div className="host-feature">
          <span className="host-feature-icon">
            <Lightning size={22} weight="regular" />
          </span>
          <h3>See it come together</h3>
          <p>A live case panel shows exactly what is collected, what is validated, and what is still needed.</p>
        </div>
        <div className="host-feature">
          <span className="host-feature-icon">
            <ShieldCheck size={22} weight="regular" />
          </span>
          <h3>Grounded answers</h3>
          <p>Guidance comes from the approved knowledge base, with a quiet path to a human whenever you need one.</p>
        </div>
      </section>

      <p className="host-note">
        This page is a stand-in for a customer website. The floating button (bottom-right) is the embedded Dialog
        agent. Open it, then choose Expand for the full-page split screen.
      </p>
    </main>
  );
}
