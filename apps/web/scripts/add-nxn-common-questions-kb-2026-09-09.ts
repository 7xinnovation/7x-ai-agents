/**
 * The questions customers actually asked that the assistant could not answer.
 *
 * From the 9 September UAT round, each one met "the knowledge base does not
 * contain enough detail" and a link to raise an enquiry:
 *
 *   - What do I get with a PO Box — what are the benefits?
 *   - What payment methods can I use, online and at the branch?
 *   - Can my sister rent the box for me and register it in my name?
 *   - What documents do I need to rent one?
 *   - Can I move box 2290 from one branch to another after renting it?
 *
 * Three of those we can answer with authority, because they are facts about our
 * own flow: what the online payment accepts, what the online rental requires,
 * and how somebody else can be given access to a box. Those are written here.
 *
 * The other two — what a counter accepts as payment, and whether a box can be
 * transferred between branches — are Emirates Post's policy and not ours to
 * state. This document says so explicitly, so the assistant keeps routing them
 * to an enquiry instead of improvising, which is the right answer until EPG
 * gives us the real one.
 *
 * Idempotent: skips a title that already exists.
 * Run from apps/web:
 *   npx tsx scripts/add-nxn-common-questions-kb-2026-09-09.ts [--env <file>]
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const envArg = process.argv.indexOf("--env");
config({
  path:
    envArg !== -1 && process.argv[envArg + 1]
      ? resolve(process.argv[envArg + 1]!)
      : resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env"),
});

import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";
import { createKbDocument, listKbDocuments } from "../lib/kb";

const EN_TITLE = "Common questions: payment, documents, acting for someone else";
const AR_TITLE = "أسئلة شائعة: الدفع والمستندات والاستئجار نيابة عن شخص آخر";
const SOURCE = "NXN Services Guide — common questions";

const EN = `Paying for a PO Box online. Payment is taken on Emirates Post's secure payment page, which opens inside the chat. It accepts credit and debit cards. If you are signed in you can choose to save the card for future payments, and to renew the box automatically when the term ends — both are optional and both are off unless you turn them on. The exact amount is always shown before you pay, and it includes the one-time registration fee on a new rental. No money is taken until you complete the payment page.

Paying at a branch. Which payment methods a counter accepts is decided by Emirates Post and is not something this assistant can confirm. For that, raise an enquiry at https://www.emiratespost.ae/contact-us/raise-an-enquiry or call 600 599 999.

What you need to rent a PO Box online. Sign in with UAE PASS — your name, Emirates ID and its expiry come from your profile, so no identity document is uploaded for a personal box. You then choose the bundle, the emirate, the branch, a box number and the rental period. A corporate box additionally needs the trade licence details, and a copy of the trade licence only if the company cannot be verified automatically. Nothing else is required for a personal rental.

Renting on someone else's behalf. A PO Box is rented in the name of the person who signs in: the box is linked to their Emirates ID, so somebody else cannot register it in your name by signing in as themselves. What they CAN do is be added to your box as an authorised agent, either while you rent it or afterwards from "Manage existing PO Box". An authorised agent may collect mail from the box on your behalf; they are added with their Emirates ID, and an agent whose Emirates ID has expired cannot be added.

Moving a box between branches. Whether an existing PO Box can be transferred from one branch to another after it has been rented is Emirates Post's decision and this assistant cannot confirm it. Raise an enquiry at https://www.emiratespost.ae/contact-us/raise-an-enquiry or call 600 599 999. Note that renting a NEW box at a different branch is always possible and can be done here.

What is included. Each bundle's own description and price come from Emirates Post's live system and are shown on the plan cards when you choose — those are the authoritative list of what a bundle includes. This assistant does not maintain a separate list of benefits and will not state one that the plan card does not show.`;

const AR = `الدفع مقابل صندوق البريد عبر الإنترنت. يتم الدفع عبر صفحة الدفع الآمنة الخاصة ببريد الإمارات، والتي تفتح داخل المحادثة. تقبل بطاقات الائتمان والخصم. إذا كنت مسجّلاً للدخول يمكنك اختيار حفظ البطاقة للمدفوعات المستقبلية، وتجديد الصندوق تلقائياً عند انتهاء المدة — وكلا الخيارين اختياريان ومعطّلان ما لم تقم بتفعيلهما. يُعرض المبلغ الدقيق دائماً قبل الدفع، ويشمل رسوم التسجيل لمرة واحدة عند الاستئجار الجديد. لا يُخصم أي مبلغ حتى تُكمل صفحة الدفع.

الدفع في الفرع. طرق الدفع المتاحة عند الكاونتر يحددها بريد الإمارات، ولا يستطيع هذا المساعد تأكيدها. لذلك يُرجى رفع استفسار عبر https://www.emiratespost.ae/ar/contact-us/raise-an-enquiry أو الاتصال على 600 599 999.

ما تحتاجه لاستئجار صندوق بريد عبر الإنترنت. سجّل الدخول عبر الهوية الرقمية UAE PASS — يأتي اسمك ورقم هويتك الإماراتية وتاريخ انتهائها من ملفك الشخصي، لذا لا تحتاج إلى رفع أي مستند هوية للصندوق الشخصي. بعد ذلك تختار الباقة والإمارة والفرع ورقم الصندوق ومدة الاستئجار. أما الصندوق للشركات فيحتاج إضافةً إلى بيانات الرخصة التجارية، ونسخة من الرخصة فقط إذا تعذّر التحقق من الشركة تلقائياً. لا يُطلب شيء آخر للاستئجار الشخصي.

الاستئجار نيابة عن شخص آخر. يُستأجر صندوق البريد باسم الشخص الذي يسجّل الدخول: الصندوق مرتبط بهويته الإماراتية، لذا لا يمكن لشخص آخر تسجيله باسمك عبر الدخول بحسابه هو. لكن ما يمكنه فعله هو إضافته إلى صندوقك كوكيل معتمد، سواء أثناء الاستئجار أو لاحقاً من "إدارة صندوق بريد قائم". يمكن للوكيل المعتمد استلام البريد من الصندوق نيابةً عنك؛ ويُضاف عبر هويته الإماراتية، ولا يمكن إضافة وكيل انتهت صلاحية هويته.

نقل الصندوق بين الفروع. إمكانية نقل صندوق بريد قائم من فرع إلى آخر بعد استئجاره قرار يعود إلى بريد الإمارات ولا يستطيع هذا المساعد تأكيده. يُرجى رفع استفسار عبر https://www.emiratespost.ae/ar/contact-us/raise-an-enquiry أو الاتصال على 600 599 999. مع العلم أن استئجار صندوق جديد في فرع مختلف ممكن دائماً ويمكن إتمامه هنا.

ما الذي تتضمنه الباقة. وصف كل باقة وسعرها يأتيان من نظام بريد الإمارات المباشر ويظهران على بطاقات الباقات عند الاختيار — وهي المرجع المعتمد لما تتضمنه الباقة. لا يحتفظ هذا المساعد بقائمة منفصلة للمزايا ولن يذكر ميزة لا تظهر على بطاقة الباقة.`;

async function main() {
  const [agent] = await getDb().select().from(agents).where(eq(agents.slug, "nxn-dialog"));
  if (!agent) throw new Error("nxn-dialog not found in this database");
  const existing = await listKbDocuments(agent.id);
  const have = new Set(existing.map((d) => d.title));

  for (const [title, content, locale] of [
    [EN_TITLE, EN, "en"],
    [AR_TITLE, AR, "ar"],
  ] as const) {
    if (have.has(title)) {
      console.log(`  (skip) already present — ${title}`);
      continue;
    }
    const doc = await createKbDocument({
      agentId: agent.id,
      title,
      content,
      source: SOURCE,
      locale,
      status: "published",
    });
    console.log(`  + ${title}  (${doc?.id ?? "created"})`);
  }
  console.log("\ndone.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
