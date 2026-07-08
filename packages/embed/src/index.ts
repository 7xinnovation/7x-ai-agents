/**
 * Dialog embed loader. A company drops one script tag:
 *
 *   <script src="https://HOST/dialog.js"
 *           data-agent="epgl-dialog"
 *           data-host="https://HOST"
 *           data-locale="en"></script>
 *
 * It injects a floating launcher and an iframe-isolated app. The iframe loads
 * /embed/<agent>; all branding/behaviour comes from the agent config, so this
 * loader carries zero company-specific code. It fetches the agent's theme so the
 * launcher matches each company's brand. Expand/collapse is bridged over
 * postMessage so the iframe drives its own full-page split-screen layout.
 */

type Mode = "closed" | "widget" | "full";

interface BootConfig {
  agent: string;
  host: string;
  locale: string;
  position: "bottom-right" | "bottom-left";
  uaePassToken?: string;
}

const STYLE_ID = "dialog-embed-style";

function readConfig(): BootConfig {
  const el =
    (document.currentScript as HTMLScriptElement | null) ??
    document.querySelector<HTMLScriptElement>("script[data-agent]");
  const d = el?.dataset ?? {};
  const host = d.host || new URL(el?.src || location.href).origin;
  return {
    agent: d.agent || "default",
    host,
    locale: d.locale || "en",
    position: d.position === "bottom-left" ? "bottom-left" : "bottom-right",
    uaePassToken: d.uaepassToken || undefined,
  };
}

function injectStyles(cfg: BootConfig) {
  if (document.getElementById(STYLE_ID)) return;
  const side = cfg.position === "bottom-left" ? "left: 24px;" : "right: 24px;";
  const css = `
  :root{--dlg-accent:#2626a1;--dlg-accent-2:#1c1c7d;--dlg-accent-fg:#fff}
  .dlg-launcher{position:fixed;bottom:24px;${side}z-index:2147483000;width:56px;height:56px;border-radius:9999px;border:none;cursor:pointer;padding:0;
    background:var(--dlg-accent);
    background:linear-gradient(180deg,color-mix(in srgb,var(--dlg-accent) 88%,#fff),var(--dlg-accent-2));
    color:var(--dlg-accent-fg);
    display:flex;align-items:center;justify-content:center;
    box-shadow:0 10px 26px -8px color-mix(in srgb,var(--dlg-accent) 55%,transparent),0 3px 8px rgba(16,24,40,.14),inset 0 0 0 1px rgba(255,255,255,.10),inset 0 1px 0 rgba(255,255,255,.22),inset 0 -2px 3px color-mix(in srgb,var(--dlg-accent-2) 60%,transparent);
    transition:transform .24s cubic-bezier(.16,1,.3,1),box-shadow .24s ease;will-change:transform;animation:dlg-pop .4s cubic-bezier(.16,1,.3,1) both}
  .dlg-launcher::before{content:"";position:absolute;inset:-7px;border-radius:inherit;z-index:-1;pointer-events:none;
    background:radial-gradient(closest-side,color-mix(in srgb,var(--dlg-accent) 32%,transparent),transparent);
    filter:blur(9px);animation:dlg-breathe 4.5s ease-in-out infinite}
  .dlg-launcher:hover::before{animation-play-state:paused;opacity:.85}
  .dlg-launcher.open::before{display:none}
  .dlg-launcher:hover{transform:translateY(-2px) scale(1.04);box-shadow:0 16px 34px -8px color-mix(in srgb,var(--dlg-accent) 62%,transparent),0 5px 12px rgba(16,24,40,.16),inset 0 0 0 1px rgba(255,255,255,.12),inset 0 1px 0 rgba(255,255,255,.22)}
  .dlg-launcher:active{transform:scale(.94)}
  .dlg-launcher svg{position:absolute;transition:opacity .2s ease,transform .28s cubic-bezier(.16,1,.3,1)}
  .dlg-launcher .ic-x{opacity:0;transform:rotate(-90deg) scale(.6)}
  .dlg-launcher.open .ic-chat{opacity:0;transform:rotate(90deg) scale(.6)}
  .dlg-launcher.open .ic-x{opacity:1;transform:none}
  .dlg-frame{position:fixed;border:none;z-index:2147483001;background:transparent;border-radius:22px;
    box-shadow:0 0 0 1px rgba(16,24,40,.07),0 30px 80px rgba(16,24,40,.28),0 8px 24px rgba(16,24,40,.16);
    opacity:0;visibility:hidden;transform:translateY(14px) scale(.98);transform-origin:bottom ${cfg.position === "bottom-left" ? "left" : "right"};
    transition:opacity .3s cubic-bezier(.16,1,.3,1),transform .3s cubic-bezier(.16,1,.3,1),visibility .3s,width .3s ease,height .3s ease,border-radius .3s ease}
  .dlg-frame.widget{bottom:96px;${side}width:404px;height:640px;max-height:calc(100vh - 120px)}
  .dlg-frame.full{inset:0;width:100vw;height:100vh;border-radius:0;transform-origin:center}
  .dlg-frame.open{opacity:1;visibility:visible;transform:none}
  @media (max-width:640px){.dlg-frame.widget{inset:0;width:100vw;height:100vh;border-radius:0}}
  @media (prefers-reduced-motion:reduce){.dlg-launcher{animation:none}.dlg-launcher::before{animation:none}.dlg-launcher,.dlg-launcher svg,.dlg-frame{transition:opacity .15s linear}}
  @keyframes dlg-pop{from{opacity:0;transform:translateY(10px) scale(.8)}to{opacity:1;transform:none}}
  @keyframes dlg-breathe{0%,100%{transform:scale(1);opacity:.45}50%{transform:scale(1.14);opacity:.75}}
  `;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = css;
  document.head.appendChild(style);
}

// Apply the agent's brand color to the launcher so it matches each company.
async function applyTheme(cfg: BootConfig) {
  try {
    const res = await fetch(`${cfg.host}/api/agents/${encodeURIComponent(cfg.agent)}`);
    if (!res.ok) return;
    const data = await res.json();
    const primary: string | undefined = data?.theme?.colors?.primary;
    const fg: string | undefined = data?.theme?.colors?.primaryForeground;
    if (primary) {
      document.documentElement.style.setProperty("--dlg-accent", primary);
      // Slightly darker same-hue shade for depth (no light-to-bright gradient).
      document.documentElement.style.setProperty("--dlg-accent-2", `color-mix(in srgb, ${primary} 86%, black)`);
    }
    if (fg) document.documentElement.style.setProperty("--dlg-accent-fg", fg);
  } catch {
    /* keep defaults */
  }
}

const CHAT_ICON =
  '<svg class="ic-chat" width="25" height="25" viewBox="0 0 24 24" fill="currentColor"><path d="M12 4c-4.7 0-8.5 3-8.5 6.8 0 1.5.6 2.9 1.6 4.05-.16 1.02-.5 1.98-1.05 2.86-.2.32.02.74.4.72 1.4-.06 2.75-.42 3.9-1.06 1.1.42 2.34.65 3.65.65 4.7 0 8.5-3.05 8.5-6.87S16.7 4 12 4Zm-3.6 7.85a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4Zm3.6 0a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4Zm3.6 0a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4Z"/></svg>';
const X_ICON =
  '<svg class="ic-x" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

function boot() {
  const cfg = readConfig();
  injectStyles(cfg);
  void applyTheme(cfg);

  let mode: Mode = "closed";

  const frame = document.createElement("iframe");
  frame.className = "dlg-frame widget";
  frame.title = "Dialog assistant";
  frame.allow = "clipboard-write; microphone";
  const upt = cfg.uaePassToken ? `&upt=${encodeURIComponent(cfg.uaePassToken)}` : "";
  frame.src = `${cfg.host}/embed/${encodeURIComponent(cfg.agent)}?locale=${cfg.locale}&embedded=1${upt}`;

  // Host can refresh the UAE PASS session token at runtime (e.g. after sign-in):
  //   window.Dialog.setUaePassToken("<token>")
  (window as unknown as { Dialog?: Record<string, unknown> }).Dialog = {
    setUaePassToken: (token: string) => frame.contentWindow?.postMessage({ source: "dialog-host", uaePassToken: token }, cfg.host),
  };

  const launcher = document.createElement("button");
  launcher.className = "dlg-launcher";
  launcher.setAttribute("aria-label", "Open assistant");
  launcher.innerHTML = CHAT_ICON + X_ICON;

  function setMode(next: Mode) {
    mode = next;
    frame.classList.toggle("open", next !== "closed");
    frame.classList.toggle("full", next === "full");
    frame.classList.toggle("widget", next === "widget");
    launcher.classList.toggle("open", next !== "closed");
    launcher.style.display = next === "full" ? "none" : "flex";
    document.documentElement.style.overflow = next === "full" ? "hidden" : "";
  }

  launcher.addEventListener("click", () => setMode(mode === "closed" ? "widget" : "closed"));

  // Bridge: the iframe app requests expand/collapse/close.
  window.addEventListener("message", (e) => {
    if (e.origin !== cfg.host) return;
    const msg = e.data as { source?: string; action?: string };
    if (msg?.source !== "dialog") return;
    if (msg.action === "expand") setMode("full");
    else if (msg.action === "collapse") setMode("widget");
    else if (msg.action === "close") setMode("closed");
  });

  document.body.appendChild(frame);
  document.body.appendChild(launcher);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
