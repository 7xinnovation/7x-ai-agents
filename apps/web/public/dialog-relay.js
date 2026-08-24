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
 *                   token is present, so this is an idle expiry, not a session cap.
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
  // `storage` catches a write from another tab or the sign-in popup; localStorage
  // fires nothing for a write in THIS tab, so it is polled too.
  window.addEventListener("storage", function (e) {
    if (!e.key || e.key === TOKEN_KEY) sync();
  });
  setInterval(sync, 2000);
})();
