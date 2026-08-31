/**
 * Show the Customer Pulse survey once the purchase is done.
 *
 * The widget is a web component loaded from Customer Pulse's own host, and it is
 * loaded LAZILY — only for the one customer in a hundred who actually completes a
 * purchase, rather than on every page view. It renders as a modal, opened a
 * couple of seconds after the confirmation lands so the customer reads their box
 * number first; that delay is what Emirates Post's own portal does.
 *
 * Every failure here is silent. The rental is complete and paid by this point,
 * and a survey that cannot load is not the customer's problem.
 */
const SANDBOX = "https://sandboxsurvey.customerpulse.gov.ae/destination/index.js";
const PRODUCTION = "https://survey.customerpulse.gov.ae/destination/index.js";

declare global {
  interface Window {
    CustomerPulse?: {
      render: (el: Element, opts: Record<string, unknown>) => void;
      openModal: () => void;
      closeModal: () => void;
    };
  }
}

let loading: Promise<boolean> | null = null;

function loadWidget(src: string): Promise<boolean> {
  if (window.CustomerPulse) return Promise.resolve(true);
  if (loading) return loading;
  loading = new Promise<boolean>((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-dlg-pulse="1"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(Boolean(window.CustomerPulse)), { once: true });
      existing.addEventListener("error", () => resolve(false), { once: true });
      return;
    }
    const el = document.createElement("script");
    el.src = src;
    el.async = true;
    el.dataset.dlgPulse = "1";
    el.onload = () => resolve(Boolean(window.CustomerPulse));
    el.onerror = () => resolve(false);
    document.head.appendChild(el);
  });
  return loading;
}

export async function showSurvey(token: string, locale: string, sandbox: boolean): Promise<void> {
  const ok = await loadWidget(sandbox ? SANDBOX : PRODUCTION);
  if (!ok || !window.CustomerPulse) return;
  // Its own container, outside the chat's DOM: the widget replaces the contents
  // of whatever element it is given.
  let host = document.getElementById("dlg-pulse-host");
  if (!host) {
    host = document.createElement("div");
    host.id = "dlg-pulse-host";
    document.body.appendChild(host);
  }
  try {
    window.CustomerPulse.render(host, { token, lang: locale === "ar" ? "ar" : "en", modal: true });
    window.setTimeout(() => {
      try { window.CustomerPulse?.openModal(); } catch { /* the widget decides */ }
    }, 2000);
  } catch {
    /* a widget that will not render is not worth a word to the customer */
  }
}
