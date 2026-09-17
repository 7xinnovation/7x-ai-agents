import { NextRequest } from "next/server";

export const runtime = "nodejs";

/**
 * Where a BACKEND-OWNED gateway sends the customer back after they pay.
 *
 * The internal checkout returns to /api/payments/return, which looks the outcome
 * up in our payments table. A rental is paid on Emirates Post's own N-Genius
 * outlet, so there is no row of ours to check and no authority here to claim one:
 * only their UpdatePayment call can say whether the money arrived.
 *
 * Sending them back to the host site instead — which is what happened before this
 * existed — left the popup sitting on the Emirates Post homepage, the customer
 * unsure whether it had worked, and the chat none the wiser.
 *
 * So this page claims nothing. It tells the window that opened it that the
 * customer came back, and closes. The chat then asks the backend.
 *
 * Their gateway appends its reference as a BARE query key ("?af25a1c2-0151-…"),
 * not as key=value, so the first valueless parameter is read as the reference.
 */
const STR = {
  en: {
    head: "Payment window",
    body: "Returning you to the chat…",
    stuck: "You can close this window — your chat is waiting behind it.",
    close: "Back to the chat",
    // When nothing on this page is able to close it, the customer needs the
    // control that IS able to: the one their browser drew, not one of ours.
    tapX: "Tap \u2715 at the top of this window to go back to your chat. Your payment is already recorded.",
  },
  ar: {
    head: "نافذة الدفع",
    body: "جارٍ إعادتك إلى المحادثة…",
    stuck: "يمكنك إغلاق هذه النافذة — محادثتك في انتظارك خلفها.",
    close: "العودة إلى المحادثة",
    tapX: "اضغط \u2715 في أعلى هذه النافذة للعودة إلى محادثتك. تم تسجيل دفعتك بالفعل.",
  },
} as const;

/**
 * A deep link back into a native app, when there is one.
 *
 * Reported from the mobile app, 11 September: "after completing payment, the app
 * does not automatically redirect back to the chat window; it stays on the
 * 'Payment window — Returning you to the chat…' screen." It does, and the
 * screenshot says why — the page is in an iOS in-app browser
 * (SFSafariViewController), which is not the WebView the chat is in and not a
 * window anything opened. There is no `opener` to tell and `close()` does
 * nothing: a page cannot dismiss a browser the OS put in front of the app.
 *
 * What DOES dismiss it is navigating to a URL the app itself claims. So if the
 * app's scheme is configured we go there, and iOS hands control back. Unset in
 * every environment until Emirates Post give us theirs, which is why the page
 * below no longer promises a return it may not be able to make.
 */
const APP_LINK = process.env.NATIVE_RETURN_URL ?? "";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const named = q.get("ref") ?? q.get("reference") ?? q.get("orderReference") ?? "";
  // A bare "?<uuid>" arrives as a key with an empty value.
  const bare = !named ? [...q.entries()].find(([, v]) => v === "")?.[0] ?? "" : "";
  const reference = (named || bare).slice(0, 120);
  const locale: "en" | "ar" = q.get("lang") === "ar" ? "ar" : "en";
  const t = STR[locale];
  const dir = locale === "ar" ? "rtl" : "ltr";

  const html = `<!doctype html><html lang="${locale}" dir="${dir}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${t.head}</title><style>
body{margin:0;min-height:100dvh;display:flex;align-items:center;justify-content:center;
font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#f6f8fc;color:#0f172a}
.card{background:#fff;border:1px solid #e1e8f0;border-radius:14px;padding:32px 36px;text-align:center;max-width:380px}
h1{font-size:17px;margin:0 0 8px}p{margin:0;font-size:14px;color:#5B6478;line-height:1.6}
/* 16px: anything smaller is magnified by iOS the moment it is tapped. */
a.done{display:none;margin-top:18px;padding:11px 20px;border-radius:10px;background:#0f172a;color:#fff;
text-decoration:none;font-size:16px;font-weight:600}
</style></head><body><div class="card"><h1>${t.head}</h1><p id="msg">${t.body}</p>
<a class="done" id="done" href="#">${t.close}</a></div>
<script>
(function () {
  var ref = ${JSON.stringify(reference)};
  var appLink = ${JSON.stringify(APP_LINK)};

  function tellTheChat() {
    try {
      // Same origin as the embed that opened us, so this is addressed exactly.
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage({ source: "dialog-extpay", action: "returned", reference: ref }, window.location.origin);
      }
    } catch (e) { /* an opener we cannot reach just means the customer closes this themselves */ }
    try {
      // A native host that put us in a WebView of its own rather than the
      // system browser. It gets the same news through its own channel.
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ source: "dialog-native", action: "returned", url: ref }));
      }
    } catch (e) { /* the host is gone; the button below still works */ }
  }

  function goBack() {
    tellTheChat();
    if (appLink) { try { window.location.href = appLink; } catch (e) {} }
    try { window.close(); } catch (e) {}
  }

  tellTheChat();
  if (appLink) { try { window.location.href = appLink; } catch (e) {} }
  setTimeout(function () { try { window.close(); } catch (e) {} }, 900);

  /**
   * STILL HERE, WHICH MEANS NOTHING ABOVE CAN CLOSE THIS.
   *
   * A window a script may close is closed by the line above within a second. So
   * reaching this timer is not a guess — it is proof that this page cannot
   * dismiss itself, which is the case inside an iOS in-app browser: the OS put
   * it there and no page can take it away.
   *
   * The first version of this offered a "Back to the chat" button anyway, and
   * on 17 September it was reported doing exactly nothing: "when I click on back
   * to chat nothing happens, only when I click on the X on the top left." Of
   * course it did — it called the same close() that had already failed. A button
   * that cannot work is worse than no button, because the customer trusts it and
   * waits.
   *
   * So the button only appears when there is a real route out: an app deep link
   * we were configured with. Otherwise the page stops offering and starts
   * telling them about the control their own browser drew.
   */
  setTimeout(function () {
    var msg = document.getElementById("msg");
    var done = document.getElementById("done");
    if (!msg || !done) return;
    if (appLink) {
      msg.textContent = ${JSON.stringify(t.stuck)};
      done.style.display = "inline-block";
      done.addEventListener("click", function (e) { e.preventDefault(); goBack(); });
      return;
    }
    msg.textContent = ${JSON.stringify(t.tapX)};
  }, 2000);
})();
</script></body></html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
