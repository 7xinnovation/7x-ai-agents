import { emptyCase, type CaseState, type Locale } from "@dialog/config";
import type { ActionLogEntry } from "./customerActionLog";

/**
 * WITHDRAW A GRANTED PERMISSION, IN ONE STEP.
 *
 * The pre-launch gate's permissions artefact requires that a customer can pull
 * their consent back in a single action — "سحب الصلاحية متاح بخطوة واحدة" — and
 * that the withdrawal revokes the consent, stops anything pending, and TELLS the
 * customer what was erased. The product owner asked for the same in plainer
 * words on 16 September (FB-1737): "stop the activity and cancel the action
 * done, and tell the customer what has been done and what has been erased".
 *
 * This is the pure heart of that control. Given the case as it stands and the
 * plain-language log of what was already done (built from the audit trail, which
 * is the durable record and is NOT erased), it returns:
 *   - `done`     — what had been carried out in the customer's name, untouched.
 *   - `erased`   — the categories of collected data and consent being cleared,
 *                  named for the customer.
 *   - `cleared`  — the case reset to empty; the caller persists this.
 *   - `message`  — the receipt shown back in the conversation.
 *
 * No side effects and no I/O, so the readiness probe can run it against a
 * fabricated case and see that a withdrawal actually erases something and keeps
 * the record — the evidence for the check is this function running, not a flag.
 */
export interface WithdrawalSummary {
  done: ActionLogEntry[];
  erased: string[];
  cleared: CaseState;
  message: string;
}

const STR = {
  en: {
    details: (n: number) => `The ${n} detail${n === 1 ? "" : "s"} you had entered`,
    documents: (n: number) => `The ${n} document${n === 1 ? "" : "s"} you had uploaded`,
    autoRenew: "Your consent to auto-renew",
    saveCard: "Your consent to save your card",
    terms: "Your acceptance of the terms and conditions",
    identity: "Your verified UAE PASS sign-in for this request",
    pending: "A payment you had started but not completed",
    doneHead: "What I did in your name",
    doneNone: "Nothing had been submitted or paid in your name.",
    erasedHead: "What I have now erased",
    erasedNone: "Nothing had been collected yet, so there was nothing to erase.",
    consentCol: "your approval",
    ref: "ref",
    footer:
      "Your session has been signed out and the consent above withdrawn. Anything already submitted to the authority stays on their record — ask the team if you need it withdrawn there. You can start again whenever you like.",
  },
  ar: {
    details: (n: number) => `التفاصيل التي أدخلتها (${n})`,
    documents: (n: number) => `المستندات التي رفعتها (${n})`,
    autoRenew: "موافقتك على التجديد التلقائي",
    saveCard: "موافقتك على حفظ بطاقتك",
    terms: "موافقتك على الشروط والأحكام",
    identity: "تسجيل دخولك المُوثّق عبر الهوية الرقمية لهذا الطلب",
    pending: "عملية دفع بدأتها ولم تكتمل",
    doneHead: "ما تم تنفيذه باسمك",
    doneNone: "لم يتم إرسال أو دفع أي شيء باسمك.",
    erasedHead: "ما تم مسحه الآن",
    erasedNone: "لم يتم جمع أي بيانات بعد، لذا لا يوجد ما يُمسح.",
    consentCol: "موافقتك",
    ref: "المرجع",
    footer:
      "تم تسجيل خروجك وسحب الموافقات أعلاه. أي طلب أُرسل بالفعل إلى الجهة يبقى في سجلاتها — تواصل مع الفريق إن رغبت بسحبه لديهم. يمكنك البدء من جديد في أي وقت.",
  },
} as const;

/** Keys that are bookkeeping, not something the customer "entered". */
const isInternalKey = (k: string) => k.startsWith("__") || /_at$/.test(k) || /_consent$/.test(k) || k === "terms_accepted";
const truthy = (v: unknown) => v === true || v === "true" || v === "yes" || v === 1 || v === "1";

export function summariseWithdrawal(
  state: CaseState,
  done: ActionLogEntry[],
  locale: Locale = "en",
  authenticated = false
): WithdrawalSummary {
  const s = STR[locale === "ar" ? "ar" : "en"];
  const data = (state.data ?? {}) as Record<string, unknown>;
  const erased: string[] = [];

  const detailKeys = Object.keys(data).filter((k) => !isInternalKey(k) && data[k] != null && data[k] !== "");
  if (detailKeys.length) erased.push(s.details(detailKeys.length));

  const docCount = (state.documents ?? []).filter((d) => d.status === "uploaded" || d.status === "accepted").length;
  if (docCount) erased.push(s.documents(docCount));

  if (truthy(data.auto_renew_consent)) erased.push(s.autoRenew);
  if (truthy(data.save_card_consent)) erased.push(s.saveCard);
  if (truthy(data.terms_accepted)) erased.push(s.terms);
  if (authenticated || data.__verified_emirates_id) erased.push(s.identity);

  const pendingPayment =
    state.payment?.status === "initiated" ||
    Boolean(state.hold) ||
    Boolean(state.gatewayPayment && !state.gatewayPayment.paidAt);
  if (pendingPayment) erased.push(s.pending);

  // Build the receipt.
  const lines: string[] = [];
  lines.push(`**${s.doneHead}**`);
  if (done.length) {
    for (const e of done) {
      const ref = e.reference ? ` — ${s.ref} ${e.reference}` : "";
      lines.push(`- ${e.action} (${e.consent})${ref}`);
    }
  } else {
    lines.push(s.doneNone);
  }
  lines.push("");
  lines.push(`**${s.erasedHead}**`);
  if (erased.length) {
    for (const item of erased) lines.push(`- ${item}`);
  } else {
    lines.push(s.erasedNone);
  }
  lines.push("");
  lines.push(s.footer);

  return { done, erased, cleared: emptyCase(), message: lines.join("\n") };
}
