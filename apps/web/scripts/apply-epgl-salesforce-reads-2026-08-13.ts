/**
 * Puts the new Salesforce reads to work, and corrects the licence-delivery copy.
 *
 * 1. FB-1268 / FB-1269 — the agent now looks a company up instead of asking for
 *    it. Two tools exist (see apps/web/lib/epglRead.ts):
 *      epgl_company_lookup(tradeLicenseNumber) -> company + contacts + accountId
 *      epgl_form9_history(accountId)           -> quarterly Form 9 filings
 *    Form 9 is what IDEP files into Salesforce each quarter, so it carries the
 *    licence period and the leviable figures we were asking customers to type.
 *
 * 2. The "what happens next" copy said the licence is "issued and shared with
 *    the customer". Per EPGL (Fuad, 11 Aug) it is NOT sent in chat or by email —
 *    it appears in the EPGL portal and the customer gets an email notification
 *    pointing there. Corrected in both journeys and in the knowledge base,
 *    English and Arabic.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/apply-epgl-salesforce-reads-2026-08-13.ts
 *   prod: DATABASE_URL=<...> npx tsx scripts/apply-epgl-salesforce-reads-2026-08-13.ts
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import { getDb, agents, kbDocuments, kbChunks } from "@dialog/db";
import { eq } from "drizzle-orm";

const SLUG = "epgl-dialog";
const MARKER = "COMPANY DATA FROM SALESFORCE (2026-08-13):";

const LOOKUP_RULE =
  "- LOOK THE COMPANY UP, DO NOT INTERVIEW THE CUSTOMER: the moment you know the TRADE LICENCE NUMBER — they tell you, " +
  "or it is read off their uploaded licence — call epgl_company_lookup with it. If EPGL has the company, you get its " +
  "registered names (English and Arabic), trade licence number and expiry, emirate, regulator, postal licence number " +
  "and status, plus the contacts on file with their designations and Emirates ID. Record those with collect_field and " +
  "ask the customer only to CONFIRM them — never ask them to type a value the lookup returned. If it returns NO MATCH, " +
  "say nothing about lookups: just carry on collecting from them and their documents as you would have anyway.";

const AMBIGUITY_RULE =
  "- ONE LICENCE NUMBER CAN MATCH MORE THAN ONE COMPANY: a branch carries the same trade licence number as its parent. " +
  "When the lookup returns more than one, NEVER pick for them — show the names it returned and ask which is theirs, " +
  "then use only that one.";

const FORM9_RULE =
  "- THE QUARTERLY FIGURES ARE ALREADY FILED: on a renewal, call epgl_form9_history with the accountId from the lookup. " +
  "Each row is a quarter already filed with the regulator and carries its calendar quarter and year, the LICENCE PERIOD " +
  "start and end dates, and the leviable and non-leviable revenue. Use it: derive the reporting quarters from the " +
  "licence period instead of asking, pre-fill the leviable figures with collect_field, and present all of it in ONE " +
  "```summary block for the customer to confirm or correct. Only ask for a figure that is genuinely absent. If it " +
  "returns nothing on file, fall back to asking as before. Quarters are CALENDAR quarters (Q1 = Jan-Mar) — name each " +
  "one with its quarter and year exactly as the tool returned it, and never renumber them.";

const ACCOUNTANT_RULE =
  "- THE ACCOUNTANT MAY ALREADY BE ON FILE: the lookup's contacts carry designations. If one is an Accountant, offer " +
  "those details for confirmation rather than asking the customer to type the accountant's name, email and phone.";

const BLOCK = [MARKER, LOOKUP_RULE, AMBIGUITY_RULE, FORM9_RULE, ACCOUNTANT_RULE].join("\n");

/** Licence delivery: portal + email notification, never "shared with you". */
const DELIVERY_FIXES: { from: RegExp; to: string }[] = [
  {
    from: /3\) after payment, the license is issued and shared with the customer\./g,
    to: "3) after payment, the licence is issued and appears in the EPGL portal — the customer receives an email notification telling them it is there. It is NOT sent in this chat and NOT attached to an email.",
  },
  {
    from: /3\) the renewed license is issued after payment\./g,
    to: "3) after payment the renewed licence is issued and appears in the EPGL portal — the customer receives an email notification telling them it is there. It is NOT sent in this chat and NOT attached to an email.",
  },
];

const KB_FIXES: { from: RegExp; to: string }[] = [
  {
    from: /4\) the postal activity license is issued and shared with you\./g,
    to: "4) the postal activity licence is issued and appears in the EPGL portal — you receive an email notification telling you it is there (the licence itself is not emailed or sent in chat).",
  },
  {
    // The Arabic FAQ phrases it as "4) issuing the licence and sharing it with you".
    from: /4\) إصدار رخصة النشاط البريدي ومشاركتها معك\./g,
    to: "4) إصدار رخصة النشاط البريدي وظهورها في بوابة EPGL — ويصلك إشعار بالبريد الإلكتروني يفيد بتوفرها هناك (لا تُرسل الرخصة نفسها بالبريد الإلكتروني ولا عبر المحادثة).",
  },
];

interface Journey { key: string; guidance?: string; [k: string]: unknown }
interface Definition { journeys: Journey[]; [k: string]: unknown }

function withBlock(guidance: string): string {
  const idx = guidance.indexOf(MARKER);
  if (idx === -1) return `${guidance.trimEnd()}\n\n${BLOCK}`;
  const after = guidance.slice(idx + MARKER.length).split("\n");
  let end = 0;
  for (let i = 1; i < after.length; i++) {
    const line = after[i]!;
    if (line.trim() === "" || line.startsWith("- ")) { end = i; continue; }
    break;
  }
  const base = guidance.slice(0, idx).trimEnd();
  const tail = after.slice(end + 1).join("\n").trim();
  return [`${base}\n\n${BLOCK}`, tail].filter(Boolean).join("\n\n");
}

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`${SLUG} not found`);
  const def = row.definition as unknown as Definition;
  const changes: string[] = [];

  for (const journey of def.journeys) {
    if (!["new_license", "renewal"].includes(journey.key)) continue;
    let g = journey.guidance ?? "";

    for (const fix of DELIVERY_FIXES) {
      if (fix.from.test(g)) {
        g = g.replace(fix.from, fix.to);
        changes.push(`licence delivery copy corrected on "${journey.key}"`);
      }
    }
    const next = withBlock(g);
    if (next !== journey.guidance) {
      journey.guidance = next;
      changes.push(`Salesforce read rules on "${journey.key}"`);
    }
  }

  if (changes.length) {
    await db.update(agents).set({ definition: def as never, updatedAt: new Date() }).where(eq(agents.id, row.id));
  }

  // Knowledge base: the same claim lives in the FAQ answers, both languages.
  const docs = await db.select().from(kbDocuments).where(eq(kbDocuments.agentId, row.id));
  for (const d of docs) {
    const chunks = await db.select().from(kbChunks).where(eq(kbChunks.documentId, d.id));
    for (const c of chunks) {
      let content = c.content;
      for (const fix of KB_FIXES) if (fix.from.test(content)) content = content.replace(fix.from, fix.to);
      if (content !== c.content) {
        await db.update(kbChunks).set({ content }).where(eq(kbChunks.id, c.id));
        changes.push(`licence delivery copy corrected in KB: ${d.title}`);
      }
    }
  }

  if (!changes.length) {
    console.log("No changes — already applied.");
    return;
  }
  console.log(`Updated ${SLUG} (${changes.length} changes):`);
  for (const c of changes) console.log(`  - ${c}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

export {};
