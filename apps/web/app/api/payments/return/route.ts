import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, payments } from "@dialog/db";
import { resolveAdapters, adapterContext, setPayment } from "@dialog/core";
import { getAgentById } from "@/lib/agents";
import { ensureAdapters } from "@/lib/registry";
import { getCase, saveCase, audit } from "@/lib/conversation";
import { log } from "@/lib/logger";

export const runtime = "nodejs";

/**
 * Where a REAL gateway sends the customer back after they pay.
 *
 * N-Genius takes this per order (merchantAttributes.redirectUrl) — nothing is
 * pre-registered with them, so the URL is ours to choose. Without this route the
 * customer would land on a 404 after paying, which reads as a failed payment
 * even though it succeeded.
 *
 * The gateway is asked for the authoritative outcome here rather than trusting
 * the query string: a redirect is customer-controlled and must never be what
 * marks money as received. The chat is already polling /api/payments/status, so
 * this page's only job is to confirm and hand control back.
 */
const RET_STR = {
  en: {
    paid: "Payment successful",
    pending: "Payment is still processing",
    failed: "Payment was not completed",
    backPaid: "Returning you to the chat…",
    backOther: "You can close this window and return to the chat.",
  },
  ar: {
    paid: "تم الدفع بنجاح",
    pending: "لا تزال عملية الدفع قيد المعالجة",
    failed: "لم تكتمل عملية الدفع",
    backPaid: "جارٍ إعادتك إلى المحادثة…",
    backOther: "يمكنك إغلاق هذه النافذة والعودة إلى المحادثة.",
  },
} as const;

export async function GET(req: NextRequest) {
  // N-Genius appends its own order reference; accept the common spellings.
  const q = req.nextUrl.searchParams;
  const reference = q.get("ref") ?? q.get("reference") ?? q.get("orderReference") ?? "";
  const locale: "en" | "ar" = q.get("lang") === "ar" ? "ar" : "en";
  const t = RET_STR[locale];

  let status: "initiated" | "paid" | "failed" = "initiated";
  if (reference) {
    const db = getDb();
    const [pay] = await db
      .select({ status: payments.status, agentId: payments.agentId, conversationId: payments.conversationId })
      .from(payments)
      .where(eq(payments.reference, reference))
      .limit(1);
    if (pay) {
      status = pay.status;
      if (status === "initiated" && pay.agentId) {
        try {
          const agent = await getAgentById(pay.agentId);
          if (agent) {
            ensureAdapters();
            const adapters = resolveAdapters(agent.definition);
            if (adapters.payment) {
              const actx = adapterContext(agent.definition, agent.definition.integrations.payment);
              ({ status } = await adapters.payment.getStatus(actx, { reference }));
            }
          }
        } catch (err) {
          log.error("payment_return_probe_failed", err, { reference });
        }
        if (status !== "initiated") {
          await db.update(payments).set({ status, updatedAt: new Date() }).where(eq(payments.reference, reference));
          if (pay.conversationId) {
            const c = await getCase(pay.conversationId);
            if (c) await saveCase(c.caseId, setPayment(c.state, { status }));
          }
          await audit({
            agentId: pay.agentId,
            conversationId: pay.conversationId ?? undefined,
            actor: "system",
            action: `payment_${status}_on_return`,
            payload: { reference },
          });
        }
      }
    }
  }

  const headline = status === "paid" ? t.paid : status === "failed" ? t.failed : t.pending;
  const sub = status === "paid" ? t.backPaid : t.backOther;
  const colour = status === "paid" ? "#0F9D58" : status === "failed" ? "#D23F31" : "#5B6478";
  const dir = locale === "ar" ? "rtl" : "ltr";

  const html = `<!doctype html><html lang="${locale}" dir="${dir}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${headline}</title><style>
body{margin:0;min-height:100dvh;display:flex;align-items:center;justify-content:center;
font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#f6f8fc;color:#0f172a}
.card{background:#fff;border:1px solid #e1e8f0;border-radius:14px;padding:32px 36px;text-align:center;max-width:380px}
h1{font-size:18px;margin:0 0 8px;color:${colour}}p{margin:0;font-size:14px;color:#5B6478;line-height:1.6}
</style></head><body><div class="card"><h1>${headline}</h1><p>${sub}</p></div>
${status === "paid" ? `<script>setTimeout(function(){window.close();},1600);</script>` : ""}
</body></html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
