/**
 * Dialog embed loader. A company drops one script tag:
 *
 *   <script src="https://HOST/dialog.js"
 *           data-agent="epgl-dialog"
 *           data-host="https://HOST"
 *           data-locale="en"></script>
 *
 * data-locale is optional. Left off, the widget follows the PAGE: whatever
 * <html lang> says. Emirates Post and EPGL both serve their Arabic site with
 * lang="ar", so the assistant opens in the language the reader is already in
 * without the host having to wire anything up.
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
  /** localStorage key the host keeps the access token under. */
  tokenKey?: string;
  /**
   * Cookie holding the token, written by dialog-relay.js on the sign-in subdomain.
   *
   * localStorage is per-ORIGIN, so a token stored by box.example.ae is invisible to
   * a script on www.example.ae. A cookie can be scoped to the whole domain, so the
   * relay mirrors it into one and we read it here. Checked after localStorage --
   * a token on our own origin is the more direct source when both exist.
   */
  tokenCookie?: string;
  /**
   * URL of a token bridge page the host serves on the origin that HOLDS the token.
   *
   * localStorage is per-ORIGIN, so a script on www.emiratespost.ae cannot read a
   * token stored by box.emiratespost.ae -- same domain, different origin, no
   * sharing and no storage event across the boundary. When the assistant is
   * embedded on one subdomain and the session lives on another, the host serves a
   * small page from the token's own origin; we frame it hidden, and it reads its
   * own localStorage and hands the token over.
   *
   * Not needed when the script and the token share an origin.
   */
  bridgeUrl?: string;
  /** The host set data-position explicitly, so the agent's theme must not move it. */
  positionPinned: boolean;
}

const STYLE_ID = "dialog-embed-style";
/** Bumped whenever the loader changes, so a host page can say what it is running. */
const VERSION = "2026-09-08e";

/** The locales the app actually has. Anything else falls back to English. */
const LOCALES = ["en", "ar"] as const;

/**
 * Which language to open in.
 *
 * data-locale wins when the host sets it, because that is someone stating an
 * intention. With no attribute we read <html lang> -- the page already knows
 * what language it is in, and on a bilingual site the reader has usually just
 * chosen it. "ar-AE", "AR" and "ar" all mean Arabic, so only the primary subtag
 * is compared, lower-cased.
 *
 * Read once, at boot. Both sites serve their Arabic pages from a different URL,
 * so a language switch is a page load and this runs again; a site that instead
 * rewrote the attribute in place would need the panel reloaded, which would
 * throw away the conversation in it.
 */
function pickLocale(explicit: string | undefined): string {
  const want = (explicit || document.documentElement.getAttribute("lang") || "en")
    .trim()
    .toLowerCase()
    .split(/[-_]/)[0];
  return (LOCALES as readonly string[]).includes(want ?? "") ? want! : "en";
}

function readConfig(): BootConfig {
  const el =
    (document.currentScript as HTMLScriptElement | null) ??
    document.querySelector<HTMLScriptElement>("script[data-agent]");
  const d = el?.dataset ?? {};
  const host = d.host || new URL(el?.src || location.href).origin;
  return {
    agent: d.agent || "default",
    host,
    locale: pickLocale(d.locale),
    position: d.position === "bottom-left" ? "bottom-left" : "bottom-right",
    uaePassToken:
      d.uaepassToken ||
      readStoredToken(d.tokenKey) ||
      readCookieToken(d.tokenCookie) ||
      undefined,
    tokenKey: d.tokenKey || DEFAULT_TOKEN_KEY,
    tokenCookie: d.tokenCookie || DEFAULT_TOKEN_COOKIE,
    bridgeUrl: d.bridgeUrl || undefined,
    positionPinned: d.position === "bottom-left" || d.position === "bottom-right",
  };
}

/**
 * Emirates Post stores the signed-in customer's access token in localStorage
 * under "accessToken" (confirmed by their team). Reading it here means the host
 * page needs no integration work at all — dropping the script tag is the whole
 * job.
 *
 * Wrapped because localStorage throws outright in some privacy modes and inside
 * a partitioned third-party context; the assistant must still load for a guest
 * rather than dying on the way up. `data-token-key` overrides the name for a host
 * that keeps it somewhere else.
 */
const DEFAULT_TOKEN_KEY = "accessToken";

/** Cookie dialog-relay.js writes on the sign-in subdomain. */
const DEFAULT_TOKEN_COOKIE = "dlg_host_token";

/**
 * Token relayed from a sibling subdomain via a domain-scoped cookie.
 *
 * Unlike localStorage this needs no permission and cannot throw, but it is only
 * ever present when the host has installed dialog-relay.js on the origin that
 * signs the customer in.
 */
function readCookieToken(name?: string): string | null {
  const key = `${name || DEFAULT_TOKEN_COOKIE}=`;
  const parts = String(document.cookie || "").split(";");
  for (const part of parts) {
    const p = part.trim();
    if (!p.startsWith(key)) continue;
    const raw = p.slice(key.length);
    if (!raw) return null;
    try {
      const v = decodeURIComponent(raw);
      return v.trim() ? v.trim() : null;
    } catch {
      return raw.trim() ? raw.trim() : null;
    }
  }
  return null;
}

function readStoredToken(key?: string): string | null {
  try {
    const v = window.localStorage.getItem(key || DEFAULT_TOKEN_KEY);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

function injectStyles(cfg: BootConfig) {
  if (document.getElementById(STYLE_ID)) return;
  // Placement lives in custom properties, not in the rule, because the agent's
  // theme arrives after these styles are injected -- and because a host page can
  // already have an accessibility button and another chat bubble in the corner
  // we would otherwise land on.
  const left = cfg.position === "bottom-left";
  const css = `
  :root{--dlg-accent:#2626a1;--dlg-accent-2:#1c1c7d;--dlg-accent-fg:#fff;
    --dlg-bottom:24px;--dlg-side:24px;
    --dlg-left:${left ? "var(--dlg-side)" : "auto"};--dlg-right:${left ? "auto" : "var(--dlg-side)"}}
  .dlg-launcher{position:fixed;bottom:var(--dlg-bottom);left:var(--dlg-left);right:var(--dlg-right);z-index:2147483000;width:56px;height:56px;border-radius:9999px;border:none;cursor:pointer;padding:0;
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
    opacity:0;visibility:hidden;transform:translateY(14px) scale(.98);transform-origin:bottom ${left ? "left" : "right"};
    transition:opacity .3s cubic-bezier(.16,1,.3,1),transform .3s cubic-bezier(.16,1,.3,1),visibility .3s,width .3s ease,height .3s ease,border-radius .3s ease}
  /* The panel never exceeds the window it is sitting in.
     404x640 is the size it WANTS; the max-* are the size it may have. Without
     them a browser window narrower than about 470px — or shorter than the panel
     plus the launcher — put part of the conversation off-screen, and the host
     page cannot correct that from its side. dvh where it is understood, so a
     mobile address bar sliding away does not leave a gap. */
  .dlg-frame.widget{bottom:calc(var(--dlg-bottom) + 72px);left:var(--dlg-left);right:var(--dlg-right);
    width:404px;height:640px;
    max-width:calc(100vw - 32px);
    max-height:calc(100vh - var(--dlg-bottom) - 88px);max-height:calc(100dvh - var(--dlg-bottom) - 88px)}
  .dlg-frame.full{inset:0;width:100vw;height:100vh;height:100dvh;border-radius:0;transform-origin:center}
  .dlg-frame.open{opacity:1;visibility:visible;transform:none}
  /* Narrow OR short: a landscape phone is 720px wide and 360px tall, and a
     panel that has to fit above a launcher in 360px is not a panel. */
  @media (max-width:640px),(max-height:520px){
    .dlg-frame.widget{inset:0;width:100vw;height:100vh;height:100dvh;max-width:none;max-height:none;border-radius:0}
  }
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

    // Placement, unless the host pinned it on the script tag. Hosts should not
    // have to edit their page for us to move out of the way of something else in
    // the corner.
    const l = data?.theme?.launcher ?? {};
    const root = document.documentElement.style;
    if (!cfg.positionPinned && (l.position === "bottom-left" || l.position === "bottom-right")) {
      const isLeft = l.position === "bottom-left";
      root.setProperty("--dlg-left", isLeft ? "var(--dlg-side)" : "auto");
      root.setProperty("--dlg-right", isLeft ? "auto" : "var(--dlg-side)");
    }
    const px = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 400 ? `${Math.round(v)}px` : null);
    const bottom = px(l.offsetBottom);
    const side = px(l.offsetSide);
    // Both edges read --dlg-side, so whichever one is live picks this up.
    if (bottom) root.setProperty("--dlg-bottom", bottom);
    if (side) root.setProperty("--dlg-side", side);
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

  const push = (token: string) =>
    frame.contentWindow?.postMessage({ source: "dialog-host", uaePassToken: token }, cfg.host);

  // Host can still refresh the token explicitly:
  //   window.Dialog.setUaePassToken("<token>")
  // `version` so a page can say which loader it is running. A widget that
  // misbehaves on someone else's site is otherwise diagnosed by guessing whether
  // they have the current file.
  (window as unknown as { Dialog?: Record<string, unknown> }).Dialog = {
    setUaePassToken: push,
    version: VERSION,
  };

  /**
   * Follow the stored token for the life of the page.
   *
   * The customer usually signs in AFTER the assistant has loaded, so the token
   * read at boot is very often absent — treating that as "guest, permanently"
   * would mean the assistant stays signed out through a sign-in happening right
   * next to it. `storage` catches other tabs; localStorage fires nothing for a
   * write in THIS tab, so it is also polled, cheaply and only while the value has
   * actually changed.
   */
  let lastSeen = cfg.uaePassToken ?? null;
  const sync = () => {
    const token = readStoredToken(cfg.tokenKey) ?? readCookieToken(cfg.tokenCookie);
    if (token === lastSeen) return;
    lastSeen = token;
    if (token) push(token);
  };
  window.addEventListener("storage", (e) => {
    if (!e.key || e.key === (cfg.tokenKey || DEFAULT_TOKEN_KEY)) sync();
  });
  setInterval(sync, 2000);

  /**
   * Cross-subdomain handoff. The bridge is framed from the origin that owns the
   * token, so ITS localStorage is the one with the session in it.
   *
   * We ask rather than wait: the bridge cannot know our origin unaided, so it
   * validates the request's origin against its own allow-list and replies to that
   * origin only. Re-asking on an interval covers a sign-in that happens later --
   * the bridge also pushes unprompted when it sees its own storage change, so this
   * is a floor on latency, not the only path.
   *
   * Same-site subdomains are not a third-party context, so this is not subject to
   * storage partitioning: the bridge sees the real localStorage, not a partitioned
   * copy of it.
   */
  if (cfg.bridgeUrl) {
    let bridgeOrigin = "";
    try {
      bridgeOrigin = new URL(cfg.bridgeUrl).origin;
    } catch {
      bridgeOrigin = "";
    }
    if (bridgeOrigin) {
      const bridge = document.createElement("iframe");
      bridge.setAttribute("aria-hidden", "true");
      bridge.title = "Dialog token bridge";
      bridge.style.cssText = "position:absolute;width:0;height:0;border:0;visibility:hidden;left:-9999px;";
      bridge.src = cfg.bridgeUrl;

      const ask = () => bridge.contentWindow?.postMessage({ source: "dialog-bridge-request" }, bridgeOrigin);

      window.addEventListener("message", (e) => {
        if (e.origin !== bridgeOrigin) return;
        const m = e.data as { source?: string; token?: unknown };
        if (m?.source !== "dialog-bridge" || typeof m.token !== "string" || !m.token) return;
        if (m.token === lastSeen) return;
        lastSeen = m.token;
        push(m.token);
      });

      bridge.addEventListener("load", () => {
        ask();
        setInterval(ask, 5000);
      });
      document.body.appendChild(bridge);
    }
  }

  const launcher = document.createElement("button");
  launcher.className = "dlg-launcher";
  launcher.setAttribute("aria-label", "Open assistant");
  launcher.innerHTML = CHAT_ICON + X_ICON;

  /**
   * Size the panel against the window, in an inline style.
   *
   * The stylesheet already caps it, and a stylesheet is the host page's to
   * override: one `iframe{height:100%!important}` on their side, or any rule
   * more specific than ours, and the panel is whatever they said. It is then
   * taller than the window, the browser clips it, and because the panel is
   * anchored to the BOTTOM what disappears is the header — the logo, the
   * language switch, the sign-in button — while the conversation underneath
   * carries on working. Quiet, and reported as "the widget does not fit".
   *
   * An inline style beats any rule that is not !important, so this is the size
   * the panel actually gets. Recomputed on resize, and on the visual viewport
   * too: a mobile keyboard sliding up changes the space without changing
   * window.innerHeight.
   */
  const WANT_W = 404, WANT_H = 640;
  /**
   * The same breakpoint the stylesheet uses for its full-bleed panel.
   *
   * These have to agree, and they did not. The stylesheet says a narrow OR short
   * window gets `inset:0; width:100vw; height:100dvh; max-width:none` -- and then
   * fit() wrote an inline 404-wide panel over the top of it, because an inline
   * style beats a media query. So on exactly the screens that need the whole
   * window, the panel was pinned to a size that did not fit, by the code meant to
   * make it fit.
   */
  const COMPACT = "(max-width:640px),(max-height:520px)";
  const clearSize = () => {
    for (const p of ["width", "height", "max-width", "max-height"]) frame.style.removeProperty(p);
  };
  function fit() {
    // Full-screen, or small enough that the stylesheet takes it full-bleed:
    // step out of the way and let the CSS own it.
    if (mode === "full" || window.matchMedia(COMPACT).matches) {
      clearSize();
      return;
    }
    const vv = window.visualViewport;
    const vh = Math.round(vv?.height ?? window.innerHeight);
    const vw = Math.round(vv?.width ?? window.innerWidth);
    // What the CSS reserves: the launcher, the gap above it, and the offset
    // below it. Read from the computed value so a data-offset-bottom is obeyed.
    const bottom = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--dlg-bottom"), 10) || 24;
    const room = vh - bottom - 88;
    // Written with `important`, because a plain inline style still loses to a
    // host rule that carries !important -- and a page we do not control is
    // exactly where that happens.
    const set = (prop: string, px: number) => frame.style.setProperty(prop, `${px}px`, "important");
    set("width", Math.min(WANT_W, Math.max(0, vw - 32)));
    set("height", Math.min(WANT_H, Math.max(0, room)));
    set("max-width", Math.max(0, vw - 32));
    set("max-height", Math.max(0, room));
  }

  /**
   * What the panel actually ended up as, for when it still does not fit.
   *
   * I have twice reasoned about this from a screenshot and been wrong, so the
   * page can now say for itself: window.Dialog.diagnose() in the console on the
   * host page returns the numbers rather than an impression of them.
   */
  function diagnose() {
    const r = frame.getBoundingClientRect();
    const cs = getComputedStyle(frame);
    // position:fixed is measured against the nearest ancestor with a transform,
    // filter or perspective -- not the window. A host page that animates a
    // wrapper moves and clips everything fixed inside it, and nothing in our
    // own CSS can reach that.
    let culprit: string | null = null;
    for (let el: HTMLElement | null = frame.parentElement; el; el = el.parentElement) {
      const s2 = getComputedStyle(el);
      if (s2.transform !== "none" || s2.filter !== "none" || s2.perspective !== "none" || s2.contain.includes("paint")) {
        culprit = `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${el.className ? "." + String(el.className).split(/\s+/).join(".") : ""}`;
        break;
      }
    }
    return {
      version: VERSION,
      mode,
      rect: r.toJSON(),
      computed: { width: cs.width, height: cs.height, maxWidth: cs.maxWidth, maxHeight: cs.maxHeight, position: cs.position, zIndex: cs.zIndex },
      window: { innerWidth: window.innerWidth, innerHeight: window.innerHeight, visualViewport: window.visualViewport ? [window.visualViewport.width, window.visualViewport.height] : null },
      compact: window.matchMedia(COMPACT).matches,
      clippedAtTop: r.top < 0,
      clippedAtLeft: r.left < 0,
      overflowsRight: r.right > window.innerWidth,
      overflowsBottom: r.bottom > window.innerHeight,
      /** A transformed/filtered ancestor, which breaks position:fixed. */
      fixedPositioningBrokenBy: culprit,
      lang: document.documentElement.getAttribute("lang"),
    };
  }

  /** Has the panel ever been opened? Once it has, its src must not be replaced. */
  let opened = false;

  function setMode(next: Mode) {
    mode = next;
    if (next !== "closed") opened = true;
    frame.classList.toggle("open", next !== "closed");
    frame.classList.toggle("full", next === "full");
    frame.classList.toggle("widget", next === "widget");
    launcher.classList.toggle("open", next !== "closed");
    launcher.style.display = next === "full" ? "none" : "flex";
    document.documentElement.style.overflow = next === "full" ? "hidden" : "";
    fit();
    // Measured after the browser has laid the new mode out, not before.
    requestAnimationFrame(enforceVisible);
  }

  const refit = () => { fit(); requestAnimationFrame(enforceVisible); };
  addEventListener("resize", refit);
  window.visualViewport?.addEventListener("resize", refit);

  /**
   * KEEP the size, rather than setting it once and hoping.
   *
   * fit() runs at boot, and a host stylesheet that finishes loading afterwards
   * can still take the panel over -- the sizing was correct for the moment it
   * was applied and wrong a tick later, which is indistinguishable from never
   * having worked. Reported three times from emiratespost.ae, with the panel
   * taller than the window and its header clipped off the top.
   *
   * So the panel is watched, and any drift from what fit() intends is put back.
   * Tolerance of 2px because subpixel layout is not drift, and only while the
   * panel is open and not full-screen, where the size is deliberately the CSS's.
   */
  if (typeof ResizeObserver !== "undefined") {
    let correcting = false;
    const ro = new ResizeObserver(() => {
      if (correcting || mode !== "widget" || window.matchMedia(COMPACT).matches) return;
      const r = frame.getBoundingClientRect();
      const wantW = Math.min(WANT_W, Math.max(0, Math.round(window.visualViewport?.width ?? window.innerWidth) - 32));
      const bottom = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--dlg-bottom"), 10) || 24;
      const wantH = Math.min(WANT_H, Math.max(0, Math.round(window.visualViewport?.height ?? window.innerHeight) - bottom - 88));
      if (Math.abs(r.width - wantW) <= 2 && Math.abs(r.height - wantH) <= 2) return;
      correcting = true;
      fit();
      // Let the browser settle before listening again, so re-applying the size
      // cannot feed itself.
      requestAnimationFrame(() => { correcting = false; });
    });
    ro.observe(frame);
  }
  /**
   * IF THE PANEL DOES NOT FIT, MAKE IT FILL THE SCREEN.
   *
   * Three rounds of this now. The panel is sized against the window and written
   * inline with `important`, and on emiratespost.ae it still comes out clipped
   * with its header above the top of the viewport -- so something on that page
   * is deciding the geometry in a way our stylesheet cannot reach. The usual
   * suspect is an ancestor with a transform, filter or perspective, which makes
   * the browser resolve position:fixed against THAT element instead of the
   * window; diagnose() names it if so.
   *
   * Whatever the cause, a clipped panel is unusable and a full-screen one is
   * not. So rather than keep insisting on a size the page will not give us, we
   * check what we actually got: if the frame has landed outside the viewport on
   * any edge, it goes full-screen, which needs no cooperation from the host --
   * inset 0 against the window, written inline and important.
   *
   * Deliberately narrow. Being a few pixels off is not this; being off the edge
   * of the screen is. A panel that fits is never touched.
   */
  let enforced = false;
  function enforceVisible() {
    if (mode !== "widget" || window.matchMedia(COMPACT).matches) return;
    const r = frame.getBoundingClientRect();
    if (!r.width || !r.height) return; // not laid out yet
    const outside = r.top < 0 || r.left < 0 || r.bottom > window.innerHeight + 4 || r.right > window.innerWidth + 4;
    if (!outside) return;
    for (const [prop, value] of [
      ["position", "fixed"], ["top", "0px"], ["left", "0px"], ["right", "0px"], ["bottom", "0px"],
      ["width", "100vw"], ["height", "100dvh"], ["max-width", "none"], ["max-height", "none"], ["border-radius", "0"],
    ] as const) {
      frame.style.setProperty(prop, value, "important");
    }
    // Say so once, so this shows up as a diagnosis rather than as a mystery.
    if (!enforced) {
      enforced = true;
      // eslint-disable-next-line no-console
      console.warn("[dialog] panel was clipped by the page; switched to full screen. window.Dialog.diagnose() for details.");
    }
  }

  // The app inside can change the layout as it loads; size it again once it has.
  frame.addEventListener("load", () => { fit(); requestAnimationFrame(enforceVisible); });
  fit();

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

  /**
   * Follow the page's language while it is open.
   *
   * Reading <html lang> at boot covers a site that navigates to switch language.
   * Emirates Post does not: the toggle swaps the attribute in place, so the page
   * turned Arabic and the assistant stayed English until someone reloaded.
   *
   * The panel is told, rather than reloaded. Reloading the iframe would swap the
   * language by throwing away the conversation in it, which is a worse answer
   * than the problem — the app holds its locale in state and can just switch.
   */
  function watchLang() {
    let current = cfg.locale;
    const obs = new MutationObserver(() => {
      const next = pickLocale(undefined);
      // Only when the PAGE decided it. A host that pinned data-locale meant it.
      if (next === current || readConfig().locale !== next) return;
      current = next;
      cfg.locale = next;
      // The panel may not have been opened yet, in which case its src carries
      // the new locale already and there is nothing to tell.
      try {
        frame.contentWindow?.postMessage({ source: "dialog-host", action: "locale", locale: next }, new URL(cfg.host).origin);
      } catch {
        /* not loaded yet, or gone; the src below is the fallback */
      }
      // Rewriting src RELOADS the panel, so it is only safe while the panel has
      // never been opened. Once there is a conversation in it, the message above
      // is the whole answer -- swapping the language by discarding what the
      // customer has typed is not switching language, it is starting again.
      if (mode === "closed" && !opened) {
        frame.src = frame.src.replace(/([?&]locale=)[^&]*/, `$1${next}`);
      }
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
  }
  watchLang();

  document.body.appendChild(frame);
  document.body.appendChild(launcher);
  // Now that the frame exists, the page can be asked what it actually looks like.
  const dlg = (window as unknown as { Dialog?: Record<string, unknown> }).Dialog;
  if (dlg) dlg.diagnose = diagnose;
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
