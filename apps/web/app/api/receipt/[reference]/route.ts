import { NextRequest, NextResponse } from "next/server";
import { getDb, payments, cases, agents, conversations } from "@dialog/db";
import { and, eq } from "drizzle-orm";
import type { CaseState } from "@dialog/config";
import { receiptFacts } from "@/lib/receiptFacts";

export const runtime = "nodejs";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Money the way every other screen writes it: "AED 2,155.00", not "2155 AED". */
const money = (amount: number, currency: string) =>
  `${currency} ${amount.toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Customer-facing date format, DD-MM-YYYY (FB-1439). */
const fmtDate = (d: Date | null | undefined): string => {
  if (!d) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}-${p(d.getUTCMonth() + 1)}-${d.getUTCFullYear()}`;
};

/**
 * Receipt copy in both languages (FB-1445: the receipt was English-only, so an
 * Arabic session ended on an English document). The conversation's own locale
 * decides which is rendered, including page direction.
 */
const RECEIPT_STR = {
  en: {
    subtitle: "Payment receipt", receiptNo: "Receipt no.", date: "Date", service: "Service",
    poBox: "PO Box", caseRef: "Case reference", status: "Status",
    customer: "Subscriber", bundle: "Bundle", expiry: "Valid until", branch: "Branch", orderNo: "Order no.",
    totalPaid: "Total paid", totalDue: "Total due", print: "Print / Save as PDF",
    printHint: "To save this, use the share button in your browser and choose Print or Save as PDF. A screenshot works too.",
    foot: "This receipt was generated for the payment referenced above. Keep it for your records.",
    statuses: { paid: "Paid", failed: "Failed", initiated: "Initiated" } as Record<string, string>,
  },
  ar: {
    subtitle: "إيصال الدفع", receiptNo: "رقم الإيصال", date: "التاريخ", service: "الخدمة",
    poBox: "صندوق البريد", caseRef: "الرقم المرجعي للطلب", status: "الحالة",
    customer: "المشترك", bundle: "الباقة", expiry: "صالح حتى", branch: "الفرع", orderNo: "رقم الطلب",
    totalPaid: "الإجمالي المدفوع", totalDue: "الإجمالي المستحق", print: "طباعة / حفظ كملف PDF",
    printHint: "لحفظ هذا الإيصال، استخدم زر المشاركة في المتصفح واختر الطباعة أو الحفظ كملف PDF. ولقطة الشاشة تفي بالغرض أيضًا.",
    foot: "تم إنشاء هذا الإيصال للدفعة المذكورة أعلاه. يُرجى الاحتفاظ به في سجلاتك.",
    statuses: { paid: "مدفوع", failed: "فشل", initiated: "قيد التنفيذ" } as Record<string, string>,
  },
} as const;

/** Journey keys rendered as a readable service name in each language. */
const SERVICE_NAMES: Record<string, { en: string; ar: string }> = {
  personal_po_box_rental: { en: "New personal PO Box", ar: "صندوق بريد شخصي جديد" },
  personal_po_box_renewal: { en: "Personal PO Box renewal", ar: "تجديد صندوق بريد شخصي" },
  corporate_po_box_rental: { en: "New corporate PO Box", ar: "صندوق بريد للشركات" },
  corporate_po_box_renewal: { en: "Corporate PO Box renewal", ar: "تجديد صندوق بريد للشركات" },
  manage_po_box: { en: "PO Box management", ar: "إدارة صندوق البريد" },
  new_license: { en: "New postal activity license", ar: "رخصة نشاط بريدي جديدة" },
  renewal: { en: "Postal activity license renewal", ar: "تجديد رخصة النشاط البريدي" },
};

/**
 * Printable payment receipt (Round-2 feedback FB-1396: at the end of the
 * transaction the customer can download the receipt or receive it by email).
 * Keyed by the payment reference AND the conversation id (`c` query param) so a
 * reference alone cannot be enumerated by a third party. Renders self-contained
 * HTML the customer can print / save as PDF from the browser, in the language the
 * conversation was held in (FB-1445).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ reference: string }> }) {
  const { reference } = await params;
  const conversationId = req.nextUrl.searchParams.get("c") ?? "";
  // conversation_id is a uuid column — a malformed value would throw at the DB
  // layer (500); reject it up front instead.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!reference || !UUID_RE.test(conversationId)) return NextResponse.json({ error: "receipt_not_found" }, { status: 404 });

  const db = getDb();
  const pay = await db.query.payments.findFirst({
    where: and(eq(payments.reference, reference), eq(payments.conversationId, conversationId)),
  });
  if (!pay) return NextResponse.json({ error: "receipt_not_found" }, { status: 404 });

  const agent = pay.agentId ? await db.query.agents.findFirst({ where: eq(agents.id, pay.agentId) }) : null;
  const caseRow = pay.caseId ? await db.query.cases.findFirst({ where: eq(cases.id, pay.caseId) }) : null;
  const conv = await db.query.conversations.findFirst({ where: eq(conversations.id, conversationId) });
  const state = (caseRow?.state ?? null) as CaseState | null;
  const data = (state?.data ?? {}) as Record<string, unknown>;

  // The receipt is rendered in the language the conversation was held in (FB-1445).
  const locale: "en" | "ar" = conv?.locale === "ar" ? "ar" : "en";
  const s = RECEIPT_STR[locale];
  const rtl = locale === "ar";

  const theme = (agent?.definition as { theme?: { brandName?: string; logoUrl?: string } } | null)?.theme;
  const brand = theme?.brandName || agent?.name || s.subtitle;
  // The LOGO where the name was. The receipt said "NXN" — an internal product
  // name — to a customer who had just bought from Emirates Post.
  const logoUrl = theme?.logoUrl ?? "";
  const primary =
    (agent?.definition as { theme?: { colors?: { primary?: string } } } | null)?.theme?.colors?.primary || "#2626a1";
  // What Emirates Post's own responses said happened, read back from the audit
  // log. A renewal begun from "manage my PO Box" stays under the manage journey,
  // so the journey key alone called it "PO Box management" on the receipt for a
  // renewal — and the case, which keeps only a box number and a period, could
  // name neither the subscriber, the bundle, nor the date the box now runs to.
  const facts = await receiptFacts(conversationId, pay.agentId ?? null);

  const journeyKey = state?.journeyKey ?? "";
  // The operation performed wins over the journey it was started from. Only a
  // renewal and a rental are distinguishable this way; anything else keeps the
  // journey's own name.
  const corporate = /corporate/i.test(journeyKey);
  const performed =
    facts.operation === "renewal"
      ? corporate ? "corporate_po_box_renewal" : "personal_po_box_renewal"
      : facts.operation === "rental"
        ? corporate ? "corporate_po_box_rental" : "personal_po_box_rental"
        : journeyKey;
  const journey = SERVICE_NAMES[performed]?.[locale] ?? (performed ? performed.replace(/_/g, " ") : s.service);
  const paidAt = fmtDate(pay.updatedAt ?? pay.createdAt);
  const box = facts.poBox ?? [data.box_number, data.po_box_number].map((v) => (v ? String(v) : "")).find(Boolean) ?? "";
  const emirate = facts.emirate ?? (data.emirate ? String(data.emirate) : "");
  const status = s.statuses[pay.status] ?? pay.status;
  // The name Emirates Post has on the subscription, not one we assembled.
  const customer = facts.customerName ?? "";
  const expiry = facts.expiry ? fmtDate(new Date(`${facts.expiry}T00:00:00Z`)) : "";
  const row = (k: string, v: string): [string, string][] => (v ? [[k, v]] : []);
  // What Emirates Post says was paid, ahead of our own row. The row was an
  // integer column written from a figure the confirming turn no longer had, so
  // every renewal confirmed before 7 September recorded 0.00 for a payment that
  // certainly happened. Their confirmation carries the real number.
  const charged = facts.amountPaid ?? pay.amount;

  const rows: [string, string][] = [
    [s.receiptNo, pay.reference],
    [s.date, paidAt],
    [s.service, journey],
    ...row(s.customer, customer),
    ...(box ? ([[s.poBox, box + (emirate ? `, ${emirate}` : "")]] as [string, string][]) : []),
    ...row(s.bundle, facts.bundle ?? ""),
    ...row(s.expiry, expiry),
    ...row(s.branch, facts.branch ?? ""),
    ...row(s.orderNo, facts.orderNo ?? ""),
    ...(state?.reference ? ([[s.caseRef, state.reference]] as [string, string][]) : []),
    [s.status, status],
  ];

  const html = `<!doctype html>
<html lang="${locale}" dir="${rtl ? "rtl" : "ltr"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(brand)} — ${esc(s.subtitle)} ${esc(pay.reference)}</title>
<style>
  body{font-family:-apple-system,'Segoe UI',system-ui,sans-serif;background:#f4f5fb;margin:0;padding:24px;color:#13132e}
  .card{max-width:520px;margin:0 auto;background:#fff;border:1px solid #e4e5f1;border-radius:14px;overflow:hidden}
  .head{background:${esc(primary)};color:#fff;padding:20px 24px}
  .head h1{margin:0;font-size:18px;font-weight:700}
  /* White-on-brand: the supplied mark is dark, so it is knocked out to sit on
     the header the way it does in the chat. */
  .head .logo{display:block;height:30px;width:auto;max-width:220px;filter:brightness(0) invert(1)}
  .head p{margin:4px 0 0;font-size:12px;opacity:.85}
  .body{padding:20px 24px}
  .row{display:flex;justify-content:space-between;gap:16px;padding:9px 0;border-bottom:1px solid #f0f1f7;font-size:13.5px}
  .row:last-child{border-bottom:none}
  .row .k{color:#5B6478}
  .row .v{font-weight:600;text-align:${rtl ? "left" : "right"}}
  .total{display:flex;justify-content:space-between;margin-top:14px;padding:14px 16px;background:#f4f5fb;border-radius:10px;font-size:15px;font-weight:700}
  .foot{padding:14px 24px 20px;font-size:11.5px;color:#5B6478}
  .print{display:block;width:100%;margin:16px 0 0;padding:11px;border:0;border-radius:10px;background:${esc(primary)};color:#fff;font-size:16px;font-weight:600;cursor:pointer}
  /* PRINTED, the header keeps its logo.
     A browser does not print background colours unless the person ticks
     "Background graphics", so the blue band goes white — and the logo, which is
     knocked out to WHITE to sit on that band, disappears with it. The customer
     got a receipt with a blank rectangle where the sender should be.
     So print does not depend on the background at all: white band, the logo in
     its own colours, and a brand rule under it to keep the header a header. */
  @media print{
    .print{display:none}
    body{background:#fff;padding:0}
    .card{border:none;max-width:none}
    .head{background:#fff;color:#13132e;border-bottom:2px solid ${esc(primary)};padding-bottom:14px}
    /* Not filter:none — the mark's own colours are a pale blue meant to sit on
       the brand band, and on white paper they print as a ghost. brightness(0)
       makes every opaque pixel of it black, which is what a printed receipt
       wants and what a photocopier would have done anyway. */
    .head .logo{filter:brightness(0)}
    .head h1{color:${esc(primary)}}
    .head p{opacity:1;color:#5B6478}
  }
  /* And where backgrounds ARE printed, keep the colours we chose rather than
     the browser's approximation of them. */
  @media print{.total{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  /* Shown only when the print sheet did not open — see the script at the end. */
  .printhint{display:none;margin:12px 2px 0;font-size:12.5px;line-height:1.6;color:#5B6478}
  @media print{.printhint{display:none}}
</style></head><body>
<div class="card">
  <div class="head">${
    logoUrl
      ? `<img class="logo" src="${esc(logoUrl)}" alt="${esc(brand)}">`
      : `<h1>${esc(brand)}</h1>`
  }<p>${esc(s.subtitle)}</p></div>
  <div class="body">
    ${rows.map(([k, v]) => `<div class="row"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`).join("")}
    <div class="total"><span>${esc(pay.status === "paid" ? s.totalPaid : s.totalDue)}</span><span>${esc(money(charged, pay.currency))}</span></div>
    <button class="print" id="print">${esc(s.print)}</button>
    <p class="printhint" id="printhint">${esc(s.printHint)}</p>
  </div>
  <div class="foot">${esc(s.foot)}</div>
</div>
<script>
/**
 * "PRINT / SAVE AS PDF" IS NOT FUNCTIONAL ON THE PAYMENT RECEIPT SCREEN.
 *
 * Reported from the mobile app, 11 September, and true: the button called
 * window.print(), and inside an iOS in-app browser — which is where the receipt
 * link opens — that call is either absent or silently ignored. Nothing happened
 * and nothing said why, on the one screen a customer actually wants to keep.
 *
 * There is no way for this page to open the OS print sheet itself. What it can
 * do is ask, find out whether the ask worked, and if it did not, stop pretending
 * and tell the customer where the control they need actually is. A native host
 * gets told as well, so an app that wants to raise its own share sheet can.
 */
(function () {
  var btn = document.getElementById("print");
  var hint = document.getElementById("printhint");
  if (!btn || !hint) return;
  var printed = false;
  window.addEventListener("beforeprint", function () { printed = true; });
  // Safari fires no beforeprint; its print sheet is a media-query change.
  try {
    var mq = window.matchMedia("print");
    if (mq && mq.addEventListener) mq.addEventListener("change", function (e) { if (e.matches) printed = true; });
  } catch (e) { /* older engine; the timeout below still decides */ }
  btn.addEventListener("click", function () {
    try {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ source: "dialog-native", action: "print", url: window.location.href }));
      }
    } catch (e) { /* not in a native host */ }
    try {
      if (typeof window.print === "function") window.print();
    } catch (e) { /* refused; the hint below is the answer */ }
    setTimeout(function () { if (!printed) hint.style.display = "block"; }, 900);
  });
})();
</script>
</body></html>`;

  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
