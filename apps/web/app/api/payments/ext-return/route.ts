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
  en: { head: "Payment window", body: "Returning you to the chat…" },
  ar: { head: "نافذة الدفع", body: "جارٍ إعادتك إلى المحادثة…" },
} as const;

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
</style></head><body><div class="card"><h1>${t.head}</h1><p>${t.body}</p></div>
<script>
(function () {
  var ref = ${JSON.stringify(reference)};
  try {
    // Same origin as the embed that opened us, so this is addressed exactly.
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ source: "dialog-extpay", action: "returned", reference: ref }, window.location.origin);
    }
  } catch (e) { /* an opener we cannot reach just means the customer closes this themselves */ }
  setTimeout(function () { try { window.close(); } catch (e) {} }, 900);
})();
</script></body></html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
