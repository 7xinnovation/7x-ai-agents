/**
 * NXN Round-2 feedback FB-1433: corporate KB enrichment — the assistant had no
 * grounded answers for basic corporate questions (required documents,
 * eligibility, fees, timelines). Adds an EN + AR "Corporate PO Box" section to
 * the knowledge base (published), embedded when VOYAGE_API_KEY is configured.
 *
 * Fee-specific figures are intentionally NOT hard-coded (live pricing comes from
 * the Emirates Post tools); the key-delivery courier fee must match the journey
 * guidance constant (AED 25 — confirm against the official tariff).
 *
 * Idempotent: skips creation when a document with the same title already exists.
 * Run from apps/web: npx tsx scripts/add-nxn-corporate-kb.ts
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import { getDb, agents, kbDocuments } from "@dialog/db";
import { eq } from "drizzle-orm";
import { createKbDocument, listKbDocuments } from "../lib/kb";

const EN_TITLE = "Corporate PO Box: eligibility, documents, fees, timelines";
const AR_TITLE = "صندوق البريد للشركات: الأهلية والمستندات والرسوم والمدد";
const SOURCE = "NXN Services Guide §7";

const EN_CONTENT = `Corporate PO Box — who is eligible. Any company registered in the UAE with a valid trade license can rent a corporate PO Box. The application must be made by the company owner: the owner signs in with UAE PASS and the system verifies that the owner's Emirates ID matches an owner recorded on the trade license (via the government service bus). Authorized signatories or agents cannot open the box themselves, but an authorized agent can be added to the box during or after the application.

Corporate PO Box — required documents and information. 1) The owner's UAE PASS sign-in (name, Emirates ID and its expiry come from the profile — no identity upload is needed). 2) The trade license issuing entity, and if automatic verification does not find the company, the trade license number. 3) Only if automatic verification still cannot match the company (Tier 3): a copy of the trade license (PDF, PNG or JPG, up to 10 MB) uploaded in the chat; the application is then validated manually before the box is activated. 4) The company address (typed, or pinned on the map). 5) Optional: an authorized agent — the agent's Emirates ID front and back are uploaded and read automatically; an agent with an expired Emirates ID cannot be added. Uploaded documents are saved with the application and attached to the PO Box record.

Corporate PO Box — bundles and fees. Corporate bundles are Basic, Premium and Premium Plus; each has an annual fee that depends on the bundle and rental duration (1 or 2 years). Exact, current prices always come from the live Emirates Post systems and are shown in the chat as bundle cards before any selection — the assistant never estimates prices. Optional key delivery by courier costs AED 25, disclosed before the customer chooses between branch collection (free) and delivery. Payment is taken securely through the payment gateway after the customer accepts the Terms and Conditions.

Corporate PO Box — timelines. When the company is verified automatically (Tier 1 or Tier 2), the PO Box is active immediately after successful payment and the confirmation shows the box number and receipt. When documents go to manual validation (Tier 3), payment is still taken, and the box is activated once validation completes — typically within 1 to 2 business days; the customer receives the case reference to track the request. Corporate renewals keep the same bundle; if the trade license on file has expired, the renewal is routed to document validation the same way.`;

const AR_CONTENT = `صندوق البريد للشركات — الأهلية. يمكن لأي شركة مسجلة في دولة الإمارات وتحمل رخصة تجارية سارية استئجار صندوق بريد للشركات. يجب أن يقدم الطلب مالك الشركة بنفسه: يسجّل المالك الدخول عبر الهوية الرقمية (UAE PASS) ويتحقق النظام من تطابق رقم هويته الإماراتية مع بيانات المالك في الرخصة التجارية. لا يمكن للمفوضين فتح الصندوق، ولكن يمكن إضافة وكيل مفوّض إلى الصندوق أثناء الطلب أو بعده.

صندوق البريد للشركات — المستندات والمعلومات المطلوبة. 1) تسجيل دخول المالك عبر UAE PASS (الاسم ورقم الهوية وتاريخ انتهائها تؤخذ من الملف الشخصي دون رفع مستندات). 2) جهة إصدار الرخصة التجارية، وإذا لم يجد التحقق التلقائي الشركة فرقم الرخصة التجارية. 3) فقط إذا تعذر التحقق التلقائي (المستوى الثالث): نسخة من الرخصة التجارية (PDF أو PNG أو JPG حتى 10 ميغابايت) تُرفع داخل المحادثة، ويُدقق الطلب يدوياً قبل تفعيل الصندوق. 4) عنوان الشركة (كتابةً أو بتحديد الموقع على الخريطة). 5) اختياري: وكيل مفوّض — تُرفع صورتا الوجه الأمامي والخلفي لهويته وتُقرأ تلقائياً؛ ولا يمكن إضافة وكيل بهوية منتهية الصلاحية. تُحفظ المستندات المرفوعة مع الطلب وتُرفق بسجل صندوق البريد.

صندوق البريد للشركات — الباقات والرسوم. باقات الشركات هي: أساسي، بريميوم، وبريميوم بلس، ولكل باقة رسوم سنوية بحسب الباقة ومدة الإيجار (سنة أو سنتان). تأتي الأسعار الدقيقة دائماً من أنظمة بريد الإمارات مباشرة وتُعرض في المحادثة كبطاقات قبل الاختيار — ولا يقدّر المساعد الأسعار أبداً. توصيل المفتاح الاختياري بالمندوب رسومه 25 درهماً، وتُعرض قبل اختيار العميل بين الاستلام من الفرع (مجاناً) أو التوصيل. يتم الدفع بأمان عبر بوابة الدفع بعد الموافقة على الشروط والأحكام.

صندوق البريد للشركات — المدد الزمنية. عند التحقق التلقائي من الشركة يكون الصندوق فعالاً فور إتمام الدفع مع عرض رقم الصندوق والإيصال. أما عند التحويل إلى التدقيق اليدوي (المستوى الثالث) فيتم الدفع ويُفعَّل الصندوق بعد اكتمال التدقيق — عادةً خلال يوم إلى يومي عمل — ويحصل العميل على رقم مرجعي لمتابعة الطلب. تجديد صناديق الشركات يبقى على الباقة نفسها؛ وإذا كانت الرخصة التجارية المسجلة منتهية الصلاحية يُحوَّل التجديد إلى تدقيق المستندات بالطريقة نفسها.`;

async function main() {
  const db = getDb();
  const [agent] = await db.select().from(agents).where(eq(agents.slug, "nxn-dialog")).limit(1);
  if (!agent) throw new Error("nxn-dialog not found");

  const existing = await listKbDocuments(agent.id);
  const have = new Set(existing.map((d) => d.title));

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
  console.log(`KB now has ${docs.length} documents for nxn-dialog.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
