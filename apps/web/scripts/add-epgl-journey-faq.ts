/**
 * EPGL Round-1-internal feedback FB-1424: KB enrichment for the application
 * journey — FAQs covering the review timeline, when payment is requested,
 * payment methods, and what happens after submission. EN + AR, published.
 *
 * The review SLA quoted here ("2 business days") is a business constant — keep
 * it in sync with apply-epgl-round1-internal-feedback.ts and confirm the
 * official figure with EPGL before production.
 *
 * Idempotent (skips titles that already exist). Run from apps/web:
 *   npx tsx scripts/add-epgl-journey-faq.ts
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import { getDb, agents, kbDocuments } from "@dialog/db";
import { eq } from "drizzle-orm";
import { createKbDocument, listKbDocuments } from "../lib/kb";

const EN_TITLE = "Application FAQs: review timeline, payment, and next steps";
const AR_TITLE = "الأسئلة الشائعة عن الطلب: مدة المراجعة والدفع والخطوات التالية";
const SOURCE = "EPGL Licensing Guide §8";

const EN_CONTENT = `How long does the review take? After you submit a new license application or a renewal, the EPGL team reviews your documents — typically within 2 business days. If anything is missing or unclear, the team contacts you with the outstanding items, so accurate and legible documents mean the fastest processing. You can check your application status any time by asking the assistant (sign in to link the request to your account).

When is payment requested? Payment is NOT taken at submission. Once the document review is approved, EPGL issues a payment request for the licensing fee. You are notified, and the fee is paid through the secure payment gateway. Licensing fees vary by license type and duration, and are non-refundable once the application is processed.

How do I pay? Payments are made by card through the secure EPGL payment gateway link — never by cash or transfer through the chat. Card details are entered only on the gateway's secure page; the assistant never sees or stores card information. A receipt is available after payment.

What happens after submission? The steps are: 1) document review by the EPGL team (typically within 2 business days); 2) approval, followed by the payment request; 3) payment through the secure gateway; 4) the postal activity license is issued and shared with you. Your application reference (the license request number) is shown at submission — keep it for tracking and follow-up. For renewals, the renewed license follows the same review-then-payment sequence, and quarterly leviable-income reporting continues through the mandatory IDEP integration.`;

const AR_CONTENT = `كم تستغرق مراجعة الطلب؟ بعد تقديم طلب رخصة جديدة أو تجديدها، يراجع فريق الترخيص في مجموعة بريد الإمارات المستندات خلال يومي عمل تقريباً. إذا كان هناك نقص أو غموض في المستندات فسيتواصل معك الفريق لاستكمالها، لذا فإن دقة المستندات ووضوحها يعنيان معالجة أسرع. يمكنك الاستعلام عن حالة طلبك في أي وقت عبر المساعد (سجّل الدخول لربط الطلب بحسابك).

متى يُطلب الدفع؟ لا يُحصَّل أي رسم عند التقديم. بعد اعتماد مراجعة المستندات تُصدر الجهة طلب دفع لرسوم الترخيص، ويتم إشعارك لدفعه عبر بوابة الدفع الآمنة. تختلف رسوم الترخيص بحسب نوع الرخصة ومدتها، وهي غير قابلة للاسترداد بعد معالجة الطلب.

كيف أدفع؟ يتم الدفع بالبطاقة عبر رابط بوابة الدفع الآمنة الخاصة بالجهة، ولا يتم الدفع نقداً أو بالتحويل عبر المحادثة. تُدخل بيانات البطاقة في صفحة البوابة الآمنة فقط، ولا يطّلع المساعد على بيانات البطاقة أو يخزنها. ويتوفر إيصال بعد إتمام الدفع.

ماذا يحدث بعد التقديم؟ الخطوات هي: 1) مراجعة المستندات من فريق الترخيص (خلال يومي عمل تقريباً)؛ 2) الاعتماد ثم إصدار طلب الدفع؛ 3) الدفع عبر البوابة الآمنة؛ 4) إصدار رخصة النشاط البريدي ومشاركتها معك. يظهر الرقم المرجعي لطلبك (رقم طلب الترخيص) عند التقديم — احتفظ به للمتابعة. وفي حالات التجديد تمر الرخصة المجددة بالتسلسل نفسه (مراجعة ثم دفع)، ويستمر الإفصاح عن الدخل الربع سنوي عبر التكامل الإلزامي مع منصة IDEP.`;

async function main() {
  const db = getDb();
  const [agent] = await db.select().from(agents).where(eq(agents.slug, "epgl-dialog")).limit(1);
  if (!agent) throw new Error("epgl-dialog not found");

  const have = new Set((await listKbDocuments(agent.id)).map((d) => d.title));
  for (const doc of [
    { title: EN_TITLE, locale: "en" as const, content: EN_CONTENT },
    { title: AR_TITLE, locale: "ar" as const, content: AR_CONTENT },
  ]) {
    if (have.has(doc.title)) {
      console.log(`  (skip) already present: ${doc.title}`);
      continue;
    }
    const res = await createKbDocument({
      agentId: agent.id,
      title: doc.title,
      source: SOURCE,
      locale: doc.locale,
      content: doc.content,
      status: "published",
    });
    console.log(`  + ${doc.title}: ${res.chunks} chunks, embedded=${res.embedded}`);
  }
  const docs = await db.select({ title: kbDocuments.title }).from(kbDocuments).where(eq(kbDocuments.agentId, agent.id));
  console.log(`KB now has ${docs.length} documents for epgl-dialog.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
