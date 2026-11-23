/**
 * Noqodi (UAE Pay) on Emirates Post's own gateway — NXN, per environment (2026-11-23).
 *
 * Emirates Post's PO Box API team: "we have added support for uaepay … only for
 * Rental and Renew, only for logged in journey, new parameter paymentProvider:
 * 0 is NI, 1 is uaepay, by default it is 0" (in paymentProperties of the save).
 *
 * Until now NXN's Noqodi went through OUR checkout first and the save only
 * recorded the order — which their ConfirmPayment, reading their gateway, could
 * never confirm. With paymentProvider the save opens the Noqodi payment itself
 * and the card's path (save → pay block → confirm) carries it unchanged. The
 * code sets paymentProvider from the recorded payment_method when the uaepay
 * method is `via: "backend"` (lib/integrations.ts, "WHICH GATEWAY").
 *
 * WHAT IT WRITES
 *   1. paymentMethods: uaepay gets `via: "backend"` (and is switched on with
 *      --enable; its position is otherwise left alone).
 *   2. A payment_method field (card / Noqodi) beside terms_accepted in every
 *      rental and renewal journey that lacks one, so the choice can be recorded.
 *   3. A marked guidance block at the TOP of those journeys that supersedes the
 *      older Noqodi wording (our checkout, request_payment, "instead" buttons).
 * Safe to run again: a second run says "already".
 *
 * Run from apps/web:
 *   npx tsx scripts/nxn-noqodi-via-backend-2026-11-23.ts --env <file> [--enable] [--dry-run]
 */
import { pathToFileURL } from "node:url";
import dns from "node:dns/promises";
import pg from "pg";
import { databaseUrlFrom } from "./lib/envFile";

export const JOURNEYS = ["personal_po_box_rental", "corporate_po_box_rental", "personal_po_box_renewal", "corporate_po_box_renewal"];
export const MARK = "<!--nxn:NOQODI VIA EMIRATES POST (2026-11-23)-->";
const END = "<!--/nxn:NOQODI VIA EMIRATES POST (2026-11-23)-->";

export const FIELD = {
  key: "payment_method",
  type: "enum",
  label: { ar: "طريقة الدفع", en: "How to pay" },
  options: [
    { label: { ar: "الدفع بالبطاقة", en: "Pay with Card" }, value: "gateway" },
    { label: { ar: "الدفع عبر UAE PAY", en: "Pay with UAE PAY" }, value: "uaepay" },
  ],
  validation: { required: false },
};

export function guidanceBlock(renewal: boolean): string {
  return [
    MARK,
    "UAE PAY IS TAKEN BY EMIRATES POST, LIKE THE CARD. This block SUPERSEDES every other instruction in this guidance about UAE PAY: paying it on our secure checkout, calling request_payment for it, a \"Pay … with UAE PAY instead\" button under the pay block, or ignoring the payment URL a save returns. None of that applies any more.",
    "How it works now: the customer chooses how to pay BEFORE the save, and the save opens the payment on that way. Record collect_field(payment_method, gateway) for the card or collect_field(payment_method, uaepay) for UAE PAY, THEN call the save tool — the request is set to UAE PAY or the card for you from that field. The save returns a paymentUrl either way: show it as the pay block (label `Pay AED <total> with Card` or `Pay AED <total> with UAE PAY`, as they chose), and when they are back confirm it with the confirm tool, exactly as for the card. NEVER call request_payment in this journey.",
    "WHERE THEY CHOOSE: on the Before payment toggles block, for a SIGNED-IN customer the confirm line offers both — `confirm: Pay with Card | Pay with UAE PAY` (Arabic: `confirm: الدفع بالبطاقة | الدفع عبر UAE PAY`)" +
      (renewal ? " — on a renewal with the real total in each, `Pay AED <total> with Card | Pay AED <total> with UAE PAY`" : "") +
      ". The tap IS the choice; never ask it as a question. With UAE PAY, skip the saved-card choice (a saved card is the card gateway's) and do not attach one.",
    "GUESTS: Emirates Post takes UAE PAY for signed-in customers only. A guest's confirm line stays the card alone, with one sentence that paying with UAE PAY needs them to sign in.",
    "Once the pay block is shown the way to pay is fixed: a second save would open a second order. If they ask to switch, say this order's payment is open for the way they chose and they can pick the other next time.",
    END,
  ].join("\n");
}

type Def = Record<string, any>;

/** The Before payment card a signed-in renewal shows before anything is saved. */
const SIGNED_IN_CARD =
  "the Before payment ```toggles block — `title: Before payment`; the line `default: on` ONLY if the box's auto-renewal is on today (isAutoRenewEnabled in the details); `checkboxes: terms_accepted`; `- auto_renew_consent: Renew this box automatically every year`; `- terms_accepted: I accept the [Terms and Conditions](https://www.emiratespost.ae/terms-individual)`; `confirm: Pay AED <total> with Card | Pay AED <total> with UAE PAY` with the real total in both (Arabic: title `قبل الدفع`, switch `جدّد هذا الصندوق تلقائياً كل عام`, tickbox `أوافق على [الشروط والأحكام](https://www.emiratespost.ae/terms-individual)`, confirm `ادفع AED <total> بالبطاقة | ادفع AED <total> عبر UAE PAY`)";

/**
 * The personal renewal's signed-in fast path predates both the Before payment
 * card (2026-11-20) and this: it saved on the first reply with the card and
 * offered "Noqodi instead" on our checkout. Tested 23 Nov with a real signed-in
 * account, the model followed it over the block at the top — so the passages
 * themselves are rewritten. Each is found by its exact start (and end), and a
 * passage already rewritten is simply not found again.
 */
export const RENEWAL_REWRITES: { start: string; end: string; text: string }[] = [
  {
    start: "SIGNED IN: ONE reply that calls the details tool, the pricing tool once for ONE YEAR on the current bundle, records the fields silently, CALLS THE SAVE TOOL,",
    end: "no switches, no checkbox: the pay button is the next tap.",
    text:
      `SIGNED IN — TWO TAPS (2026-11-23): the FIRST reply calls the details tool and the pricing tool once for ONE YEAR on the current bundle, records the fields silently, does NOT call the save tool, and shows the renewal summary block, then ${SIGNED_IN_CARD}, then one sentence that a longer term or another bundle is available on request. No pay block yet. When they confirm, their confirm names the way to pay: record terms_accepted, auto_renew_consent and payment_method (gateway for the card, uaepay for UAE PAY), CALL THE SAVE TOOL once, and reply with ONLY the pay block labelled the way they chose — no "instead" button.`,
  },
  {
    start: "— then CALL THE SAVE TOOL in this same reply (do NOT call the renewed-by options tool",
    end: "without calling nxn_set_auto_renew until they tap.",
    text:
      `— and do NOT call the save tool in this reply. Reply ONCE with the \`\`\`summary block (PO Box, bundle, term 1 year, current expiry, NEW expiry, one row per charge, a row \`Auto-renewal: on/off, as now\`, total: last), then ${SIGNED_IN_CARD}, then ONE short sentence: to renew for longer or move to a different bundle, they only have to say so. No pay block, no payment link, no question. Write nothing between the tools and the summary about what they returned. ` +
      `WHEN THEY CONFIRM THE CARD (it ends "with Card" or "with UAE PAY"): record collect_field(terms_accepted, true), collect_field(auto_renew_consent, <their switch>) and collect_field(payment_method, gateway | uaepay), then CALL THE SAVE TOOL once (do NOT call the details, pricing or renewed-by options tools again — renewed_by is resolved for you), with customerKYC { firstName, lastName, email, mobileNumber } carrying the subscriber values, paymentProperties.saveCreditCard false and isAutomaticSubscriptionEnabled exactly as the box has it today — which way to pay is set on the request for you from payment_method. Reply with ONLY the \`\`\`pay block (\`label: Pay AED <total> with Card\` or \`label: Pay AED <total> with UAE PAY\`, \`url:\` the paymentUrl the save returned, \`amount: AED <total>\`). If the save fails or is refused, say plainly what Emirates Post answered and that nothing has been charged — no pay block, no retry, no second save. ` +
      `AFTER THE PAY BUTTON: when they come back from the payment page the order ALREADY EXISTS — do NOT call the save tool again (a second save opens a second order). Call the confirm tool ONCE; if it reports paid and their auto-renewal choice differs from the box's, call nxn_set_auto_renew ONCE with their choice; close with ONE line giving the new expiry date and the auto-renewal as it now stands. The receipt download link is added under your reply for you: do not write one, and do not say it is above. If they ask to pay the other way after the pay block is shown, say this order's payment is open for the way they chose — a second save would open a second order.`,
  },
  {
    start: "\"with Noqodi (UAE Pay)\": record collect_field(payment_method, uaepay), then call request_payment",
    end: "which did not take this payment).",
    text:
      "\"with UAE PAY\": record collect_field(payment_method, uaepay) and call the save tool — Emirates Post opens the payment on UAE PAY for you — emit the pay block labelled `Pay AED <total> with UAE PAY`, and confirm with the confirm tool when they return, exactly as for the card. NEVER call request_payment for it.",
  },
];

export function rewritePassages(g: string, rewrites: typeof RENEWAL_REWRITES): { text: string; done: string[] } {
  let out = g;
  const done: string[] = [];
  for (const r of rewrites) {
    const i = out.indexOf(r.start);
    if (i === -1) continue;
    const e = out.indexOf(r.end, i);
    if (e === -1) throw new Error(`passage "${r.start.slice(0, 40)}…" has no end "${r.end.slice(0, 40)}…"`);
    out = out.slice(0, i) + r.text + out.slice(e + r.end.length);
    done.push(r.start.slice(0, 48));
  }
  return { text: out, done };
}

export function apply(defIn: Def, opts: { enable: boolean }): { def: Def; changes: string[] } {
  const def: Def = JSON.parse(JSON.stringify(defIn));
  const changes: string[] = [];
  if (def.tenantSlug !== "nxn") throw new Error(`refusing: tenant is ${def.tenantSlug}, not nxn`);

  const methods: Def[] = Array.isArray(def.paymentMethods) ? def.paymentMethods : [];
  const u = methods.find((m) => m.key === "uaepay");
  if (!u) throw new Error("no uaepay payment method on this agent — run uaepay-rollout-2026-10-07.ts first");
  if (u.via !== "backend") { u.via = "backend"; changes.push('paymentMethods.uaepay.via = "backend"'); }
  if (opts.enable && u.enabled === false) { u.enabled = true; changes.push("paymentMethods.uaepay switched ON"); }
  if (!opts.enable) changes.push(`(uaepay stays ${u.enabled === false ? "OFF" : "ON"})`);

  for (const key of JOURNEYS) {
    const j = (def.journeys ?? []).find((x: Def) => x.key === key);
    if (!j) { changes.push(`(${key}: not on this agent)`); continue; }
    const steps: Def[] = j.steps ?? [];
    const has = steps.some((s) => (s.fields ?? []).some((f: Def) => f.key === "payment_method"));
    if (!has) {
      const host = steps.find((s) => (s.fields ?? []).some((f: Def) => f.key === "terms_accepted"));
      if (!host) throw new Error(`${key}: no step holds terms_accepted to put payment_method beside`);
      host.fields.push(JSON.parse(JSON.stringify(FIELD)));
      changes.push(`${key}: payment_method field added to step "${host.key}"`);
    } else {
      const f = steps.flatMap((s) => s.fields ?? []).find((x: Def) => x.key === "payment_method");
      if (!(f.options ?? []).some((o: Def) => o.value === "uaepay")) {
        f.options = [...(f.options ?? []), FIELD.options[1]];
        changes.push(`${key}: payment_method += uaepay`);
      }
    }
    if (key === "personal_po_box_renewal") {
      const r = rewritePassages(j.guidance ?? "", RENEWAL_REWRITES);
      if (r.done.length) {
        changes.push(`${key}: rewrote ${r.done.length} old passage(s) — ${r.done.map((d) => `"${d}…"`).join(", ")} (${(j.guidance ?? "").length} → ${r.text.length} chars)`);
        j.guidance = r.text;
      }
    }
    const block = guidanceBlock(/renewal/.test(key));
    const g: string = j.guidance ?? "";
    const i = g.indexOf(MARK);
    if (i === -1) {
      j.guidance = `${block}\n\n${g}`;
      changes.push(`${key}: guidance block added at the top (${g.length} → ${j.guidance.length} chars)`);
    } else {
      const e = g.indexOf(END, i);
      if (e === -1) throw new Error(`${key}: start marker without end marker`);
      const next = g.slice(0, i) + block + g.slice(e + END.length);
      if (next !== g) { j.guidance = next; changes.push(`${key}: guidance block refreshed`); }
    }
  }
  return { def, changes };
}

async function poolFor(url: string): Promise<pg.Pool> {
  const u = new URL(url);
  let host = u.hostname;
  try { dns.setServers(["1.1.1.1", "8.8.8.8"]); host = (await dns.resolve4(u.hostname))[0] ?? host; } catch { /* use the name */ }
  return new pg.Pool({
    host, port: Number(u.port || 5432), database: u.pathname.slice(1),
    user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
    ssl: { servername: u.hostname, rejectUnauthorized: false },
  });
}

async function main() {
  const arg = (n: string) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : undefined; };
  const ENV = arg("--env");
  if (!ENV) throw new Error("--env <envfile> is required");
  const DRY = process.argv.includes("--dry-run");
  const pool = await poolFor(databaseUrlFrom(ENV));
  try {
    const { rows } = await pool.query(`select id, definition from agents where slug = 'nxn-dialog'`);
    if (!rows.length) throw new Error("No nxn-dialog in this database");
    const { def, changes } = apply(rows[0].definition, { enable: process.argv.includes("--enable") });
    console.log(`\nnxn-dialog (${def.activeEnvironment ?? "production"})`);
    for (const c of changes) console.log(`  ${c.startsWith("(") ? " " : "~"} ${c}`);
    const real = changes.filter((c) => !c.startsWith("("));
    if (!real.length) { console.log("\nAlready applied — nothing to change."); return; }
    if (DRY) { console.log(`\n--dry-run: ${real.length} change(s) NOT written.`); return; }
    await pool.query(`update agents set definition = $1::jsonb where id = $2`, [JSON.stringify(def), rows[0].id]);
    console.log(`\n${real.length} change(s) written.`);
  } finally {
    await pool.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
}
