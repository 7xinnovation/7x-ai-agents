/**
 * EPGL 2.0 new licence: the per-product steps the catalogue requires and the
 * conversation kept missing (tester round of 10 November 2026, BUG-185..201).
 *
 * Each is decided here from the case, and stated to the model for the turn it
 * applies to — the 78,000-character guidance block had most of it and the
 * model did otherwise.
 */
import { emptyCase, type CaseState } from "@dialog/config";

// ---------------------------------------------------------------------------
// BUG-197 / BUG-200: "are you an existing CEP licence holder?", and the number.
// ---------------------------------------------------------------------------

/**
 * The catalogue's `requiresCepLicence`: LOCKERS and OUTSOURCE are for CEP
 * licence holders. LOCKERS may instead be applied for together with a new CEP
 * licence; OUTSOURCE may not (fixtures/epgl-catalogue-2026-10-22.json).
 */
const REQUIRES_CEP = new Set(["LOCKERS", "OUTSOURCE"]);
export const requiresCepLicence = (code: string | null | undefined) => !!code && REQUIRES_CEP.has(code.trim().toUpperCase());

export const HOLDS_CEP_KEY = "holds_cep_licence";
export const CEP_NUMBER_KEY = "cep_licence_number";

export const CEP_HOLDER_LABELS = {
  yes: { en: "Yes, I hold a CEP licence", ar: "نعم، لدي ترخيص بريد سريع" },
  no: { en: "No, not yet", ar: "لا، ليس بعد" },
} as const;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, " ").trim();

/** Their answer to the holder question, or null when this message is not one. */
export function cepHolderAnswer(message: string | undefined): boolean | null {
  const m = norm(message ?? "");
  if (!m) return null;
  for (const l of [CEP_HOLDER_LABELS.yes.en, CEP_HOLDER_LABELS.yes.ar]) if (m === norm(l)) return true;
  for (const l of [CEP_HOLDER_LABELS.no.en, CEP_HOLDER_LABELS.no.ar]) if (m === norm(l)) return false;
  if (/^(yes|yeah|yep|i do|we do)\b|\b(already|i|we) (hold|have) (a |an |our )?cep\b/.test(m)) return true;
  if (/^(no|nope|not yet)\b|\b(don t|do not|dont) (hold|have)\b/.test(m)) return false;
  if (/^نعم/.test(m)) return true;
  if (/^لا/.test(m)) return false;
  return null;
}

/** A licence number in what they typed: a token with at least four digits. */
export function cepNumberFrom(message: string | undefined): string | null {
  const m = /\b([A-Za-z]{0,6}[-/ ]?\d[\dA-Za-z\-/]{3,24})\b/.exec(message ?? "");
  if (!m) return null;
  const v = m[1]!.trim();
  return (v.match(/\d/g) ?? []).length >= 4 ? v : null;
}

export interface CepStep {
  /** Fields to record on the case before the reply. */
  set: Record<string, unknown>;
  /** What this turn must do, or "" when the step is complete. */
  directive: string;
  /** True while the step still holds the journey: no upload offer yet. */
  blocking: boolean;
}

/**
 * The step, from the case and this message. Runs before the upload choice is
 * offered, so it is the FIRST thing asked once the permit is chosen.
 */
export function cepHolderStep(code: string, data: Record<string, unknown>, message: string | undefined, locale: "en" | "ar"): CepStep | null {
  if (!requiresCepLicence(code)) return null;
  const c = code.trim().toUpperCase();
  const yes = CEP_HOLDER_LABELS.yes[locale];
  const no = CEP_HOLDER_LABELS.no[locale];
  const askHolder =
    "\nTHIS TURN: before anything else — before any document and before asking how they want to upload — ask ONE question: whether " +
    "they already hold a CEP (courier, express and parcels) licence. Say in one short sentence why: this permit is for CEP licence " +
    `holders. End with exactly these buttons:\n\`\`\`buttons\n- ${yes}\n- ${no}\n\`\`\`\nNothing else is asked in this reply.`;
  const askNumber =
    "\nTHIS TURN: ask ONE question — their CEP licence number, as printed on their CEP licence. EPGL check it is active. No buttons, no " +
    "other question, no document request in this reply.";

  let holds = data[HOLDS_CEP_KEY];
  const set: Record<string, unknown> = {};
  if (typeof holds !== "boolean") {
    const ans = cepHolderAnswer(message);
    if (ans === null) return { set, directive: askHolder, blocking: true };
    holds = ans;
    set[HOLDS_CEP_KEY] = ans;
    if (!ans) {
      return {
        set,
        blocking: c === "OUTSOURCE",
        directive:
          c === "OUTSOURCE"
            ? "\nTHIS TURN: they do not hold a CEP licence. An Outsourcing permit can only be issued to a company that already holds one, so " +
              "this application cannot go ahead yet. Say so plainly and kindly in two sentences, and offer to start a CEP licence application " +
              "instead (they can apply for the permit once it is issued). Do not ask for any document."
            : "\nTHIS TURN: they do not hold a CEP licence yet. A Lockers and PUDO permit can still be applied for, together with a new CEP " +
              "licence application — say so in one sentence (they will also need to apply for the CEP licence), then carry on with this permit. " +
              "Do not ask for a CEP licence number.",
      };
    }
    const n = cepNumberFrom(message);
    if (!n) return { set, directive: askNumber, blocking: true };
    set[CEP_NUMBER_KEY] = n;
    return { set, directive: "", blocking: false };
  }
  if (holds === true && !(typeof data[CEP_NUMBER_KEY] === "string" && String(data[CEP_NUMBER_KEY]).trim())) {
    const n = cepNumberFrom(message);
    if (!n) return { set, directive: askNumber, blocking: true };
    set[CEP_NUMBER_KEY] = n;
  }
  if (holds === false && c === "OUTSOURCE") {
    return { set, directive: "", blocking: true };
  }
  return { set, directive: "", blocking: false };
}

// ---------------------------------------------------------------------------
// BUG-191: "I want a new application" starts one.
// ---------------------------------------------------------------------------

/**
 * A request for a fresh application, as opposed to a question about one.
 * Deliberately narrow: "Apply for a new licence" (the opening button) is NOT
 * one — it names a licence, not another application.
 */
export function asksForFreshApplication(message: string | undefined): boolean {
  const m = (message ?? "").toLowerCase();
  if (!m.trim() || m.length > 160) return false;
  return (
    /\b(start|begin|create|want|need|like|make|open|file|do)\b[^.?!]{0,25}\b(new|fresh|another|separate|second)\s+(application|one)\b/.test(m) ||
    /^\s*(a\s+)?(new|fresh|another)\s+application\s*[.!]?\s*$/.test(m) ||
    /\bstart\s+(over|again|afresh)\b|\bfrom scratch\b/.test(m) ||
    /طلب\s+جديد|من\s+البداية/.test(m)
  );
}

/** Kept across a fresh start: who is signed in and how to reach them. */
const KEEP = /^(contact_(name|email|phone)|__authenticated_at|__verified_emirates_id)$/;

/** Does the case hold anything a fresh start would clear? */
export function hasApplicationInProgress(st: CaseState): boolean {
  const d = st.data as Record<string, unknown>;
  return (
    st.documents.some((x) => x.status === "uploaded" || x.status === "accepted" || x.status === "rejected") ||
    Object.keys(d).some((k) => !KEEP.test(k) && d[k] !== undefined && d[k] !== null && d[k] !== "") ||
    !!st.reference
  );
}

/** The case, emptied for a new application — the signed-in person stays. */
export function freshApplication(st: CaseState): CaseState {
  const d = st.data as Record<string, unknown>;
  const kept: Record<string, unknown> = {};
  for (const k of Object.keys(d)) if (KEEP.test(k)) kept[k] = d[k];
  return { ...emptyCase(), journeyKey: "new_license", data: kept as CaseState["data"] };
}

export function freshApplicationDirective(): string {
  return (
    "\nTHE APPLICANT ASKED FOR A NEW APPLICATION, AND IT HAS BEEN STARTED: every detail, document and answer from earlier in this " +
    "conversation has been cleared from the application. Do NOT reuse anything said, uploaded or looked up before this message — no " +
    "company, trade licence, partner, document or answer carries over, and do not mention them. Say in one line that you have started a " +
    "fresh application, then ask which service they are applying for."
  );
}

// ---------------------------------------------------------------------------
// BUG-185 / BUG-186 / BUG-190: the opening, said the same way every time.
// ---------------------------------------------------------------------------

export const SERVICE_QUESTION = { en: "Which service are you applying for?", ar: "ما الخدمة التي تتقدم بطلب للحصول عليها؟" } as const;

export function openingDirective(signedIn: boolean, locale: "en" | "ar"): string {
  const lines = [
    "\nTHE OPENING OF A NEW APPLICATION:",
    `- The service question is asked in exactly these words: "${SERVICE_QUESTION[locale]}" — not "which licence" or "which licence or ` +
      "permit\" — and the menu under it is the system's (Licences, then Permits).",
    "- If a lookup of their company or trade licence finds nothing, or does not answer, never say a registry, a system or a service is " +
      "unreachable, down or unavailable. Say only that you could not find a trade licence linked to their account, and that they will " +
      "upload it with their other documents once they have chosen the service. One sentence, no upload control now — then the service " +
      "question.",
  ];
  if (!signedIn)
    lines.push(
      "- THEY ARE NOT SIGNED IN. Applying needs sign-in. Whenever they ask to apply, decline, or ask why — 'no need for sign in', 'can I " +
        "skip it' — answer with exactly this, word for word, and nothing else:\n" +
        (locale === "ar"
          ? "يتطلب التقديم تسجيل الدخول، لربط الطلب بشركتك والتحقق من هويتك لدى مجموعة بريد الإمارات للتراخيص. يستغرق ذلك لحظات فقط.\n```buttons\n- تسجيل الدخول\n- طرح سؤال بدلاً من ذلك\n```"
          : "Applying needs you to be signed in: it links the application to your company and verifies your identity with Emirates Post Group Licensing. It only takes a moment.\n```buttons\n- Sign in\n- Ask a question instead\n```")
    );
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Per product, once chosen: BUG-192, 194, 195, 196, 199.
// ---------------------------------------------------------------------------

export const TEMPERATURE_CATEGORIES = ["Chilled", "Frozen", "Ambient controlled", "Vaccines", "Biologics", "Dairy", "Fresh produce", "Other"];

export function productRulesDirective(code: string, missingDocs: string[], data: Record<string, unknown>): string {
  const c = code.trim().toUpperCase();
  const out: string[] = ["\nWHAT THIS PRODUCT NEEDS:"];
  if (!c.startsWith("CEP30"))
    out.push(
      `- ${c} has no domestic / international scope in EPGL's catalogue — only the CEP licences do. Never ask about scope or coverage ` +
        "for it and never mention it."
    );
  out.push(
    "- Never narrate what you are doing behind the scenes ('let me record that', 'fetching the catalogue', 'checking') and never ask a " +
      "question and then answer, correct or withdraw it in the same message. Each message says one thing once."
  );
  out.push(
    "- RECORD EVERY ANSWER THE MOMENT IT IS GIVEN with collect_field (a yes/no as true/false) — cold_chain_capability, " +
      "declares_food_delivery, declares_medicine_delivery, affirms_* and the rest. An answer only acknowledged in words is lost."
  );
  out.push(
    "- A question with several answers allowed ('select all that apply') is NEVER a ```buttons block — that is single-choice. Use one " +
      "```toggles block with `style: checkbox`, one `- key: Label` line per option, and a `confirm:` line."
  );
  if (c === "FOODMED") {
    out.push(
      `- Temperature-sensitive categories (only when they deliver medicine): offer exactly these, as checkboxes: ${TEMPERATURE_CATEGORIES.join(", ")}.`,
      "- STORAGE PREMISES are required (Application_Site__c with Site_Type__c exactly \"Storage premises\" — never Retail, Pharmacy or " +
        "anything else, whatever kind of business they are): ask, one question at a time, the premises address, its emirate, and whether " +
        "they have the owner's or landlord's permission to use it. Ask these before the summary."
    );
  }
  if (c === "LOCKERS") {
    out.push(
      "- THE LOCKER AND PUDO SITES are required (one Application_Site__c per site). For each site ask, one question at a time: whether " +
        "it is a locker site or a PUDO point (Site_Type__c is exactly \"Locker site\" or \"PUDO point\"), its address, its emirate, the " +
        "number of lockers, how customers authenticate to collect (for example a PIN or QR code), and whether they have the site " +
        "owner's permission. Then ask if there is another site. Ask these before the summary, and ask for the Locker / PUDO Site " +
        "Locations and Contracts document."
    );
    const n = data[CEP_NUMBER_KEY];
    if (typeof n === "string" && n.trim())
      out.push(`- Their CEP licence number is ${n.trim()}: send it as Principal_Licence_Number on the application. Do not ask for it again.`);
  }
  if (c === "OUTSOURCE") {
    const n = data[CEP_NUMBER_KEY];
    if (typeof n === "string" && n.trim())
      out.push(
        `- Their OWN CEP licence number is ${n.trim()} (put it in Form_Data as Own_CEP_Licence_Number). Principal_Licence_Number is ` +
          "different: the CEP licence of the operator who will hire them — ask for it separately."
      );
  }
  out.push(
    missingDocs.length
      ? `- DOCUMENTS STILL MISSING: ${missingDocs.join("; ")}. Do NOT show the summary, the declaration or submit while any of these is ` +
          "missing — ask for them first."
      : "- Every required document is in."
  );
  return out.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// A checkbox answer is recorded by the server (staging, 10 November).
// ---------------------------------------------------------------------------

/**
 * "Chilled: Yes. Frozen: No. … Confirm categories." — what a ```toggles block
 * sends. The model acknowledged it ("Got it — Chilled and Vaccines") and
 * recorded nothing, so the categories would have reached Salesforce only if it
 * remembered them at submission. Read here instead.
 */
export function toggleAnswers(message: string | undefined): { label: string; on: boolean }[] | null {
  const m = (message ?? "").trim();
  const items = [...m.matchAll(/([^.:]+?):\s*(Yes|No|نعم|لا)\s*\./g)].map((x) => ({ label: x[1]!.trim(), on: /^(yes|نعم)$/i.test(x[2]!) }));
  return items.length >= 2 ? items : null;
}

type FieldLike = { key: string; type: string; options?: { value: string; label: Record<string, string> | string }[] };

/** The multi-choice field every toggled label belongs to, with the ticked values joined as Salesforce takes them. */
export function multiChoiceFromToggles(fields: FieldLike[], message: string | undefined): { key: string; value: string } | null {
  const items = toggleAnswers(message);
  if (!items) return null;
  const n = (s: string) => s.toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, "");
  for (const f of fields) {
    if (f.type !== "multienum" || !f.options?.length) continue;
    const byLabel = new Map<string, string>();
    for (const o of f.options) {
      byLabel.set(n(o.value), o.value);
      const l = o.label;
      for (const t of typeof l === "string" ? [l] : Object.values(l ?? {})) if (t) byLabel.set(n(t), o.value);
    }
    if (!items.every((i) => byLabel.has(n(i.label)))) continue;
    const on = items.filter((i) => i.on).map((i) => byLabel.get(n(i.label))!);
    return { key: f.key, value: on.join(";") };
  }
  return null;
}
