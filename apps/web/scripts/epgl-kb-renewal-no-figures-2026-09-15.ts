/**
 * The knowledge base still describes the renewal we just stopped running.
 *
 * Asked cold, minutes after the journey changed — "what do I need to have ready
 * and what will you ask me for?" — the assistant answered from the KB and
 * listed a Trial Balance, and said EPGL contacts the accountant "about the
 * quarterly leviable-income figures". Neither is true of this renewal any more:
 * the Form 9 and everything printed on it are filed on EPGL's own platform, and
 * the journey asks for no revenue figures at all.
 *
 * TWO DIFFERENT KINDS OF WRONG, FIXED TWO DIFFERENT WAYS.
 *
 * The accountant chunk is OURS, written this morning, and its reason is now
 * false while its instruction is still right — EPGL do require an accountant
 * contact on every renewal. So that sentence is corrected in place.
 *
 * The requirements list is EPGL'S OWN published FAQ answer, and it is not ours
 * to rewrite: a Trial Balance genuinely is on their published list of renewal
 * requirements. What was missing is the distinction between what EPGL REQUIRE
 * of a renewal and what this assistant COLLECTS, so that is added rather than
 * substituted — and it is the specific answer to the question that was asked,
 * which is what retrieval will reach for.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/epgl-kb-renewal-no-figures-2026-09-15.ts --env <file> [--apply]
 */
import { databaseUrlFromArgs } from "./lib/envFile";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const ENV = arg("--env");
const APPLY = process.argv.includes("--apply");

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { agents, kbChunks, kbDocuments } from "@dialog/db";
import { eq } from "drizzle-orm";

/** Sentences already in the store that say something no longer true. */
const REWRITE: { find: string; replace: string }[] = [
  {
    find:
      "because the renewal carries the quarterly leviable-income figures and the accountant is who EPGL go back to about them",
    replace:
      "because EPGL go back to the accountant about the audited revenue behind the renewal. The renewal itself does NOT ask you for any revenue figures — no quarterly leviable income, no reporting quarters, no financial year. Those come from the Form 9 returns already filed on the EPGL platform",
  },
  {
    find:
      "لأن التجديد يتضمن أرقام الدخل الخاضع للرسوم الربع سنوية والمحاسب هو من يُرجَع إليه بشأنها",
    replace:
      "لأن مجموعة بريد الإمارات ترجع إلى المحاسب بشأن الإيرادات المدققة. أما التجديد نفسه فلا يطلب منك أي أرقام إيرادات — لا الدخل الخاضع للرسوم الربع سنوي ولا الأرباع المشمولة ولا السنة المالية. فهذه تؤخذ من إقرارات النموذج 9 المقدَّمة مسبقاً على منصة مجموعة بريد الإمارات",
  },
];

/** The question that was asked, answered about THIS assistant. */
const ADDITIONS: { docTitle: string; marker: string; content: string }[] = [
  {
    docTitle: "Renewal process",
    marker: "What will the assistant actually ask me for on a renewal",
    content:
      "What will the assistant actually ask me for on a renewal, and what do I upload? " +
      "UPLOADS, and they are the whole list: your current trade / postal licence; the audited financial statements for the latest fiscal year; and for every partner named on the licence, a passport copy — plus an Emirates ID for each partner who lives in the UAE (a non-resident partner has none and is never asked for one). " +
      "Optional, if you have them: the audit acknowledgement letter confirming the financial statements were submitted, the quarterly financial statement, and your lease contract. PDF, PNG or JPG, clear copies. " +
      "TYPED, not uploaded: your postal licence number, your own name, email and phone as the applicant, and the accountant's name, email and phone. " +
      "NO REVENUE FIGURES ARE ASKED FOR. There are no quarterly leviable-income questions, no reporting quarters and no financial year on a renewal here. " +
      "THE FORM 9 IS NOT UPLOADED HERE. It is the quarterly postal revenue return, filed on EPGL's own platform, and a renewal cannot be processed while returns are outstanding — but it is completed there, not in this chat, and the assistant cannot see whether yours are outstanding. " +
      "You must be SIGNED IN to renew. At the end you tick four acknowledgements in the chat. " +
      "Note that EPGL's published list of renewal REQUIREMENTS also names a Trial Balance for the licence period: that is part of the Form 9 reporting filed on the EPGL platform, and it is not collected in this conversation.",
  },
  {
    docTitle: "عملية التجديد",
    marker: "ما الذي سيطلبه المساعد فعلياً عند التجديد",
    content:
      "ما الذي سيطلبه المساعد فعلياً عند التجديد، وما المستندات التي أرفعها؟ " +
      "المستندات المطلوب رفعها، وهي القائمة كاملة: الرخصة التجارية / البريدية الحالية؛ والبيانات المالية المدققة لآخر سنة مالية؛ ولكل شريك مذكور في الرخصة صورة جواز السفر — بالإضافة إلى الهوية الإماراتية لكل شريك مقيم في الدولة (الشريك غير المقيم لا يملك هوية ولا تُطلب منه). " +
      "واختيارياً إن توفرت: خطاب إقرار التدقيق، والإقرار المالي الربع سنوي، وعقد الإيجار. بصيغة PDF أو PNG أو JPG، ونسخ واضحة. " +
      "أما ما يُكتب دون رفع: رقم الرخصة البريدية، واسمك وبريدك الإلكتروني ورقم هاتفك كمقدّم للطلب، واسم المحاسب وبريده ورقم هاتفه. " +
      "ولا تُطلب أي أرقام إيرادات: لا أسئلة عن الدخل الخاضع للرسوم الربع سنوي، ولا عن الأرباع المشمولة، ولا عن السنة المالية. " +
      "والنموذج 9 لا يُرفع هنا: فهو إقرار الإيرادات البريدية الربع سنوي، ويُقدَّم على منصة مجموعة بريد الإمارات نفسها، ولا يمكن إتمام التجديد مع وجود إقرارات متأخرة — لكنه يُستكمل هناك لا في هذه المحادثة، والمساعد لا يستطيع معرفة ما إذا كانت إقراراتك متأخرة. " +
      "ويجب تسجيل الدخول للتجديد. وفي النهاية توافق على أربعة بنود داخل المحادثة. " +
      "علماً بأن قائمة متطلبات التجديد المنشورة من مجموعة بريد الإمارات تذكر أيضاً ميزان المراجعة لفترة الرخصة: وهو جزء من تقارير النموذج 9 المقدَّمة على منصتها، ولا يُجمع في هذه المحادثة.",
  },
];

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrlFromArgs() });
  const db = drizzle(pool, { schema: { agents, kbChunks, kbDocuments } });
  const changes: string[] = [];
  try {
    const [agent] = await db.select().from(agents).where(eq(agents.slug, "epgl-dialog"));
    if (!agent) throw new Error("epgl-dialog not found in this database");
    const docs = await db.select().from(kbDocuments).where(eq(kbDocuments.agentId, agent.id));
    const chunks = await db.select().from(kbChunks).where(eq(kbChunks.agentId, agent.id));

    for (const r of REWRITE) {
      for (const c of chunks) {
        if (!c.content.includes(r.find)) continue;
        changes.push(`~ corrected "${r.find.slice(0, 48)}…"`);
        if (APPLY) {
          await db
            .update(kbChunks)
            // The embedding was computed from the old wording; clearing it has
            // the chunk re-embedded rather than retrieved on a stale vector.
            .set({ content: c.content.replace(r.find, r.replace), embedding: null })
            .where(eq(kbChunks.id, c.id));
        }
      }
    }

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

    if (!changes.length) { console.log("nothing to do — already applied."); return; }
    console.log(`${changes.length} change(s):`);
    for (const c of changes) console.log(`   ${c}`);
    console.log(APPLY ? "\nwritten." : "\nDry run — nothing written. Add --apply to write.");
  } finally {
    await pool.end();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
