"use client";

/**
 * A Cloudflare Turnstile token, minted in the customer's own browser.
 *
 * Emirates Post's case endpoint (/nextApi/case) answers 403 "Invalid CAPTCHA
 * token" to anything without one, and Cloudflare issues the token to a browser,
 * not to a server. Emirates Post supplied the site key on 21 October; this is
 * the half that lives on our side of it.
 *
 * Three properties of the token shape everything below:
 *   - it is SINGLE-USE — verifying it once burns it, so every attempt needs a
 *     new one and the widget is reset after each hand-out;
 *   - it EXPIRES in about five minutes, which is shorter than plenty of real
 *     conversations, so a stale one is thrown away rather than sent;
 *   - it is bound to the HOSTNAME that rendered the widget, which is ours
 *     (agent.7x.ae), not the page embedding us — our domains have to be on the
 *     site key's allowed list or `error-callback` fires with 110200.
 *
 * `appearance: "interaction-only"` keeps it invisible for the ordinary visitor
 * who passes silently, and shows a checkbox only when Cloudflare wants one. That
 * is why the container is rendered in the normal flow of the composer instead of
 * being hidden: a challenge nobody can see is a challenge nobody can pass.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
/** Cloudflare expires a token at 300s; leave room for the turn that carries it. */
const STALE_AFTER_MS = 240_000;
/** How long a send will wait for a first token before going without one. */
const WAIT_MS = 8_000;

interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  reset(id?: string): void;
  remove(id?: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptLoading: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (scriptLoading) return scriptLoading;
  scriptLoading = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT}"]`);
    const el = existing ?? document.createElement("script");
    el.src = SCRIPT;
    el.async = true;
    el.defer = true;
    el.addEventListener("load", () => resolve());
    el.addEventListener("error", () => reject(new Error("turnstile script blocked")));
    if (!existing) document.head.appendChild(el);
  });
  return scriptLoading;
}

export interface Turnstile {
  /** Ref callback for the container the widget renders into. */
  mount: (el: HTMLDivElement | null) => void;
  /**
   * The current token, or undefined when there is none to be had.
   *
   * Deliberately NOT consuming. A token is burnt by Cloudflare's verify, which
   * happens at Emirates Post's end and only when a case is actually filed, so
   * the same one rides along with every message until it is either spent (see
   * `spent`) or too old to be worth sending.
   *
   * Never throws and never blocks a send for long: a callback that cannot be
   * filed on their endpoint still has the ops-mailbox path behind it, and a
   * customer waiting on a CAPTCHA they cannot see would be the worse failure.
   */
  get: () => Promise<string | undefined>;
  /**
   * The server filed a case with it — mint the next one.
   *
   * Called on the `escalation` event rather than after every send, so two quick
   * messages in a row do not leave the second waiting on a fresh challenge.
   */
  spent: () => void;
}

export function useTurnstile(siteKey?: string): Turnstile {
  const widgetId = useRef<string | null>(null);
  const token = useRef<{ value: string; at: number } | null>(null);
  const waiters = useRef<((t: string | undefined) => void)[]>([]);
  const container = useRef<HTMLDivElement | null>(null);
  const mounted = useRef(false);

  const settle = (value: string | undefined) => {
    const queue = waiters.current;
    waiters.current = [];
    for (const w of queue) w(value);
  };

  const render = useCallback(async () => {
    if (!siteKey || mounted.current || !container.current) return;
    mounted.current = true;
    try {
      await loadScript();
    } catch {
      // A blocked script is a normal condition on a locked-down network: the
      // callback falls back to the mailbox rather than the customer seeing a
      // broken widget.
      settle(undefined);
      return;
    }
    const api = window.turnstile;
    if (!api || !container.current) return;
    try {
      widgetId.current = api.render(container.current, {
        sitekey: siteKey,
        appearance: "interaction-only",
        retry: "auto",
        "refresh-expired": "auto",
        callback: (t: string) => {
          token.current = { value: t, at: Date.now() };
          settle(t);
        },
        "expired-callback": () => {
          token.current = null;
        },
        "error-callback": (code: string) => {
          // 110200 is "this hostname is not on the site key's list" — the one
          // error Emirates Post has to fix rather than us.
          if (typeof console !== "undefined") console.warn("turnstile error", code);
          token.current = null;
          settle(undefined);
          return true; // keep the widget alive; `retry: auto` tries again
        },
      });
    } catch {
      settle(undefined);
    }
  }, [siteKey]);

  const mount = useCallback(
    (el: HTMLDivElement | null) => {
      container.current = el;
      if (el) void render();
    },
    [render]
  );

  useEffect(() => {
    return () => {
      // Leaving the widget behind on unmount leaks an iframe and a timer.
      if (widgetId.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetId.current);
        } catch {
          /* already gone */
        }
      }
      widgetId.current = null;
      mounted.current = false;
    };
  }, []);

  const get = useCallback(async (): Promise<string | undefined> => {
    if (!siteKey) return undefined;
    const fresh = token.current && Date.now() - token.current.at < STALE_AFTER_MS ? token.current.value : undefined;
    if (fresh) return fresh;
    // Nothing usable in hand: either the first token has not arrived yet or the
    // last one went stale. Ask for a new one and wait briefly.
    token.current = null;
    void render();
    try {
      window.turnstile?.reset(widgetId.current ?? undefined);
    } catch {
      /* not rendered yet — the render above will fire the callback */
    }
    return new Promise<string | undefined>((resolve) => {
      let done = false;
      const finish = (t: string | undefined) => {
        if (done) return;
        done = true;
        resolve(t);
      };
      waiters.current.push(finish);
      setTimeout(() => finish(undefined), WAIT_MS);
    });
  }, [siteKey, render]);

  const spent = useCallback(() => {
    token.current = null;
    try {
      window.turnstile?.reset(widgetId.current ?? undefined);
    } catch {
      /* `refresh-expired: auto` will see to it */
    }
  }, []);

  // Stable identity: `send` is memoised on it, and a fresh object every render
  // would rebuild the callback — and everything memoised on that — each time.
  return useMemo(() => ({ mount, get, spent }), [mount, get, spent]);
}
