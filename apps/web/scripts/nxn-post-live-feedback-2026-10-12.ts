/**
 * Post Live Feedback Round, NXN — FB-1803 and FB-1831 (2026-10-12).
 *
 * FB-1803 (P1): "Make sure the inquiry within the experience is active, no
 * sending to another website to raise a case." Since 9 September the persona
 * and every journey's guidance sent a customer who wanted a callback, a
 * complaint or an answer we did not have to Emirates Post's enquiry page. That
 * paragraph and that sentence now say the opposite: the enquiry is taken in
 * the chat with request_escalation (which records it and hands back a
 * reference — lib/registry.ts), and no link is written. The knowledge-base
 * chunks that quoted the page say the same.
 *
 * FB-1831 (P1): "a ready prompt ... include all required details to be
 * submitted once so the customer can submit & pay directly within two steps."
 * The greeting now introduces Mira and offers the four services as buttons, and
 * a ready prompt sits under it: "Renew my PO Box [number] in [emirate] for one
 * more year, same bundle and options." Tapped, it fills the composer (not sent);
 * the one message the customer sends is the opener the server already turns
 * into summary + pay button — two steps for a guest, one reply when signed in.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/nxn-post-live-feedback-2026-10-12.ts --env <file> [--dry-run]
 */
import { pathToFileURL } from "node:url";
import dns from "node:dns/promises";
import pg from "pg";
import { databaseUrlFrom } from "./lib/envFile";

export const SLUG = "nxn-dialog";

export const ENQUIRY_MARKER = "ENQUIRIES, COMPLAINTS AND CALLBACKS ARE TAKEN HERE (FB-1803, 2026-10-12)";
export const PERSONA_ENQUIRIES =
  `${ENQUIRY_MARKER} — never send the customer to another website, page or form to raise a case, and never write the raise-an-enquiry link. ` +
  `When they ask for a callback, to speak to someone, to complain, or ask something the knowledge base does not answer, take it in the chat: first try once to answer or fix it yourself (most "I want to speak to someone" comes after something went wrong that you can still fix); ` +
  `then ask in ONE message for what you still need — what it is about, in their words; their name and mobile number unless they are signed in and you already have them; the box number if it concerns a box — and call request_escalation with it. ` +
  `Give them the reference it returns and say the team will contact them. If that call fails, say so plainly and offer to try again or the phone line 600 599 999 — still never a link to a form.`;

export const GREETING_BUTTONS_MARKER = "THE GREETING BUTTONS (FB-1831, 2026-10-12)";
export const PERSONA_GREETING_BUTTONS =
  `${GREETING_BUTTONS_MARKER}: the greeting offers "Rent a new PO Box", "Renew my PO Box", "Manage my PO Box" and "Ask a question". ` +
  `"Renew my PO Box" from a signed-in customer: show their boxes with the Renew pill, as the account rules say. From a guest: ask in ONE message for the box number and the emirate, saying that one more year on the same bundle and options is the default, and once they answer continue exactly as for the one-tap opener ("Renew my PO Box <number> in <emirate> for one more year, same bundle and options") — identity line, summary, Terms and the pay button, nothing else. ` +
  `"Ask a question": answer from the knowledge base; what it does not cover is raised as an enquiry here, never a link.`;

/** The 9 September paragraph, from its heading to its last sentence. */
const OLD_PERSONA_START = "CALLBACKS AND ENQUIRIES —";
const OLD_PERSONA_ENDS = ["that you can still fix.", "the team replies from there."];

export const JOURNEY_OLD =
  "THE ENQUIRY LINK (2026-09-09): when you offer to raise an enquiry, the link is https://www.emiratespost.ae/contact-us/raise-an-enquiry in English and https://www.emiratespost.ae/ar/contact-us/raise-an-enquiry in Arabic. Use the Arabic one whenever the conversation is in Arabic.";
export const JOURNEY_NEW =
  "RAISING AN ENQUIRY (FB-1803, 2026-10-12): an enquiry, a complaint or a callback is raised IN THE CHAT with request_escalation and answered with its reference — never a link to a website, page or form, in either language.";

const ENQUIRY_URL = /https:\/\/www\.emiratespost\.ae\/(?:ar\/)?contact-us\/raise-an-enquiry\/?/g;

export const GREETING = {
  en:
    "Hello, I'm Mira — Emirates Post's assistant. I can rent or renew a PO Box for you, manage one you already have, or answer a question.\n\n" +
    "```buttons\n- Rent a new PO Box\n- Renew my PO Box\n- Manage my PO Box\n- Ask a question\n```",
  ar:
    "مرحباً، أنا ميره — مساعدة بريد الإمارات. يمكنني استئجار صندوق بريد أو تجديده لك، أو إدارة صندوق لديك بالفعل، أو الإجابة عن سؤالك.\n\n" +
    "```buttons\n- استئجار صندوق بريد جديد\n- تجديد صندوق بريدي\n- إدارة صندوق بريدي\n- طرح سؤال\n```",
};

/** Tapped, it fills the composer; sent, it is the one-tap opener the server recognises. */
export const READY_PROMPTS = [
  {
    label: { en: "Renew in two steps", ar: "جدّد في خطوتين" },
    prompt: {
      en: "Renew my PO Box [number] in [emirate] for one more year, same bundle and options.",
      ar: "جدّد صندوق البريد [الرقم] في [الإمارة] لسنة إضافية بنفس الباقة والخيارات.",
    },
  },
];

type Def = Record<string, any>;

/** JSON with object keys sorted, so two renderings of one value compare equal. */
function stable(v: unknown): string {
  return JSON.stringify(v, (_k, val) => (val && typeof val === "object" && !Array.isArray(val) ? Object.fromEntries(Object.keys(val).sort().map((k) => [k, (val as Record<string, unknown>)[k]])) : val));
}

export function applyFeedback(input: Def): { def: Def; changes: string[] } {
  const def = JSON.parse(JSON.stringify(input)) as Def;
  const changes: string[] = [];

  // 1. The persona: the enquiry paragraph, replaced; the greeting buttons, added.
  let persona = String(def.persona ?? "");
  if (!persona.includes(ENQUIRY_MARKER)) {
    const start = persona.indexOf(OLD_PERSONA_START);
    let replaced = false;
    if (start !== -1) {
      for (const end of OLD_PERSONA_ENDS) {
        const at = persona.indexOf(end, start);
        if (at !== -1 && at - start < 900) {
          persona = persona.slice(0, start) + PERSONA_ENQUIRIES + persona.slice(at + end.length);
          replaced = true;
          break;
        }
      }
    }
    if (!replaced) persona = `${persona.trimEnd()}\n\n${PERSONA_ENQUIRIES}`;
    changes.push(replaced ? "persona: enquiry paragraph replaced" : "persona: enquiry paragraph added");
  }
  if (!persona.includes(GREETING_BUTTONS_MARKER)) {
    persona = `${persona.trimEnd()}\n\n${PERSONA_GREETING_BUTTONS}`;
    changes.push("persona: greeting-button paragraph added");
  }
  // Any other enquiry link left in the persona becomes the in-chat sentence.
  const personaLinks = (persona.match(ENQUIRY_URL) ?? []).length;
  if (personaLinks) {
    persona = persona.replace(/\[[^\]\n]{1,80}\]\(\s*https:\/\/www\.emiratespost\.ae\/(?:ar\/)?contact-us\/raise-an-enquiry\/?\s*\)/g, "request_escalation (in the chat)").replace(ENQUIRY_URL, "request_escalation (in the chat)");
    changes.push(`persona: ${personaLinks} stray enquiry link(s) removed`);
  }
  if (persona !== String(def.persona ?? "")) def.persona = persona;

  // 2. Every journey's guidance.
  for (const j of def.journeys ?? []) {
    const before = String(j.guidance ?? "");
    let after = before.split(JOURNEY_OLD).join(JOURNEY_NEW);
    const left = (after.match(ENQUIRY_URL) ?? []).length;
    if (left) after = after.replace(ENQUIRY_URL, "request_escalation (in the chat)");
    if (after !== before) {
      j.guidance = after;
      changes.push(`${j.key}.guidance: enquiry sentence rewritten${left ? ` (+${left} stray link)` : ""}`);
    }
  }

  // 3. The greeting, and the ready prompt under it.
  for (const loc of ["en", "ar"] as const) {
    if (def.greeting?.[loc] !== GREETING[loc]) {
      def.greeting = { ...(def.greeting ?? {}), [loc]: GREETING[loc] };
      changes.push(`greeting.${loc}: Mira + service buttons`);
    }
  }
  // jsonb returns keys in its own order, so compare on a sorted rendering.
  if (stable(def.readyPrompts ?? null) !== stable(READY_PROMPTS)) {
    def.readyPrompts = READY_PROMPTS;
    changes.push("readyPrompts: the two-step renewal prompt");
  }
  return { def, changes };
}

/**
 * Knowledge-base chunks that quoted the enquiry page — and the one corporate
 * chunk (28 July) that still priced key delivery at AED 25. The fee is AED 30,
 * confirmed from GetChargesForAdditionalServices on 1 September and corrected
 * everywhere else then; this chunk was missed, and on 12 October an Arabic
 * answer quoted both figures side by side.
 */
export function rewriteChunk(content: string, locale: string): string {
  let next = content
    .replace("Optional key delivery by courier costs AED 25, disclosed before", "Optional key delivery by courier costs AED 30 (the figure Emirates Post's live charge confirms before payment), disclosed before")
    .replace("توصيل المفتاح الاختياري بالمندوب رسومه 25 درهماً، وتُعرض قبل", "توصيل المفتاح الاختياري بالمندوب رسومه 30 درهماً (وهو الرقم الذي يؤكده نظام بريد الإمارات قبل الدفع)، وتُعرض قبل")
    .replace(/raise an enquiry at https:\/\/www\.emiratespost\.ae\/contact-us\/raise-an-enquiry\/?/g, "ask the assistant to raise an enquiry for you here in the chat")
    .replace(/رفع استفسار عبر https:\/\/www\.emiratespost\.ae\/ar\/contact-us\/raise-an-enquiry\/?/g, "أن تطلب من المساعد رفع استفسار لك هنا في المحادثة");
  next = next.replace(ENQUIRY_URL, locale === "ar" ? "المحادثة (اطلب من المساعد رفع استفسار)" : "the chat (ask the assistant to raise an enquiry)");
  return next;
}

async function poolFor(url: string): Promise<pg.Pool> {
  const u = new URL(url);
  let host = u.hostname;
  try { dns.setServers(["1.1.1.1", "8.8.8.8"]); host = (await dns.resolve4(u.hostname))[0] ?? host; } catch { /* hostname */ }
  return new pg.Pool({ host, port: Number(u.port || 5432), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: u.pathname.slice(1), ssl: { servername: u.hostname, rejectUnauthorized: false } });
}

async function main() {
  const arg = (n: string) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : undefined; };
  const ENV = arg("--env"); if (!ENV) throw new Error("--env <envfile> is required");
  const DRY = process.argv.includes("--dry-run");
  const pool = await poolFor(databaseUrlFrom(ENV));
  try {
    const { rows } = await pool.query(`select id, definition from agents where slug = $1`, [SLUG]);
    if (!rows.length) throw new Error(`No agent ${SLUG} in this database`);
    const { def, changes } = applyFeedback(rows[0].definition as Def);
    console.log(`\n${SLUG} — post-live feedback (FB-1803, FB-1831)`);
    for (const c of changes) console.log(`  ~ ${c}`);
    let total = changes.length;
    if (changes.length && !DRY) await pool.query(`update agents set definition = $1::jsonb where id = $2`, [JSON.stringify(def), rows[0].id]);

    const kb = await pool.query(
      `select c.id, c.content, d.locale, d.title from kb_chunks c join kb_documents d on d.id = c.document_id where c.agent_id = $1 and (c.content like '%raise-an-enquiry%' or c.content ~ 'AED 25|25 درهم')`,
      [rows[0].id]
    );
    for (const c of kb.rows) {
      const next = rewriteChunk(c.content, c.locale);
      if (next === c.content) continue;
      total++;
      console.log(`  ~ kb: ${c.title} [${c.locale}]`);
      if (!DRY) await pool.query(`update kb_chunks set content = $1 where id = $2`, [next, c.id]);
    }
    if (!total) { console.log("\nAlready applied — nothing to change."); return; }
    console.log(DRY ? `\n--dry-run: ${total} change(s) NOT written.` : `\n${total} change(s) written.`);
  } finally { await pool.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(() => process.exit(0)).catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
}
