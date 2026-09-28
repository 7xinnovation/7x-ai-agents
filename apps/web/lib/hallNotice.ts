/**
 * A P.O. Box hall's limitations are ACCEPTED, not merely shown (2026-09-28).
 *
 * Reported against Emirates Post: choosing a branch that is a hall/complex
 * showed the service-limitations notice, and the customer typed "Proceed" and
 * carried straight on to pick a box. Nothing was blocking. Their own website and
 * app put the same words in a modal with a mandatory checkbox — nothing moves
 * until it is ticked — so the agent was the one channel where a customer could
 * buy a box at a room-of-boxes without ever agreeing that the key is issued
 * somewhere else.
 *
 * Two things were wrong and they are separate:
 *
 *   WHEN — the notice arrived alongside the box numbers, so the choice was
 *          already made by the time the limitation was read. It now arrives on
 *          the turn the branch is chosen, because the box lookup for a hall is
 *          REFUSED until the acceptance is on record (see integrations.ts).
 *
 *   WHETHER — acceptance was a button the model offered and nothing checked.
 *          It is now written into the case, by us, off the customer's own words,
 *          and the notice comes back on every reply until it is.
 *
 * Acceptance is deliberately narrow. "Proceed", "continue", "ok", "yes" are NOT
 * acceptance — they are exactly what was typed when this was reported, and a
 * checkbox does not tick itself because someone reached for the next button.
 * Only words that accept — accept, agree, acknowledge, أوافق — count.
 */
import { poBoxHallNotice } from "./branchList";

/** The hall the customer chose, pending their acceptance. */
export const HALL_PENDING_KEY = "__hall_limitations_pending";
/** When they accepted it, and what they were accepting. */
export const HALL_ACCEPTED_KEY = "__hall_limitations_accepted";

export interface HallRef {
  officeId?: string;
  name: string;
  alternative: string;
  nameAr?: string;
  alternativeAr?: string;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : "");

export function pendingHall(data: Record<string, unknown> | undefined): HallRef | null {
  const raw = data?.[HALL_PENDING_KEY];
  if (!raw || typeof raw !== "object") return null;
  const h = raw as Record<string, unknown>;
  const name = str(h.name);
  if (!name) return null;
  return {
    officeId: str(h.officeId) || undefined,
    name,
    alternative: str(h.alternative),
    nameAr: str(h.nameAr) || undefined,
    alternativeAr: str(h.alternativeAr) || undefined,
  };
}

/** The ISO timestamp of the customer's acceptance, or null if they have not. */
export function hallAccepted(data: Record<string, unknown> | undefined): string | null {
  const raw = data?.[HALL_ACCEPTED_KEY];
  if (typeof raw === "string") return str(raw) || null;
  if (raw && typeof raw === "object") return str((raw as Record<string, unknown>).at) || null;
  return null;
}

/**
 * Has THIS hall been accepted?
 *
 * Scoped to the branch, not to the conversation. Accepting the limitations of
 * one hall says nothing about another: the text is the same but the branch the
 * key is actually issued at is not, and that is the part the customer is being
 * asked to agree to. A customer who accepts Al Quoz Mall and then changes to a
 * different hall is asked again, exactly as the website would ask again.
 */
export function hallAcceptedFor(data: Record<string, unknown> | undefined, officeId?: string): boolean {
  const raw = data?.[HALL_ACCEPTED_KEY];
  if (!raw) return false;
  if (typeof raw === "string") return Boolean(str(raw));
  if (typeof raw !== "object") return false;
  const rec = raw as Record<string, unknown>;
  if (!str(rec.at)) return false;
  const accepted = str(rec.officeId);
  // No id on either side is the older, unscoped record — honour it rather than
  // asking a customer to accept a second time for want of a field.
  if (!officeId || !accepted) return true;
  return accepted === officeId;
}

/**
 * Arabic is written with more than one alef and with optional diacritics, and a
 * customer typing "اوافق" means what the button says as "أوافق". Compared
 * without either, the way the rest of this file compares case.
 */
function normalise(message: string): string {
  return String(message ?? "")
    .toLowerCase()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/[ىي]/g, "ي")
    .replace(/[ةه]/g, "ه")
    // Apostrophes go rather than become spaces, so "don't" reads as "dont" and
    // is caught by the refusal below — it was not, and "I don't agree" was read
    // as an acceptance because "agree" was in it.
    .replace(/['\u2019\u02bc`]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const REFUSES = /\b(not|dont|do not|wont|will not|cant|cannot|refuse|disagree|decline)\b|(^| )(لا|لن|ارفض|رفض|غير موافق)( |$)/u;
const ACCEPTS = /\b(accept|accepted|agree|agreed|acknowledge|acknowledged|consent)\b|(اوافق|موافق|موافقه|اقبل|قبلت|اتفق)/u;

/** Did they ACCEPT? Not "did they answer" — the two are not the same thing. */
export function readsAsAcceptance(message: string): boolean {
  const t = normalise(message);
  if (!t) return false;
  if (REFUSES.test(t)) return false;
  return ACCEPTS.test(t);
}

/** The other button: take me back, I want a different branch. */
export function readsAsAnotherBranch(message: string): boolean {
  const t = normalise(message);
  if (!t) return false;
  return (
    /\b(different|another|other|change)\b[\s\w]{0,12}\b(branch|location|office|post office)\b/.test(t) ||
    /\b(branch|location)\b[\s\w]{0,12}\b(different|another|else)\b/.test(t) ||
    /(فرع|موقع)\s*(اخر|ثاني|غيره)/.test(t) ||
    /اختيار فرع/.test(t)
  );
}

/**
 * A push past the notice with nothing accepted in it.
 *
 * This is the reported bug in one regex: the customer pressed nothing, typed
 * "Proceed", and the rental went on. Matched only when the WHOLE message is one
 * of these — "proceed, I accept" is an acceptance and is caught above first.
 */
export function readsAsBarePush(message: string): boolean {
  const t = normalise(message);
  if (!t) return false;
  return /^(ok|okay|k|yes|yeah|yep|yup|sure|fine|alright|right|good|proceed|continue|carry on|go|go on|go ahead|next|start|done|lets go|let s go|move on|nice)$/.test(t) ||
    /^(نعم|ايوه|اي|تمام|طيب|حسنا|تابع|متابعه|اكمل|كمل|استمر|استمرار|يلا|التالي)$/.test(t);
}

function ar(locale?: string): boolean {
  return locale === "ar";
}

function hallName(hall: HallRef, locale?: string): string {
  return (ar(locale) ? hall.nameAr || hall.name : hall.name) || "";
}

function altName(hall: HallRef, locale?: string): string {
  const v = ar(locale) ? hall.alternativeAr || hall.alternative : hall.alternative;
  return v || (ar(locale) ? "الفرع التشغيلي المخصص" : "the designated operational branch");
}

/**
 * The notice itself, as a quote block, in the customer's language.
 *
 * The words come from branchList.poBoxHallNotice — the same source the tool
 * guidance quotes — rather than being written out a second time here. Until
 * today the copy the customer actually saw was built inline in the chat route
 * and was ENGLISH ONLY, so an Arabic conversation met a wall of English at the
 * one moment something is being accepted.
 */
export function hallNoticeMarkdown(hall: HallRef, locale?: string): string {
  const full = poBoxHallNotice(altName(hall, locale), locale);
  const lines = full.split("\n").slice(1).map((l) => l.trim()).filter(Boolean);
  const title = ar(locale) ? "تنبيه مهم" : "Important Notice";
  const named = hallName(hall, locale);
  const head = named ? `> **${title}** — **${named}**` : `> **${title}**`;
  return `\n\n${head}\n` + lines.map((l) => `>\n> ${l}`).join("\n") + "\n";
}

/** The two answers. There is no third, and neither of them is "Proceed". */
export function hallButtons(locale?: string): string {
  return ar(locale)
    ? "\n\n```buttons\n- أوافق على هذه الشروط، تابع\n- اختيار فرع آخر\n```\n"
    : "\n\n```buttons\n- I accept these limitations, continue\n- Choose a different branch\n```\n";
}

export function hallNoticeBlock(hall: HallRef, locale?: string): string {
  return hallNoticeMarkdown(hall, locale) + hallButtons(locale);
}

/**
 * What the customer is told when they try to walk past it.
 *
 * Their own words back to them, then the notice again, then the two buttons —
 * the chat equivalent of a modal that will not close. It names what is being
 * asked for ("tap the button"), because a customer who typed "Proceed" once
 * will type it again if all they get is the same wall of text.
 */
export function mustAcceptReply(hall: HallRef, locale?: string): string {
  const lead = ar(locale)
    ? `لا يمكننا المتابعة مع ${hallName(hall, locale)} قبل أن تؤكد موافقتك على قيود الخدمة أدناه. اضغط على "أوافق على هذه الشروط، تابع" للمتابعة، أو اختر فرعاً آخر.`
    : `Before we can go on with ${hallName(hall, locale)}, you need to accept the service limitations below — the same confirmation Emirates Post asks for on the website and the app. Tap “I accept these limitations, continue”, or choose a different branch.`;
  return lead + hallNoticeBlock(hall, locale);
}

/**
 * What the model is told while acceptance is outstanding.
 *
 * The tool layer already refuses to look up boxes at an unaccepted hall, so this
 * is not the enforcement — it is there so the reply the customer reads agrees
 * with what the tools will allow, instead of promising a box the lookup will not
 * return.
 */
export function hallDirective(hall: HallRef, locale?: string): string {
  return (
    `\n\nP.O. BOX HALL — ACCEPTANCE OUTSTANDING. The customer has chosen ${hall.name}, which is a P.O. Box hall, and has NOT yet accepted its service limitations. ` +
    `The notice and its two buttons are appended to your reply automatically — do not write the notice out yourself, and do not invent a third option. ` +
    `Do not look up box numbers, reserve a box, quote a price or take this rental any further until they have accepted: the box lookup will refuse for this branch and you would be promising something you cannot deliver. ` +
    `Answer any question they ask about the limitation plainly, then leave the acceptance to them. ` +
    `"Proceed", "continue", "ok" and "yes" are NOT acceptance — only accepting the limitations is, and it is recorded for them, not by you.` +
    (locale === "ar" ? " Reply in Arabic." : "")
  );
}
