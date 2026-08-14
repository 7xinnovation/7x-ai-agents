/**
 * EPGL fee structure, clarified by Emirates Post Group Licensing (2026-08-14).
 *
 * The earlier note said "a 10% fee of the total revenue, with a minimum fee of
 * AED 100,000", which read as ONE charge with a floor. The clarification is that
 * there are TWO separate charges:
 *
 *   1. Annual licensing fee — AED 100,000, paid in advance every year when the
 *      licence is issued or renewed (the minimum fee for the licence period).
 *   2. Levy — 10% of revenue from LEVIABLE services (not total revenue), with a
 *      minimum of AED 2 per shipment. Assessed per quarter off the Form 9.
 *
 * Two things the assistant must NOT do, encoded here:
 *   - Compute the levy itself. The AED 2 per-shipment floor needs shipment
 *     counts, which the Form 9 read API does not expose (revenue amounts only).
 *     Salesforce already publishes EPG_Calculated_Levy_Amount__c and
 *     EPG_Due_Fees_for_the_period__c per quarter — those are the figures to use.
 *   - Treat the AED 100,000 as the levy, or the levy as a top-up to it.
 *
 * This is knowledge + guardrail only. No payment amount is hardcoded anywhere in
 * the agent; EPGL issues the payment request after the document review.
 *
 * Idempotent (keyed on MARKER). Run from apps/web:
 *   npx tsx scripts/apply-epgl-fee-structure-2026-08-14.ts
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import { getDb, agents, kbChunks, kbDocuments } from "@dialog/db";
import { and, eq } from "drizzle-orm";
import { createKbDocument, deleteKbDocument, listKbDocuments } from "../lib/kb";

const SLUG = "epgl-dialog";
const MARKER = "FEE STRUCTURE (2026-08-14):";
const SOURCE = "EPGL Licensing Guide §7";

const FEES_EN_TITLE = "Fees overview";
const FEES_AR_TITLE = "نظرة عامة على الرسوم";

const FEES_EN = `Licensing fees. There are two separate charges — the annual licensing fee and the quarterly levy. They are not alternatives to each other and one is not a top-up of the other.

Annual licensing fee. AED 100,000 per year, payable in advance when the license is issued and again at each renewal. This is the minimum fee for the license period.

Quarterly levy. A levy of 10% applies to revenue from leviable services — not to total revenue — with a minimum of AED 2 per shipment. It is assessed each quarter from the Form 9 (postal revenue return). Emirates Post Group Licensing calculates the levy; the amount due for a quarter, the amount already paid and any outstanding balance are read from that quarter's Form 9 record. The assistant never calculates or estimates a levy figure of its own.

Which revenue counts. Only revenue from leviable services is in scope for the 10%. Revenue from non-leviable services, and income from non-licensed activities, are excluded. Which services are leviable is set by Emirates Post Group Licensing.

When each is paid. Payment is not taken at submission. The annual licensing fee is requested once the document review is approved and is paid through the secure payment gateway. The quarterly levy follows the Form 9 for that quarter. Licensing fees are non-refundable once the application is processed.

The exact amount payable is always the figure in the payment request issued by Emirates Post Group Licensing. If anything quoted in chat differs from the payment request, the payment request is correct.`;

const FEES_AR = `رسوم الترخيص. هناك رسمان منفصلان — رسم الترخيص السنوي والرسم الربع سنوي على الخدمات الخاضعة للرسم. وهما ليسا بديلين عن بعضهما، ولا يُعد أحدهما مكمّلاً للآخر.

رسم الترخيص السنوي. 100,000 درهم إماراتي سنوياً، تُدفع مقدماً عند إصدار الرخصة وعند كل تجديد. وهو الحد الأدنى للرسم عن فترة الترخيص.

الرسم الربع سنوي. تُطبَّق نسبة 10% على إيرادات الخدمات الخاضعة للرسم — وليس على إجمالي الإيرادات — بحد أدنى درهمان (2 درهم) لكل شحنة. ويُحتسب كل ربع سنة استناداً إلى النموذج 9 (إقرار إيرادات البريد). وتتولى مجموعة بريد الإمارات للترخيص احتساب هذا الرسم، ويُقرأ المبلغ المستحق عن الربع والمبلغ المدفوع وأي رصيد متبقٍ من سجل النموذج 9 لذلك الربع. ولا يقوم المساعد باحتساب أو تقدير أي مبلغ للرسم من تلقاء نفسه.

الإيرادات المشمولة. تدخل في نطاق نسبة 10% إيرادات الخدمات الخاضعة للرسم فقط، وتُستثنى إيرادات الخدمات غير الخاضعة للرسم وكذلك الدخل من الأنشطة غير المرخّصة. وتحدد مجموعة بريد الإمارات للترخيص الخدمات الخاضعة للرسم.

مواعيد الدفع. لا يُحصَّل أي مبلغ عند التقديم. يُطلب رسم الترخيص السنوي بعد اعتماد مراجعة المستندات ويُدفع عبر بوابة الدفع الآمنة، بينما يتبع الرسم الربع سنوي النموذج 9 الخاص بذلك الربع. ورسوم الترخيص غير قابلة للاسترداد بعد معالجة الطلب.

المبلغ المستحق فعلياً هو دائماً المبلغ الوارد في طلب الدفع الصادر عن مجموعة بريد الإمارات للترخيص. وإذا اختلف أي رقم ورد في المحادثة عن طلب الدفع، فطلب الدفع هو الصحيح.`;

/** The sentence in the payment FAQ that the clarification supersedes, EN + AR. */
const FAQ_REPLACEMENTS: Array<[from: string, to: string]> = [
  [
    "Licensing fees vary by license type and duration, and are non-refundable once the application is processed.",
    "The annual licensing fee is AED 100,000, payable in advance for the license period; the 10% levy on leviable services is charged separately each quarter off the Form 9. Licensing fees are non-refundable once the application is processed.",
  ],
  [
    "تختلف رسوم الترخيص بحسب نوع الرخصة ومدتها، وهي غير قابلة للاسترداد بعد معالجة الطلب.",
    "رسم الترخيص السنوي 100,000 درهم إماراتي يُدفع مقدماً عن فترة الترخيص، ويُحتسب الرسم البالغ 10% على الخدمات الخاضعة للرسم بصورة منفصلة كل ربع سنة استناداً إلى النموذج 9. ورسوم الترخيص غير قابلة للاسترداد بعد معالجة الطلب.",
  ],
];

/** Guardrail appended to both journeys' guidance. */
const RULE = `${MARKER} EPGL charges TWO separate fees. (1) An annual licensing fee of AED 100,000, paid in advance when the licence is issued and at each renewal — the minimum fee for the licence period. (2) A levy of 10% on revenue from LEVIABLE services only (never on total revenue), minimum AED 2 per shipment, assessed per quarter from the Form 9. These are separate charges; never present one as a floor, cap or top-up of the other, and never add them into a single "licence fee". NEVER calculate, estimate or extrapolate a levy amount yourself — the per-shipment minimum depends on shipment counts you do not have. Quote levy figures only as read from the Form 9 record (calculated levy, due fees for the period, amount paid, payable balance). If a Form 9 has no calculated figure yet, say the amount is confirmed by EPGL in the payment request rather than working it out. The exact payable amount is always the figure in the payment request EPGL issues after the document review.`;

async function replaceDoc(
  agentId: string,
  existing: { id: string; title: string } | undefined,
  doc: { title: string; locale: "en" | "ar"; content: string }
) {
  if (existing) await deleteKbDocument(agentId, existing.id);
  const res = await createKbDocument({
    agentId,
    title: doc.title,
    source: SOURCE,
    locale: doc.locale,
    content: doc.content,
    status: "published",
  });
  console.log(`  ${existing ? "~" : "+"} ${doc.title}: ${res.chunks} chunks, embedded=${res.embedded}`);
}

async function main() {
  const db = getDb();
  const [agent] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!agent) throw new Error(`${SLUG} not found`);

  // ── 1. Fees overview, EN + AR ─────────────────────────────────────────────
  const docs = await listKbDocuments(agent.id);
  const byTitle = new Map(docs.map((d) => [d.title, d]));
  for (const doc of [
    { title: FEES_EN_TITLE, locale: "en" as const, content: FEES_EN },
    { title: FEES_AR_TITLE, locale: "ar" as const, content: FEES_AR },
  ]) {
    await replaceDoc(agent.id, byTitle.get(doc.title), doc);
  }

  // ── 2. The one superseded sentence in the payment FAQ ──────────────────────
  for (const d of docs) {
    if (d.title === FEES_EN_TITLE || d.title === FEES_AR_TITLE) continue;
    const chunks = await db
      .select({ content: kbChunks.content, createdAt: kbChunks.createdAt })
      .from(kbChunks)
      .where(and(eq(kbChunks.agentId, agent.id), eq(kbChunks.documentId, d.id)));
    chunks.sort((a, b) => Number(a.createdAt) - Number(b.createdAt));
    const before = chunks.map((c) => c.content).join("\n\n");
    let after = before;
    for (const [from, to] of FAQ_REPLACEMENTS) after = after.split(from).join(to);
    if (after === before) continue;
    await replaceDoc(agent.id, d, { title: d.title, locale: d.locale as "en" | "ar", content: after });
  }

  // ── 3. Guardrail on both journeys ─────────────────────────────────────────
  const def = agent.definition as typeof agent.definition & { journeys: Array<{ key: string; guidance?: string }> };
  let touched = false;
  for (const j of def.journeys ?? []) {
    const guidance = String(j.guidance ?? "");
    if (guidance.includes(MARKER)) {
      console.log(`  (skip) ${j.key}: already carries the fee rule`);
      continue;
    }
    j.guidance = `${guidance.trimEnd()}\n\n${RULE}`;
    touched = true;
    console.log(`  + ${j.key}: fee-structure rule added`);
  }
  if (touched) await db.update(agents).set({ definition: def }).where(eq(agents.id, agent.id));

  const total = await db.select({ title: kbDocuments.title }).from(kbDocuments).where(eq(kbDocuments.agentId, agent.id));
  console.log(`KB now has ${total.length} documents for ${SLUG}.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
