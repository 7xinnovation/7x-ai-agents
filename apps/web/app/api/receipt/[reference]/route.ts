import { NextRequest, NextResponse } from "next/server";
import { getDb, payments, cases, agents, conversations } from "@dialog/db";
import { and, eq } from "drizzle-orm";
import type { CaseState } from "@dialog/config";

export const runtime = "nodejs";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

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
    totalPaid: "Total paid", totalDue: "Total due", print: "Print / Save as PDF",
    foot: "This receipt was generated for the payment referenced above. Keep it for your records.",
    statuses: { paid: "Paid", failed: "Failed", initiated: "Initiated" } as Record<string, string>,
  },
  ar: {
    subtitle: "إيصال الدفع", receiptNo: "رقم الإيصال", date: "التاريخ", service: "الخدمة",
    poBox: "صندوق البريد", caseRef: "الرقم المرجعي للطلب", status: "الحالة",
    totalPaid: "الإجمالي المدفوع", totalDue: "الإجمالي المستحق", print: "طباعة / حفظ كملف PDF",
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

  const brand = (agent?.definition as { theme?: { brandName?: string } } | null)?.theme?.brandName || agent?.name || s.subtitle;
  const primary =
    (agent?.definition as { theme?: { colors?: { primary?: string } } } | null)?.theme?.colors?.primary || "#2626a1";
  const journeyKey = state?.journeyKey ?? "";
  const journey = SERVICE_NAMES[journeyKey]?.[locale] ?? (journeyKey ? journeyKey.replace(/_/g, " ") : s.service);
  const paidAt = fmtDate(pay.updatedAt ?? pay.createdAt);
  const box = [data.box_number, data.po_box_number].map((v) => (v ? String(v) : "")).find(Boolean) ?? "";
  const emirate = data.emirate ? String(data.emirate) : "";
  const status = s.statuses[pay.status] ?? pay.status;

  const rows: [string, string][] = [
    [s.receiptNo, pay.reference],
    [s.date, paidAt],
    [s.service, journey],
    ...(box ? ([[s.poBox, box + (emirate ? `, ${emirate}` : "")]] as [string, string][]) : []),
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
  .head p{margin:4px 0 0;font-size:12px;opacity:.85}
  .body{padding:20px 24px}
  .row{display:flex;justify-content:space-between;gap:16px;padding:9px 0;border-bottom:1px solid #f0f1f7;font-size:13.5px}
  .row:last-child{border-bottom:none}
  .row .k{color:#5B6478}
  .row .v{font-weight:600;text-align:${rtl ? "left" : "right"}}
  .total{display:flex;justify-content:space-between;margin-top:14px;padding:14px 16px;background:#f4f5fb;border-radius:10px;font-size:15px;font-weight:700}
  .foot{padding:14px 24px 20px;font-size:11.5px;color:#5B6478}
  .print{display:block;width:100%;margin:16px 0 0;padding:11px;border:0;border-radius:10px;background:${esc(primary)};color:#fff;font-size:14px;font-weight:600;cursor:pointer}
  @media print{.print{display:none}body{background:#fff;padding:0}.card{border:none}}
</style></head><body>
<div class="card">
  <div class="head"><h1>${esc(brand)}</h1><p>${esc(s.subtitle)}</p></div>
  <div class="body">
    ${rows.map(([k, v]) => `<div class="row"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`).join("")}
    <div class="total"><span>${esc(pay.status === "paid" ? s.totalPaid : s.totalDue)}</span><span>${esc(`${pay.amount} ${pay.currency}`)}</span></div>
    <button class="print" onclick="window.print()">${esc(s.print)}</button>
  </div>
  <div class="foot">${esc(s.foot)}</div>
</div>
</body></html>`;

  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
