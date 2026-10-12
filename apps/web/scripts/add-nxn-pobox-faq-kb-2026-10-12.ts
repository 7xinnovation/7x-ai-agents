/**
 * The PO Box FAQ, as the chat actually works — FB-1710 (2026-10-12).
 *
 * "General P.O. Box Inquiries — some general PO Box service-related inquiries
 * were not answered by the Agentic ... should the Agentic answer them directly
 * or route them elsewhere?" The attachment is NXN's "PO Box Services — AI
 * Chatbot FAQ Knowledge Base" (June). Its answers describe a menu
 * ("Select: PO Box Services → Individual Customer → ..."), so they are rewritten
 * here for a conversation, and checked against what the chat really does:
 *
 *   - key delivery is AED 30 (the FAQ's figure, and the one confirmed from
 *     GetChargesForAdditionalServices on 1 September — not the AED 25 an older
 *     chunk once said);
 *   - a signed-in customer's boxes appear from their Emirates ID, so "linking"
 *     an existing box is not a step here;
 *   - renewal needs the box number and the emirate (plus the holder's masked
 *     name for a guest), not an Emirates ID typed in;
 *   - Noqodi (UAE Pay) is named as the second way to pay a renewal.
 *
 * The answer to the round's question is: directly, from here — and what this
 * does not cover is raised as an enquiry in the chat (FB-1803), never routed to
 * another website.
 *
 * Idempotent: skips a title that already exists. Run from apps/web:
 *   npx tsx scripts/add-nxn-pobox-faq-kb-2026-10-12.ts [--env <file>]
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const envArg = process.argv.indexOf("--env");
config({
  path:
    envArg !== -1 && process.argv[envArg + 1]
      ? resolve(process.argv[envArg + 1]!)
      : resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env"),
});

import { getDb, agents, kbChunks, kbDocuments } from "@dialog/db";
import { eq } from "drizzle-orm";
import { createKbDocument, listKbDocuments } from "../lib/kb";

export const EN_TITLE = "PO Box services FAQ: renting, renewing, agents, key delivery, auto-renewal";
export const AR_TITLE = "الأسئلة الشائعة عن خدمات صندوق البريد: الاستئجار والتجديد والوكلاء وتوصيل المفتاح والتجديد التلقائي";
/**
 * The source label is what the customer sees under a reply, in the "Sources"
 * chips — so it is named the way a customer would say it. The internal
 * "NXN … Knowledge Base (June 2026), rewritten for the chat" wording was
 * showing up in the chat verbatim (seen on production, 12 October 2026).
 */
export const SOURCE = "Emirates Post PO Box FAQ";
/** Older documents whose labels leak the project code into the same chips. */
export const SOURCE_RENAMES: Record<string, string> = {
  "NXN PO Box Services — AI Chatbot FAQ Knowledge Base (June 2026), rewritten for the chat": SOURCE,
  "NXN Services Guide — common questions": "Emirates Post services guide — common questions",
  "NXN Services Guide": "Emirates Post services guide",
};
/** The customer-facing label for a stored source label (unchanged when it is already one). */
export function customerSource(label: string): string {
  if (SOURCE_RENAMES[label]) return SOURCE_RENAMES[label]!;
  for (const [from, to] of Object.entries(SOURCE_RENAMES)) if (label.startsWith(from + " ")) return to + label.slice(from.length);
  return label;
}

export const EN = `What this assistant can do for your PO Box. Rent a new personal PO Box (MyBox, MyHome or MyHome Instant) or a corporate PO Box; renew a personal or corporate box, and upgrade the bundle while renewing; add an authorised agent; request PO Box key delivery; switch auto-renewal on or off; manage a box you already hold, including linking an additional trade licence to a corporate box; and track a shipment. Everything, including the payment and the confirmation, happens here in the chat — there is no need to visit a branch to rent or renew a PO Box.

Renting a new personal PO Box: what is needed. Sign in with UAE PASS (your name, Emirates ID and its expiry come from your profile, so no identity document is uploaded), then choose the emirate, the branch, the bundle — MyBox, MyHome or MyHome Instant — and the subscription term, one or two years. Your contact details come from your UAE PASS profile. Before payment you can add an authorised agent, key delivery and auto-renewal. Payment is taken on Emirates Post's secure payment page inside the chat, and the box number and the receipt are confirmed straight after.

Personal PO Box bundles. MyBox: you collect your mail from the branch where the box is. MyHome: your mail is delivered to your home address in the emirate the box is registered in, and the key comes with the box. MyHome Instant: the premium delivery service, with faster delivery. Each bundle's current price and what it includes come from Emirates Post's live system and are shown on the bundle cards when you choose — the assistant never quotes a price from memory.

Renting a corporate PO Box: what is needed. The company owner signs in with UAE PASS; then the trade licence issuing authority (and the licence number if the company is not found automatically), the preferred location, the bundle — Basic, Premium or Premium Plus — and the term, one or two years. Company details are validated automatically against the licence; if that cannot match the company, a copy of the trade licence is uploaded in the chat and validated manually. Before payment you can add an authorised agent, link an additional trade licence, request key delivery and switch on auto-renewal.

Renewing a personal PO Box. Signed in with UAE PASS, your boxes are listed with a Renew button: one tap renews the box for one more year on the same bundle and options and the payment page opens — pay with your card on Emirates Post's page, or with Noqodi (UAE Pay) here in the chat. Not signed in, give the box number and the emirate, confirm the masked name of the registered holder, accept the Terms and pay by card; nothing else is asked. A longer term, a different bundle, an authorised agent or key delivery can be asked for before you pay.

Renewing a corporate PO Box. The company owner signs in with UAE PASS and gives the corporate box number; the company and box details are retrieved from Emirates Post, so nothing is typed again. The current bundle is kept unless you ask to upgrade, which can be done before payment. An authorised agent, an additional trade licence or key delivery can be added before completing the renewal, and auto-renewal can be switched on.

Authorised agent. An authorised agent is a person allowed to collect the PO Box's mail on behalf of the box holder. Add one when renting or renewing, or later for a box you already hold: the assistant needs the agent's Emirates ID, front and back, uploaded in the chat and read automatically, and the agent's mobile number; an agent whose Emirates ID has expired cannot be added. The first authorised agent is included with the box at no extra charge; any further agent or change carries the fee Emirates Post quotes in the chat before you pay.

PO Box key delivery. Instead of collecting the key at the branch, you can have it delivered by courier for AED 30, added before payment. MyHome and MyHome Instant boxes come with their key, so delivery is not offered for them. The charged amount is always the one Emirates Post confirms in the chat before you pay.

Auto-renewal. Auto-renewal renews your PO Box automatically before it expires, so there is no interruption, charging the card saved on your Emirates Post account. Switch it on when you rent or renew, or at any time afterwards by asking here while signed in; it needs a saved card. You can switch it off the same way at any time, and the assistant confirms the change.

Linking an existing PO Box. When you sign in with UAE PASS, every PO Box held under your Emirates ID appears automatically — there is no separate linking step. For a corporate box you can link an additional trade licence through Manage my PO Box.

Questions this does not answer, complaints and callbacks. If something is not covered here — a branch counter's payment methods, moving a box between branches, a problem with your mail — tell the assistant: it raises an enquiry for you inside the chat and gives you a reference the team follows up on. You can also call Emirates Post on 600 599 999. You are never sent to another website or form to raise it.`;

export const AR = `ما الذي يمكن لهذه المساعدة فعله لصندوق بريدك. استئجار صندوق بريد شخصي جديد (MyBox أو MyHome أو MyHome Instant) أو صندوق بريد للشركات؛ تجديد صندوق شخصي أو صندوق شركة، وترقية الباقة أثناء التجديد؛ إضافة وكيل معتمد؛ طلب توصيل مفتاح الصندوق؛ تفعيل التجديد التلقائي أو إيقافه؛ إدارة صندوق لديك بالفعل، بما في ذلك ربط رخصة تجارية إضافية بصندوق الشركة؛ وتتبع شحنة. كل شيء، بما فيه الدفع والتأكيد، يتم هنا في المحادثة — لا حاجة لزيارة الفرع لاستئجار صندوق بريد أو تجديده.

استئجار صندوق بريد شخصي جديد: ما المطلوب. سجّل الدخول بالهوية الرقمية UAE PASS (يأتي اسمك ورقم هويتك الإماراتية وتاريخ انتهائها من ملفك، فلا يُرفع أي مستند هوية)، ثم اختر الإمارة والفرع والباقة — MyBox أو MyHome أو MyHome Instant — ومدة الاشتراك، سنة أو سنتين. بيانات التواصل تأتي من ملف UAE PASS. قبل الدفع يمكنك إضافة وكيل معتمد وتوصيل المفتاح والتجديد التلقائي. يتم الدفع عبر صفحة الدفع الآمنة لبريد الإمارات داخل المحادثة، ويُؤكَّد رقم الصندوق والإيصال مباشرة بعدها.

باقات صندوق البريد الشخصي. MyBox: تستلم بريدك من الفرع الذي يوجد فيه الصندوق. MyHome: يُوصَّل بريدك إلى عنوان منزلك في الإمارة المسجّل فيها الصندوق، ويأتي المفتاح مع الصندوق. MyHome Instant: خدمة التوصيل المميزة بتوصيل أسرع. سعر كل باقة الحالي وما تتضمنه يأتيان من نظام بريد الإمارات المباشر ويظهران على بطاقات الباقات عند الاختيار — لا تذكر المساعدة سعراً من الذاكرة أبداً.

استئجار صندوق بريد للشركات: ما المطلوب. يسجّل مالك الشركة الدخول بـ UAE PASS؛ ثم جهة إصدار الرخصة التجارية (ورقم الرخصة إذا لم يُعثر على الشركة تلقائياً)، والموقع المفضّل، والباقة — Basic أو Premium أو Premium Plus — والمدة، سنة أو سنتين. تُتحقَّق بيانات الشركة تلقائياً من الرخصة؛ وإذا تعذّرت المطابقة تُرفع نسخة من الرخصة التجارية في المحادثة وتُدقَّق يدوياً. قبل الدفع يمكنك إضافة وكيل معتمد، وربط رخصة تجارية إضافية، وطلب توصيل المفتاح، وتفعيل التجديد التلقائي.

تجديد صندوق البريد الشخصي. عند تسجيل الدخول بـ UAE PASS تظهر صناديقك مع زر «تجديد»: ضغطة واحدة تجدد الصندوق لسنة إضافية بنفس الباقة والخيارات وتفتح صفحة الدفع — ادفع ببطاقتك على صفحة بريد الإمارات، أو عبر نقودي (UAE Pay) هنا في المحادثة. من دون تسجيل دخول، اذكر رقم الصندوق والإمارة، وأكّد الاسم المُقنَّع لصاحب الصندوق المسجّل، ووافق على الشروط وادفع بالبطاقة؛ لا يُطلب شيء آخر. يمكنك طلب مدة أطول أو باقة مختلفة أو وكيل معتمد أو توصيل المفتاح قبل الدفع.

تجديد صندوق بريد الشركات. يسجّل مالك الشركة الدخول بـ UAE PASS ويذكر رقم صندوق الشركة؛ تُسترجع بيانات الشركة والصندوق من بريد الإمارات فلا يُكتب شيء من جديد. تُحفظ الباقة الحالية ما لم تطلب الترقية، ويمكن ذلك قبل الدفع. يمكن إضافة وكيل معتمد أو رخصة تجارية إضافية أو توصيل المفتاح قبل إتمام التجديد، كما يمكن تفعيل التجديد التلقائي.

الوكيل المعتمد. الوكيل المعتمد شخص مسموح له باستلام بريد الصندوق نيابة عن صاحبه. أضفه عند الاستئجار أو التجديد، أو لاحقاً لصندوق لديك: تحتاج المساعدة إلى هوية الوكيل الإماراتية، الوجه والظهر، تُرفع في المحادثة وتُقرأ تلقائياً، وإلى رقم هاتفه المتحرك؛ ولا يمكن إضافة وكيل انتهت صلاحية هويته. الوكيل المعتمد الأول مشمول مع الصندوق دون رسوم إضافية؛ وأي وكيل آخر أو تعديل لاحق يخضع للرسوم التي يحددها بريد الإمارات في المحادثة قبل الدفع.

توصيل مفتاح صندوق البريد. بدلاً من استلام المفتاح من الفرع، يمكنك طلب توصيله بالبريد السريع مقابل 30 درهماً، ويُضاف قبل الدفع. صناديق MyHome وMyHome Instant يأتي مفتاحها معها، لذا لا يُعرض التوصيل لها. المبلغ المحصَّل هو دائماً ما يؤكده بريد الإمارات في المحادثة قبل الدفع.

التجديد التلقائي. يجدد التجديد التلقائي صندوق بريدك قبل انتهائه حتى لا تنقطع الخدمة، بالخصم من البطاقة المحفوظة في حسابك لدى بريد الإمارات. فعّله عند الاستئجار أو التجديد، أو في أي وقت لاحق بطلبه هنا وأنت مسجّل الدخول؛ وهو يحتاج إلى بطاقة محفوظة. ويمكنك إيقافه بالطريقة نفسها في أي وقت، وتؤكد المساعدة التغيير.

ربط صندوق بريد قائم. عند تسجيل الدخول بـ UAE PASS تظهر تلقائياً كل صناديق البريد المسجّلة بهويتك الإماراتية — لا توجد خطوة ربط منفصلة. ولصندوق الشركة يمكنك ربط رخصة تجارية إضافية عبر «إدارة صندوق بريدي».

الأسئلة التي لا تجيب عنها هذه الصفحة، والشكاوى، وطلبات الاتصال. إذا لم يكن الأمر مذكوراً هنا — طرق الدفع في كاونتر الفرع، نقل صندوق بين الفروع، مشكلة في بريدك — أخبر المساعدة: ترفع لك استفساراً داخل المحادثة وتعطيك رقماً مرجعياً يتابعه الفريق. ويمكنك أيضاً الاتصال ببريد الإمارات على 600 599 999. لن تُحال أبداً إلى موقع آخر أو نموذج لرفعه.`;

/**
 * The FAQ for an agent where Noqodi (UAE Pay) is switched off (2026-10-12):
 * the card is the one way to pay a renewal there, and a FAQ that names a
 * second way the chat then refuses would be worse than one that omits it.
 * Production is such an agent until Noqodi's production credentials land.
 */
export function faqFor(noqodi: boolean): { en: string; ar: string } {
  if (noqodi) return { en: EN, ar: AR };
  const en = EN.replace(" — pay with your card on Emirates Post's page, or with Noqodi (UAE Pay) here in the chat.", " — pay with your card on Emirates Post's page.");
  const ar = AR.replace(" — ادفع ببطاقتك على صفحة بريد الإمارات، أو عبر نقودي (UAE Pay) هنا في المحادثة.", " — ادفع ببطاقتك على صفحة بريد الإمارات.");
  if (/Noqodi|نقودي/.test(en + ar)) throw new Error("faqFor(false) still names Noqodi — the anchors drifted");
  return { en, ar };
}

/** Which way the agent is switched: the same test the one-tap script uses. */
function noqodiEnabled(def: Record<string, any>): boolean {
  const all = Array.isArray(def?.paymentMethods) ? def.paymentMethods : [];
  return all.some((m: any) => m?.key === "uaepay" && m?.enabled !== false);
}

async function main() {
  const [agent] = await getDb().select().from(agents).where(eq(agents.slug, "nxn-dialog"));
  if (!agent) throw new Error("nxn-dialog not found in this database");
  const noqodi = noqodiEnabled(agent.definition as Record<string, any>);
  const text = faqFor(noqodi);
  console.log(`  Noqodi (UAE Pay) is ${noqodi ? "ON" : "OFF"} for this agent — the FAQ ${noqodi ? "names it beside the card" : "names the card alone"}.`);
  const existing = await listKbDocuments(agent.id);
  for (const [title, content, locale] of [
    [EN_TITLE, text.en, "en"],
    [AR_TITLE, text.ar, "ar"],
  ] as const) {
    const doc = existing.find((d) => d.title === title);
    if (!doc) {
      const made = await createKbDocument({ agentId: agent.id, title, content, source: SOURCE, locale, status: "published" });
      console.log(`  + ${title} — ${made.chunks} chunk(s), embedded: ${made.embedded}`);
      continue;
    }
    // Already there: bring any paragraph that moved (a Noqodi switch, a fix)
    // up to date, matched on its opening words. The rest is left as it is.
    const rows = await getDb().select({ id: kbChunks.id, content: kbChunks.content }).from(kbChunks).where(eq(kbChunks.documentId, doc.id));
    let updated = 0;
    for (const para of content.split(/\n\s*\n/).filter(Boolean)) {
      const head = para.slice(0, 40);
      const row = rows.find((r) => r.content.startsWith(head));
      if (!row || row.content === para) continue;
      await getDb().update(kbChunks).set({ content: para }).where(eq(kbChunks.id, row.id));
      updated++;
    }
    console.log(updated ? `  ~ ${title} — ${updated} paragraph(s) updated` : `  (already) ${title}`);
  }
  // The labels under the replies read as Emirates Post's, not the project's.
  let relabelled = 0;
  for (const d of await listKbDocuments(agent.id)) {
    const to = customerSource(String(d.source ?? ""));
    if (to === d.source) continue;
    await getDb().update(kbDocuments).set({ source: to }).where(eq(kbDocuments.id, d.id));
    const rows = await getDb().select({ id: kbChunks.id, metadata: kbChunks.metadata }).from(kbChunks).where(eq(kbChunks.documentId, d.id));
    for (const r of rows) await getDb().update(kbChunks).set({ metadata: { ...((r.metadata as Record<string, unknown>) ?? {}), source: to } }).where(eq(kbChunks.id, r.id));
    console.log(`  ~ source "${d.source}" → "${to}" (${rows.length} chunk(s))`);
    relabelled++;
  }
  if (!relabelled) console.log("  (sources already read as Emirates Post's)");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
