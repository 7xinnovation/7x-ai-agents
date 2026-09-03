/**
 * One way out of the widget, whether it is running in a browser or a WebView.
 *
 * The chat opens four things in a window it does not own: the payment page on
 * our checkout, the payment page on Emirates Post's, the host's sign-in, and
 * UAE PASS. In a browser that is `window.open`. Inside a React Native WebView
 * `window.open` returns null, and the fallback — navigating the WebView itself —
 * replaces the conversation with a payment page and offers no way back to it.
 *
 * So the native host is asked to open the URL instead, and tells us when the
 * customer comes back. react-native-webview injects `window.ReactNativeWebView`,
 * which is the signal; nothing on the page has to be configured for it.
 */

export interface ExternalWindow {
  /** True once the customer has closed or finished with it. */
  closed: boolean;
  close(): void;
}

export interface NativeEvent {
  /** "returned" once the customer is back from a payment page. */
  action: string;
  url?: string;
}

interface RNWebView {
  postMessage(message: string): void;
}

declare global {
  interface Window {
    ReactNativeWebView?: RNWebView;
  }
}

export function isNative(): boolean {
  return typeof window !== "undefined" && Boolean(window.ReactNativeWebView);
}

/**
 * Tell the native host something happened in here.
 *
 * One-way and best-effort: a browser has no host to tell, and a WebView that has
 * gone away is not an error worth surfacing to a customer mid-conversation.
 */
export function postNative(detail: Record<string, unknown>): void {
  if (!isNative()) return;
  try {
    window.ReactNativeWebView!.postMessage(JSON.stringify({ source: "dialog-native", ...detail }));
  } catch {
    /* the host is gone; nothing here depends on it */
  }
}

/**
 * The customer's backend token, handed over by a native host.
 *
 * NOT a query parameter. A token in the URL is written to the server's access
 * log, kept in the WebView's history and restored with its state -- the mobile
 * developer was right to object to it. The wrapper sets this global before the
 * page's own scripts run instead, so it exists only in memory, and it is still
 * verified server-side before anything treats the customer as signed in.
 */
export function nativeToken(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const t = (window as unknown as { __dialogNativeToken?: unknown }).__dialogNativeToken;
  return typeof t === "string" && t ? t : undefined;
}

/** Every window this widget has opened natively, so the host can close them. */
const open = new Set<{ closed: boolean }>();

/**
 * Open a URL outside the conversation.
 *
 * Returns a handle that behaves like the part of `Window` the callers use —
 * `closed` and `close()` — so a browser and a WebView are the same to them.
 * Returns null only when the browser refused to open anything, which is the
 * existing signal to fall back to a same-tab navigation.
 */
export function openExternal(
  url: string,
  opts: { name: string; width?: number; height?: number; kind?: string } = { name: "dlg-external" }
): ExternalWindow | null {
  if (isNative()) {
    const handle = { closed: false, close() { this.closed = true; } };
    open.add(handle);
    try {
      window.ReactNativeWebView!.postMessage(
        JSON.stringify({ source: "dialog-native", action: "open-url", kind: opts.kind ?? opts.name, url })
      );
    } catch {
      return null;
    }
    return handle;
  }

  const w = opts.width ?? 480;
  const h = opts.height ?? 720;
  const left = Math.max(0, Math.round(((window.screen?.width ?? w) - w) / 2));
  const top = Math.max(0, Math.round(((window.screen?.height ?? h) - h) / 2));
  const win = window.open(url, opts.name, `popup=yes,width=${w},height=${h},left=${left},top=${top}`);
  if (!win) return null;
  return {
    get closed() { return win.closed; },
    close() { try { win.close(); } catch { /* already gone */ } },
  };
}

/**
 * Listen for the native host coming back to us.
 *
 * The host dispatches a `dialog-native` event on the window — from
 * `injectJavaScript`, which is the only channel a WebView has into the page.
 * Web builds never fire it, so a browser sees nothing.
 */
export function onNativeEvent(handler: (e: NativeEvent) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (e: Event) => {
    const detail = (e as CustomEvent).detail as NativeEvent | undefined;
    if (!detail?.action) return;
    if (detail.action === "closed" || detail.action === "returned") {
      for (const h of open) h.closed = true;
      open.clear();
    }
    handler(detail);
  };
  window.addEventListener("dialog-native", listener);
  return () => window.removeEventListener("dialog-native", listener);
}
