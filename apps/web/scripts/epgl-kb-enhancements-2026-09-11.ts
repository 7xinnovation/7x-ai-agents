/**
 * The same eight enhancements, in the knowledge base.
 *
 * WHY THIS EXISTS AND IS SEPARATE. The journey guidance is what the assistant
 * follows while it is taking an application. The knowledge base is what it
 * answers QUESTIONS from, and a question does not start a journey — so after the
 * guidance was updated, asking the staging agent "how long does it take?" still
 * got "typically within 2 business days", "do I need an MOA for a sole
 * establishment?" got "the guidance does not carve out an exemption — shall I
 * arrange a callback?", and "my partner lives in Ghana with no Emirates ID" got
 * a callback offer too. Three of EPGL's eight items, answered wrongly by a
 * store nobody had thought to change. Measured on staging, not assumed.
 *
 * Staging has no VOYAGE_API_KEY, so these chunks carry no embeddings and are
 * retrieved by full-text search. Editing the text is therefore sufficient and
 * complete; if embeddings are ever switched on, this content needs re-embedding
 * with everything else.
 *
 * NOT CHANGED, deliberately: the fee. Six chunks say AED 100,000 and production
 * charges 150,000. That is EPGL's published figure against EPGL's live gateway
 * and one of them is out of date — but which one is their call to make, not a
 * thing to quietly rewrite in their own FAQ.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/epgl-kb-enhancements-2026-09-11.ts --env <file> [--apply]
 */
import { databaseUrlFrom } from "./lib/envFile";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const ENV = arg("--env");
const APPLY = process.argv.includes("--apply");
if (!ENV) throw new Error("--env <envfile> is required");

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { agents, kbChunks, kbDocuments } from "@dialog/db";
import { eq } from "drizzle-orm";

const SLUG = "epgl-dialog";

/** Straight text substitutions, applied to whichever chunk holds them. */
const EDITS: [string, string][] = [
  // 1 — one business day.
  ["typically within 2 business days", "typically within one business day"],
  ["(typically within 2 business days)", "(typically within one business day)"],
  ["خلال يومي عمل تقريباً", "خلال يوم عمل واحد تقريباً"],
  ["(خلال يومي عمل تقريباً)", "(خلال يوم عمل واحد تقريباً)"],

  // 6 — the service is the Postal Activity License.
  ["A new courier license application requires:", "A new Postal Activity License application requires:"],
  ["يتطلب طلب رخصة بريد سريع جديدة:", "يتطلب طلب رخصة نشاط بريدي جديدة:"],

  // 7 & 8 — who needs an Emirates ID, and who has no MOA.
  [
    "the Emirates ID of the authorized signatory, and shareholder details whose ownership percentages total 100%. A Memorandum of Association may be requested for certain company types.",
    "the Emirates ID of the authorized signatory, and shareholder details whose ownership percentages total 100%. " +
      "A partner who lives outside the UAE has no Emirates ID; their passport is used instead and no Emirates ID is asked for. " +
      "A Memorandum of Association is required for company types that have one — a sole establishment does not, because it has a single natural-person owner and no MOA is ever issued for it, so that step is skipped. " +
      "(A single-owner LLC is a different legal form and does have an MOA.)",
  ],
  [
    "والهوية الإماراتية للمفوّض بالتوقيع، وتفاصيل المساهمين بنسب ملكية مجموعها 100٪. وقد يُطلب عقد التأسيس لبعض أنواع الشركات.",
    "والهوية الإماراتية للمفوّض بالتوقيع، وتفاصيل المساهمين بنسب ملكية مجموعها 100٪. " +
      "أما الشريك المقيم خارج الدولة فلا يملك هوية إماراتية، ويُكتفى بجواز سفره ولا تُطلب منه الهوية. " +
      "ويُطلب عقد التأسيس لأنواع الشركات التي يصدر لها عقد تأسيس — أما المؤسسة الفردية فلا يصدر لها عقد تأسيس لأن مالكها شخص طبيعي واحد، ولذلك تُتخطى هذه الخطوة. " +
      "(الشركة ذات المسؤولية المحدودة بمالك واحد شكل قانوني مختلف ولها عقد تأسيس.)",
  ],
  [
    "Partners' passports.\nPartners' Emirates ID.",
    "Partners' passports.\nPartners' Emirates ID — for partners resident in the UAE. A non-resident partner has no Emirates ID and is not asked for one; their passport stands in its place.",
  ],
  [
    "Passport (for partners)\nEmirates ID (for partners)",
    "Passport (for partners)\nEmirates ID (for partners resident in the UAE — a non-resident partner has none and is not asked for one)",
  ],
];

/** Whole answers the knowledge base did not have at all. */
const ADDITIONS: { docTitle: string; marker: string; content: string }[] = [
  {
    docTitle: "Application FAQs: review timeline, payment, and next steps",
    marker: "Does the payment method change how quickly",
    content:
      "Does the payment method change how quickly the licence is issued? Yes, and it is worth knowing before you choose. " +
      "Paying by CARD through the secure online gateway means the licence is issued the SAME DAY, normally straight after the payment clears. " +
      "Paying by BANK TRANSFER to a Virtual IBAN means the licence is issued by the NEXT BUSINESS DAY: EPGL Finance email you the IBAN, you transfer the fee, and the licence follows once the transfer is confirmed. " +
      "Both options are offered in the chat before the application is submitted, and the choice has to be made then — Finance are notified the moment it is submitted.",
  },
  {
    docTitle: "الأسئلة الشائعة عن الطلب: مدة المراجعة والدفع والخطوات التالية",
    marker: "هل تؤثر طريقة الدفع",
    content:
      "هل تؤثر طريقة الدفع في سرعة إصدار الرخصة؟ نعم، ومن المفيد معرفة ذلك قبل الاختيار. " +
      "الدفع بالبطاقة عبر البوابة الآمنة يعني إصدار الرخصة في نفس اليوم، عادةً مباشرة بعد اكتمال الدفع. " +
      "أما التحويل البنكي إلى آيبان افتراضي فتصدر الرخصة في يوم العمل التالي: يرسل قسم المالية في EPGL الآيبان بالبريد الإلكتروني، ثم تحوّل الرسوم، وتصدر الرخصة بعد تأكيد وصول التحويل. " +
      "يُعرض الخياران في المحادثة قبل تقديم الطلب، ويجب الاختيار عندها — إذ يُبلَّغ قسم المالية فور تقديم الطلب.",
  },
];

/** 6 — the document titles a customer sees cited. */
const TITLES: [string, string][] = [
  ["Courier license eligibility", "Postal Activity License eligibility"],
  ["Required documents for a new courier license", "Required documents for a new Postal Activity License"],
  ["أهلية رخصة البريد السريع", "أهلية رخصة النشاط البريدي"],
  ["المستندات المطلوبة لرخصة بريد سريع جديدة", "المستندات المطلوبة لرخصة نشاط بريدي جديدة"],
];

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrlFrom(ENV!) });
  const db = drizzle(pool, { schema: { agents, kbChunks, kbDocuments } });
  const changes: string[] = [];
  try {
    const [agent] = await db.select().from(agents).where(eq(agents.slug, SLUG));
    if (!agent) throw new Error(`${SLUG} not found in this database`);
    const docs = await db.select().from(kbDocuments).where(eq(kbDocuments.agentId, agent.id));
    const chunks = await db.select().from(kbChunks).where(eq(kbChunks.agentId, agent.id));

    // Text edits.
    for (const row of chunks) {
      let next = row.content;
      for (const [from, to] of EDITS) if (next.includes(from)) next = next.split(from).join(to);
      if (next === row.content) continue;
      changes.push(`chunk ${row.id.slice(0, 8)} (${row.content.slice(0, 46).replace(/\s+/g, " ")}…)`);
      if (APPLY) await db.update(kbChunks).set({ content: next }).where(eq(kbChunks.id, row.id));
    }

    // New answers.
    for (const add of ADDITIONS) {
      const doc = docs.find((d) => d.title === add.docTitle);
      if (!doc) { console.log(`   ! no KB document titled "${add.docTitle}" — skipped`); continue; }
      if (chunks.some((c) => c.documentId === doc.id && c.content.includes(add.marker))) continue;
      changes.push(`+ chunk in "${add.docTitle}"`);
      if (APPLY) {
        await db.insert(kbChunks).values({
          agentId: agent.id,
          documentId: doc.id,
          content: add.content,
          embedding: null,
          metadata: { source: doc.source ?? doc.title, title: doc.title },
        });
      }
    }

    // Titles, on the document and in every chunk's metadata.
    for (const [from, to] of TITLES) {
      const doc = docs.find((d) => d.title === from);
      if (!doc) continue;
      changes.push(`title "${from}" -> "${to}"`);
      if (APPLY) {
        await db.update(kbDocuments).set({ title: to }).where(eq(kbDocuments.id, doc.id));
        for (const c of chunks.filter((x) => x.documentId === doc.id)) {
          const md = { ...(c.metadata as Record<string, unknown>) };
          if (md.title === from) md.title = to;
          if (md.source === from) md.source = to;
          await db.update(kbChunks).set({ metadata: md }).where(eq(kbChunks.id, c.id));
        }
      }
    }

    if (!changes.length) { console.log("nothing to do — already applied."); return; }
    console.log(`${changes.length} change(s):`);
    for (const c of changes) console.log(`   ~ ${c}`);
    console.log(APPLY ? "\nwritten." : "\nDry run — nothing written. Add --apply to write.");
  } finally {
    await pool.end();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
