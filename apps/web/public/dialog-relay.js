/*!
 * Dialog token relay
 * ------------------
 * Drop this on the page where the customer SIGNS IN, when the assistant lives on a
 * different subdomain.
 *
 *   <script src="https://agent.7x.ae/dialog-relay.js"
 *           data-domain=".emiratespost.ae"></script>
 *
 * WHY IT IS NEEDED
 *   localStorage is scoped to an ORIGIN. A script on www.emiratespost.ae cannot read
 *   a token stored by box.emiratespost.ae -- same domain, different origin, nothing
 *   shared. A cookie CAN be scoped to the whole domain, so this mirrors the token
 *   into one, and the assistant loader on the other subdomain reads it from there.
 *
 * WHAT IT DOES
 *   Reads the signed-in token from localStorage and hands it to the assistant two
 *   ways, because there are two ways a customer arrives here:
 *
 *   1. THEY JUST SIGNED IN, in the popup the assistant opened. This page is that
 *      popup, so window.opener is the assistant, and the token goes straight to it
 *      by postMessage -- addressed to the exact origin that served this script and
 *      nowhere else. Works however the two sites are named: they do not have to
 *      share a domain, which matters when sign-in lives on a Salesforce
 *      *.my.site.com address and the assistant does not.
 *
 *   2. THEY WERE ALREADY SIGNED IN before opening the chat. No popup, no opener,
 *      nothing to post to -- so the token is also mirrored into a domain-scoped
 *      cookie the assistant's subdomain can read. This is the part that needs
 *      data-domain, and the only part that needs the two sites to share a domain.
 *
 *   Either way the two are kept in step: it follows later sign-ins, and clears the
 *   cookie the moment the token goes away, so signing out does not leave a usable
 *   copy behind.
 *
 *   No UI, no network calls, nothing rendered. It only moves a value the page
 *   already holds to somewhere the assistant can see it.
 *
 * ATTRIBUTES
 *   data-domain     Cookie domain, e.g. ".emiratespost.ae" -- the registrable domain
 *                   the sign-in page and the assistant's page both sit under. Needed
 *                   for case 2 above. Omit it, or set it to a domain this page is
 *                   not under, and case 2 is skipped with a console note; the popup
 *                   handoff still works. Not derived automatically -- guessing it
 *                   would scope the cookie wider than intended.
 *   data-token-key  localStorage key holding the token. Default "accessToken".
 *   data-cookie     Cookie name. Default "dlg_host_token". Must match the
 *                   assistant's data-token-cookie if that is customised.
 *   data-max-age    Cookie lifetime in seconds. Default 1800. Refreshed while the
 *                   token is present, so this is an idle expiry, not a side cap.
 *   data-signout-clears-host
 *                   "1" to also DELETE the host's own token from localStorage when
 *                   the customer signs out of the assistant. Default OFF.
 *                   See SIGNING OUT below -- this ends the session on THIS site,
 *                   not only in the assistant, so it is the site owner's decision.
 *   data-signout-clears-keys
 *                   Comma-separated localStorage keys to remove on that sign-out.
 *                   Default: just data-token-key. Emirates Post's portal keeps
 *                   the name in "profile" as well, and a dashboard still saying
 *                   "Welcome EMRE!" reads as a failed sign-out:
 *                   data-signout-clears-keys="accessToken,profile".
 *
 * SIGNING OUT
 *   The assistant posts { source: "dialog", action: "signed-out" } to this page when
 *   the customer signs out of the chat. Until now nothing listened, so:
 *
 *     - the mirror cookie stayed, and
 *     - this page stayed signed in, because the token in localStorage is the SITE'S
 *       session and never ours to begin with.
 *
 *   The cookie is ours and is now always cleared -- leaving our own mirror of a
 *   token behind after a sign-out is our bug, not a policy question.
 *
 *   The site's token is a different matter. Deleting it signs the customer out of
 *   THIS WEBSITE, not just the assistant. That is arguably right -- one person, one
 *   identity, one sign-out -- and it is still the site owner's call to make rather
 *   than a side effect of embedding a chat widget. So it is opt-in:
 *   data-signout-clears-host="1".
 *
 * ONE THING TO BE AWARE OF
 *   The cookie is readable by JavaScript on every subdomain of data-domain -- that
 *   is the entire point, and it is also the cost: script on any of those subdomains
 *   can read the token, where before it was confined to this one origin. If that is
 *   not acceptable, the alternative is a bridge page served from this origin
 *   (docs/host-token-bridge.html), which keeps the token here and hands it only to
 *   named origins.
 */
(function () {
  "use strict";

  var el =
    document.currentScript ||
    document.querySelector('script[src*="dialog-relay"]');
  var d = (el && el.dataset) || {};

  var DOMAIN = d.domain || "";
  var TOKEN_KEY = d.tokenKey || "accessToken";
  var COOKIE = d.cookie || "dlg_host_token";
  var MAX_AGE = parseInt(d.maxAge || "1800", 10);
  // Opt-in: see SIGNING OUT above. Off unless the site says otherwise, because
  // it ends the session on THIS site and not only in the assistant.
  var SIGNOUT_CLEARS_HOST = String(d.signoutClearsHost || "") === "1";
  /**
   * WHICH keys a sign-out clears, when it is allowed to clear any.
   *
   * The token alone ends the session -- every guard on box.emiratespost.ae reads
   * `accessToken`. But the portal also keeps `profile`, and a dashboard that
   * still says "Welcome EMRE!" after a sign-out looks exactly like a sign-out
   * that did not work, whether or not the customer is still authenticated. So
   * the site can name the rest: data-signout-clears-keys="accessToken,profile".
   */
  var CLEAR_KEYS = String(d.signoutClearsKeys || "")
    .split(",")
    .map(function (k) { return k.trim(); })
    .filter(Boolean);
  if (!CLEAR_KEYS.length) CLEAR_KEYS = [TOKEN_KEY];

  if (!isFinite(MAX_AGE) || MAX_AGE <= 0) MAX_AGE = 1800;

  function note(msg) {
    // Loud, because every failure here is otherwise invisible: the tag looks
    // installed and the assistant simply never sees the customer as signed in.
    if (window.console && console.error) console.error("[dialog-relay] " + msg);
  }

  // Where the assistant lives. Taken from this script's own URL rather than
  // configured, so it cannot drift out of step with where the tag points, and so the
  // token is addressed to one exact origin instead of being broadcast.
  var ASSISTANT = d.assistantOrigin || "";
  if (!ASSISTANT) {
    try {
      ASSISTANT = new URL((el && el.src) || "", location.href).origin;
    } catch (e) {
      ASSISTANT = "";
    }
  }

  // A cookie may only be scoped to a domain the current page sits under. Set
  // data-domain to anything else and the browser drops the write without a word --
  // which is exactly what happens when a Salesforce site is served from
  // *.my.site.com in the sandbox and from a custom domain in production, and the
  // same tag is used for both. That is survivable, because the popup handoff below
  // does not care about domains at all -- but say so rather than pretending.
  var HOST = String(location.hostname || "").toLowerCase();
  var SCOPE = DOMAIN.toLowerCase().replace(/^\./, "");
  var canCookie = Boolean(SCOPE) &&
    (HOST === SCOPE || HOST.lastIndexOf("." + SCOPE) === HOST.length - SCOPE.length - 1);
  if (!canCookie) {
    note(
      DOMAIN
        ? "data-domain \"" + DOMAIN + "\" is not a domain of this page (" + HOST +
            "), so the browser would discard the cookie. Sign-in from the assistant's own popup still works; a customer who was already signed in will not be recognised."
        : "no data-domain set, so nothing is mirrored to a cookie. Sign-in from the assistant's own popup still works; a customer who was already signed in will not be recognised."
    );
  }
  if (!canCookie && !ASSISTANT) {
    note("cannot work out where the assistant is from this script's URL, and no cookie either -- not installed.");
    return;
  }

  function readToken() {
    try {
      var v = window.localStorage.getItem(TOKEN_KEY);
      return v && v.trim() ? v.trim() : null;
    } catch (e) {
      // Storage throws outright in some privacy modes. Nothing to relay, and
      // nothing on this page should break because of it.
      return null;
    }
  }

  function readCookie() {
    var parts = String(document.cookie || "").split(";");
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].trim();
      if (p.indexOf(COOKIE + "=") === 0) {
        try {
          return decodeURIComponent(p.slice(COOKIE.length + 1));
        } catch (e) {
          return p.slice(COOKIE.length + 1);
        }
      }
    }
    return null;
  }

  var secure = location.protocol === "https:" ? ";Secure" : "";

  function write(token) {
    document.cookie =
      COOKIE + "=" + encodeURIComponent(token) +
      ";Domain=" + DOMAIN +
      ";Path=/;Max-Age=" + MAX_AGE + ";SameSite=Lax" + secure;
  }

  function clear() {
    document.cookie = COOKIE + "=;Domain=" + DOMAIN + ";Path=/;Max-Age=0;SameSite=Lax" + secure;
  }

  // One diagnostic, once. A cookie can still be refused for reasons this script
  // cannot see from here -- a blocking policy, a privacy mode, a header stripping it
  // in transit. Without this the page looks correctly wired and the assistant simply
  // never sees anyone as signed in.
  var warnedCookie = false;
  function verify() {
    if (warnedCookie || readCookie()) return;
    warnedCookie = true;
    note(
      "wrote the " + COOKIE + " cookie for " + DOMAIN +
        " but cannot read it back. The browser is refusing it -- a customer who was already signed in will not be recognised."
    );
  }

  // The assistant opened this page as a popup, so it is our opener. Hand the token
  // back up the same way it sent us here. Addressed to one origin, never "*": the
  // token must not be readable by whatever else may be listening.
  //
  // The opener is severed by rel=noopener and by a Cross-Origin-Opener-Policy header
  // on this page, and reading it can throw outright. All of those mean "no popup
  // handoff available", not "broken" -- the cookie covers it when domains allow.
  var posted = null;
  function pushToOpener(token) {
    if (!ASSISTANT || token === posted) return;
    var opener;
    try {
      opener = window.opener;
    } catch (e) {
      return;
    }
    if (!opener || opener === window) return;
    try {
      opener.postMessage({ source: "dialog-host", uaePassToken: token }, ASSISTANT);
      posted = token;
    } catch (e) {
      // Closed between the check and the post, or refused. Next tick tries again.
    }
  }

  function sync() {
    var token = readToken();
    if (token) {
      pushToOpener(token);
      if (canCookie) {
        // Rewritten even when unchanged: that is what pushes the idle expiry forward
        // for a customer who is still active.
        write(token);
        verify();
      }
    } else {
      posted = null;
      // Signed out, or the token was revoked. Leaving the cookie would let the
      // assistant keep acting as a signed-in customer after they signed out.
      if (canCookie && readCookie()) clear();
    }
  }

  /**
   * AND THE CASE THAT WAS SILENT IN THE OTHER DIRECTION: no token at all.
   *
   * Installed correctly, reading the right key, and simply finding nothing —
   * which looks identical from the outside to not being installed at all. It
   * cost EPGL a round trip to work out (their component wrote into Lightning
   * Locker's sandboxed storage, so the real key stayed empty) and it has now
   * cost Emirates Post one, where the question was whether the script was on
   * the page at all.
   *
   * So the relay says so. Once, after the page has settled, naming the key it
   * looked under and what IS in storage — because "epglDialogToken is not
   * there, but these five things are" answers the question in one line, and
   * every alternative to saying it is somebody reading a script tag in the
   * elements panel and guessing.
   */
  setTimeout(function () {
    if (readToken()) return;
    var keys = [];
    try { for (var i = 0; i < window.localStorage.length; i++) keys.push(window.localStorage.key(i)); } catch (e) { keys = null; }
    note(
      "no token found in localStorage under \"" + TOKEN_KEY + "\". " +
        (keys === null
          ? "localStorage is not readable on this page."
          : keys.length
            ? "Keys present: " + keys.join(", ") + ". If the token is under one of those, set data-token-key to it."
            : "localStorage is empty here. Nothing has been written yet, or it was written on a different page or into a sandboxed storage.")
    );
  }, 5000);

  // The one case that is otherwise completely silent: a token is here, but the
  // opener was severed (rel=noopener, or a Cross-Origin-Opener-Policy header on this
  // page) AND the cookie is unavailable, so there is nowhere to put it.
  setTimeout(function () {
    if (posted || !readToken()) return;
    if (canCookie && readCookie()) return;
    note(
      "found a token but has nowhere to hand it to: this page was not opened by the assistant (or the opener link was severed by rel=noopener or a Cross-Origin-Opener-Policy header)" +
        (canCookie ? " and the cookie was refused." : " and data-domain does not cover this page.")
    );
  }, 4000);

  sync();
  /**
   * THE CUSTOMER SIGNED OUT OF THE ASSISTANT.
   *
   * It has always told us — { source: "dialog", action: "signed-out" } — and
   * nothing here listened, so our mirror cookie survived a sign-out and this
   * page went on holding a session the customer had just ended somewhere else.
   *
   * The cookie goes unconditionally: it is OUR copy of their token and keeping
   * it after a sign-out is indefensible.
   *
   * The site's own token goes only where the site has asked for it, because
   * removing it signs the customer out of this website. One identity and one
   * sign-out is a reasonable policy and it is not ours to adopt on a site
   * owner's behalf.
   *
   * Only from the assistant's own origin. A page that can post to us can
   * otherwise sign the customer out of the site it is embedded in.
   */
  function onAssistantMessage(e) {
    if (!ASSISTANT || e.origin !== ASSISTANT) return;
    var m = e.data;
    if (!m || m.source !== "dialog" || m.action !== "signed-out") return;
    if (canCookie) clear();
    posted = null;
    clearHost();
  }
  window.addEventListener("message", onAssistantMessage);

  /** Drop this site's own session, if the site has said we may. Returns whether. */
  function clearHost() {
    if (!SIGNOUT_CLEARS_HOST) {
      note(
        "the assistant signed out and our cookie is cleared, but this site's own token in \"" +
          TOKEN_KEY + "\" was left alone. Add data-signout-clears-host=\"1\" to also sign the customer out of this site."
      );
      return false;
    }
    for (var i = 0; i < CLEAR_KEYS.length; i++) {
      try {
        window.localStorage.removeItem(CLEAR_KEYS[i]);
      } catch (err) {
        // Storage throws outright in some privacy modes. Nothing to remove, and
        // nothing on this page should break because of it.
      }
    }
    return true;
  }

  /**
   * THE SIGN-OUT THAT ARRIVES AS A PAGE LOAD, NOT AS A MESSAGE.
   *
   * `postMessage` to `window.parent` reaches this script only while the
   * assistant is EMBEDDED in this site -- then the parent is us. Opened on its
   * own at agent.7x.ae, the widget's parent is itself, and a sign-out there
   * reaches nothing: this site is not in the frame tree and no origin can
   * script another one's storage.
   *
   * That is not a corner case. On production the portal is the only way in --
   * the UAE PASS client is registered to box.emiratespost.ae, not to us -- so
   * the customer signs out of the assistant, clicks Sign in, the portal still
   * holds the session, and they are back in as themselves without being asked.
   *
   * So the assistant opens a window on this site carrying `dlg-signout`, this
   * script runs as part of the page like it does everywhere else, and the
   * session ends on the origin that owns it. It is the same shape as the UAE
   * PASS sign-out: a window, a moment, gone. Nothing is rendered and nothing is
   * navigated -- the window is closed from the side that opened it.
   *
   * Under the SAME opt-in as everything above. A URL is not permission.
   */
  var MARKER = /(^|[?&#])dlg-signout(=|&|$)/;

  /**
   * THE URL THIS DOCUMENT WAS OPENED WITH, not the one it has now.
   *
   * box.emiratespost.ae routes a signed-in visitor off the root the moment it
   * mounts — `d.push("/dashboard")` — which drops the query string. This script
   * is appended by their _app and loads asynchronously, so by the time it runs
   * the marker it was sent to find is already gone, and a sign-out did nothing
   * while the window sat on a dashboard saying "Welcome EMRE!".
   *
   * A client-side route change rewrites `location` and does NOT touch the
   * navigation timing entry, whose `name` is the URL the document was actually
   * fetched with. So that is read first, and the live location second — a
   * browser without the entry, or a page that kept its query, still works.
   */
  function openedWith() {
    try {
      var nav = performance.getEntriesByType && performance.getEntriesByType("navigation")[0];
      if (nav && nav.name) return String(nav.name);
    } catch (err) {
      /* no navigation timing here; the location below is the fallback */
    }
    return "";
  }

  function signoutRequested() {
    try {
      var opened = openedWith();
      // Only the query and hash of the opening URL: a path or host that merely
      // contains the word must never sign anybody out.
      var q = opened.indexOf("?");
      var h = opened.indexOf("#");
      var i = q === -1 ? h : h === -1 ? q : Math.min(q, h);
      var fromOpened = i === -1 ? "" : opened.slice(i);
      return MARKER.test(fromOpened) || MARKER.test(String(location.search) + String(location.hash));
    } catch (err) {
      return false;
    }
  }

  if (signoutRequested()) {
    if (canCookie) clear();
    posted = null;
    var cleared = clearHost();
    // Tell the opener it landed, so a sign-out that silently did nothing --
    // the attribute missing, this script not on this page -- can be told apart
    // from one that worked. Only ever to the assistant's own origin.
    try {
      if (window.opener && ASSISTANT) {
        window.opener.postMessage(
          { source: "dialog-relay", action: "host-signed-out", cleared: cleared },
          ASSISTANT
        );
      }
    } catch (err) {
      /* opener gone, or severed by COOP; the clearing already happened */
    }
  }

  // `storage` catches a write from another tab or the sign-in popup; localStorage
  // fires nothing for a write in THIS tab, so it is polled too.
  window.addEventListener("storage", function (e) {
    if (!e.key || e.key === TOKEN_KEY) sync();
  });
  setInterval(sync, 2000);
})();
