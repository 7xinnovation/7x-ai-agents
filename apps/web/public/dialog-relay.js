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
 *   Reads the signed-in token from localStorage and copies it into a
 *   domain-scoped cookie, keeping the two in step: it follows later sign-ins, and
 *   clears the cookie the moment the token goes away, so signing out does not leave
 *   a usable copy behind.
 *
 *   No UI, no network calls, nothing rendered. It only moves a value the page
 *   already holds into a place a sibling subdomain can see.
 *
 * ATTRIBUTES
 *   data-domain     REQUIRED. Cookie domain, e.g. ".emiratespost.ae". Must be the
 *                   registrable domain both subdomains sit under. Not derived
 *                   automatically -- guessing it wrong would either fail silently or
 *                   scope the cookie wider than intended.
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

  if (!DOMAIN) {
    // Loud, because the failure is otherwise invisible: everything looks installed
    // and the assistant simply never sees a customer as signed in.
    if (window.console && console.error) {
      console.error("[dialog-relay] data-domain is required, e.g. data-domain=\".example.ae\" — not installed.");
    }
    return;
  }
  if (!isFinite(MAX_AGE) || MAX_AGE <= 0) MAX_AGE = 1800;

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

  function sync() {
    var token = readToken();
    if (token) {
      // Rewritten even when unchanged: that is what pushes the idle expiry forward
      // for a customer who is still active.
      write(token);
    } else if (readCookie()) {
      // Signed out, or the token was revoked. Leaving the cookie would let the
      // assistant keep acting as a signed-in customer after they signed out.
      clear();
    }
  }

  sync();
  // `storage` catches a write from another tab or the sign-in popup; localStorage
  // fires nothing for a write in THIS tab, so it is polled too.
  window.addEventListener("storage", function (e) {
    if (!e.key || e.key === TOKEN_KEY) sync();
  });
  setInterval(sync, 2000);
})();
