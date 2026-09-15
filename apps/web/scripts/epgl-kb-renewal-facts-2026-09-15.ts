/**
 * What a renewal actually asks of you, in the store that answers questions.
 *
 * Asked cold on 15 September — "for a renewal, what do I have to agree to at the
 * end, and whose name and email do you need, mine or my accountant's?" — the
 * assistant answered from the knowledge base and got the second half wrong:
 * "your accountant's details have no place on the application itself."
 *
 * They are required. EPGL's renewal needs a Contact whose designation contains
 * "Accountant", alongside the quarterly leviable-income figures, and the
 * journey collects the accountant's name, email and phone for exactly that. A
 * customer told otherwise arrives without them.
 *
 * The acknowledgements were vague for the same reason: the KB knows there is an
 * "acknowledgement and pledge form" and not that a renewal carries three
 * separate ticks.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/epgl-kb-renewal-facts-2026-09-15.ts --env <file> [--apply]
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

const ADDITIONS: { docTitle: string; marker: string; content: string }[] = [
  {
    docTitle: "Renewal process",
    marker: "Who do you need contact details for on a renewal",
    content:
      "Who do you need contact details for on a renewal, and what do I agree to at the end? TWO people, and they are usually not the same person. " +
      "The APPLICANT is whoever is making the application — their name, email and phone go on the licence request, and if they sign in with UAE PASS the name and email are taken from that and only need confirming. " +
      "The ACCOUNTANT is required as well: EPGL need an accountant contact on every renewal, with a name, an email and ideally a phone number, because the renewal carries the quarterly leviable-income figures and the accountant is who EPGL go back to about them. Have those details ready before you start. " +
      "At the end you tick FOUR things, each separately, in the chat — no printing, no signature, no upload: the Declaration & Undertaking, EPGL's postal licensing terms and conditions, the approved commitment form, and the mandatory integration with IDEP. The renewal cannot be submitted until all four are ticked, and the moment you accept each one is recorded with it.",
  },
  {
    docTitle: "عملية التجديد",
    marker: "بيانات من تحتاجون عند التجديد",
    content:
      "بيانات من تحتاجون عند التجديد، وما الذي أوافق عليه في النهاية؟ شخصان، وغالباً ليسا الشخص نفسه. " +
      "مقدّم الطلب هو من يقوم بالتقديم — اسمه وبريده الإلكتروني ورقم هاتفه تُسجَّل على طلب الترخيص، وإذا سجّل الدخول عبر الهوية الرقمية UAE PASS يُؤخذ الاسم والبريد من هناك ويُكتفى بتأكيدهما. " +
      "أما المحاسب فمطلوب أيضاً: تشترط مجموعة بريد الإمارات وجود جهة اتصال محاسب في كل تجديد، بالاسم والبريد الإلكتروني ورقم الهاتف إن أمكن، لأن التجديد يتضمن أرقام الدخل الخاضع للرسوم الربع سنوية والمحاسب هو من يُرجَع إليه بشأنها. يُستحسن تجهيز هذه البيانات قبل البدء. " +
      "وفي النهاية توافق على أربعة بنود، كلٌّ على حدة داخل المحادثة — دون طباعة أو توقيع أو رفع مستند: الإقرار والتعهد، وشروط وأحكام الترخيص البريدي، ونموذج التعهد المعتمد، والتكامل الإلزامي مع نظام IDEP. ولا يمكن تقديم التجديد قبل الموافقة على الأربعة جميعاً، ويُسجَّل وقت كل موافقة معها.",
  },
];

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrlFrom(ENV!) });
  const db = drizzle(pool, { schema: { agents, kbChunks, kbDocuments } });
  const changes: string[] = [];
  try {
    const [agent] = await db.select().from(agents).where(eq(agents.slug, "epgl-dialog"));
    if (!agent) throw new Error("epgl-dialog not found in this database");
    const docs = await db.select().from(kbDocuments).where(eq(kbDocuments.agentId, agent.id));
    const chunks = await db.select().from(kbChunks).where(eq(kbChunks.agentId, agent.id));

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
    for (const c of changes) console.log(`   ~ ${c}`);
    console.log(APPLY ? "\nwritten." : "\nDry run — nothing written. Add --apply to write.");
  } finally {
    await pool.end();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
