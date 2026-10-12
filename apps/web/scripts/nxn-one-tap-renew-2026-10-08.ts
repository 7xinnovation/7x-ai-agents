/**
 * One tap to renew — the signed-in fast path for a personal PO Box (2026-10-08).
 *
 * The team asked whether a renewal could be one or two steps. It can be two,
 * for a signed-in customer, without anything new from Emirates Post: their
 * Details call already returns the subscriber, the bundle and the expiry, their
 * boxes are on the case from the sign-in pulse, and "who is renewing" is already
 * resolved for a box on the customer's own account. The only decision left is
 * the TERM — and their own rule FB-1428 says it is never pre-selected. So:
 *
 *   one tap  "Renew" names the box AND the term — one more year, same bundle
 *            and options (the team's decision, 8 Oct) — so the reply is the
 *            summary, the Before-payment switches and TWO pay buttons at once
 *            (11 Oct): "Pay AED x with Card" on Emirates Post's page, or
 *            "Pay AED x with Noqodi (UAE Pay)" on our checkout, after which
 *            the save RECORDS the renewal; longer terms and other bundles
 *            are one sentence away.
 *   then     Emirates Post's payment page (their Save opens it; a saved card is
 *            pre-selected there, never charged by us), their confirm, one line.
 *
 * WHAT THIS WRITES, idempotently, to nxn-dialog:
 *   1. the save-card and auto-renew consent fields back on the personal renewal
 *      step — they were removed on 2 September when the journey became
 *      guest-shaped, and the signed-in path offers both switches again;
 *   2. the guest-only sentences in both renewal journeys made conditional: what
 *      was "this journey runs WITHOUT sign-in, never offer…" now says "for a
 *      GUEST", because a signed-in customer is now on the same journey;
 *   3. the fast-path block on the PERSONAL renewal only. Corporate needs a trade
 *      licence and is not two taps; it keeps the ordinary flow.
 *
 * The code side shipped alongside: the saved card attached to the renewal save
 * for a signed-in customer, a Renew action on each box in the panel, a start
 * intent on the embed URL / window.Dialog.start, and the pulse offering the
 * expiring box's renewal as one button.
 *
 * Run from apps/web:
 *   npx tsx scripts/nxn-one-tap-renew-2026-10-08.ts --env <file> [--dry-run]
 */
import { pathToFileURL } from "node:url";
import dns from "node:dns/promises";
import pg from "pg";
import { databaseUrlFrom } from "./lib/envFile";

export const SLUG = "nxn-dialog";
export const FAST_PATH_JOURNEY = "personal_po_box_renewal";
export const RENEWAL_JOURNEYS = ["personal_po_box_renewal", "corporate_po_box_renewal"];
export const MARKER = "SIGNED-IN FAST PATH, TWO TAPS (2026-10-08)";

/**
 * The same rule in one paragraph at the TOP of the guidance (2026-10-11).
 *
 * The long form sits at the end of thirty thousand characters, after stage-by-
 * stage instructions that each ask for a confirmation, and on staging the
 * model answered a one-tap opener with "Just to confirm, you'd like to
 * renew…?" one run in two. A rule the model reads first is a rule it keeps.
 */
export const TOP_MARKER = "ONE-TAP RENEWAL OPENER, READ FIRST (2026-10-11)";
export const TOP_RULE =
  `${TOP_MARKER}: a first message of the form "Renew my PO Box <n> in <emirate> for one more year, same bundle and options" — or the pulse button's "Renew PO Box <n> for another year" — is a COMPLETE, CONFIRMED request. Never answer it with a question — not "just to confirm", not "is that right", not "which term", not "which bundle", not how to pay — and never with an empty buttons block. SIGNED IN: ONE reply that calls the details tool, the pricing tool once for ONE YEAR on the current bundle, records the fields silently, CALLS THE SAVE TOOL, and then shows the renewal summary block, the pay block (\`label: Pay AED <total> with Card\`, the paymentUrl the save returned), a buttons block with the single choice \`Pay AED <total> with Noqodi (UAE Pay) instead\`, the sentence that paying accepts the Terms and Conditions, and one sentence that a longer term or another bundle is available on request — no switches, no checkbox: the pay button is the next tap. GUEST: the masked holder line ("This box is registered to … — is that you?"), the summary block and the Before-payment toggles block with the Terms checkbox and \`confirm: Pay AED <total> with Card\` alone, all in that same reply, plus one sentence that Noqodi (UAE Pay) needs a sign-in. Details at the end of this guidance under "${MARKER}". `;

/** The two switches a signed-in customer gets back. Not required: a guest never sees them. */
export const CONSENT_FIELDS = [
  { key: "save_card_consent", type: "boolean", label: { en: "Save my card for future payments", ar: "حفظ بطاقتي للمدفوعات المستقبلية" } },
  { key: "auto_renew_consent", type: "boolean", label: { en: "Renew my box automatically", ar: "تجديد صندوقي تلقائيًا" } },
];

/**
 * How they pay (2026-10-11): the card on Emirates Post's page, as today, or
 * Noqodi (UAE Pay) on our checkout. The tap on the Before-payment block IS the
 * choice, so the field is recorded from that tap and never asked separately.
 */
export const PAYMENT_FIELD = {
  key: "payment_method",
  type: "enum",
  label: { en: "How to pay", ar: "طريقة الدفع" },
  options: [
    { value: "gateway", label: { en: "Pay with Card", ar: "الدفع بالبطاقة" } },
    { value: "uaepay", label: { en: "Pay with Noqodi (UAE Pay)", ar: "الدفع عبر نقودي (UAE Pay)" } },
  ],
};

/** Guest-only sentences, and what they say now that a signed-in customer shares the journey. */
export const REWORDINGS: [string, string][] = [
  [
    "This journey runs WITHOUT sign-in, so do NOT offer to save the card and do NOT offer auto-renewal: Emirates Post has no account to keep a card against, and auto-renewal would have nothing to charge. Never emit a toggles block for either, and never record save_card_consent or auto_renew_consent here. If the customer asks for either, say plainly that both need an Emirates Post account, and offer to continue as a guest or to sign in. ",
    "For a GUEST (not signed in), do NOT offer to save the card and do NOT offer auto-renewal: Emirates Post has no account to keep a card against, and auto-renewal would have nothing to charge; never emit a toggles block for either and never record save_card_consent or auto_renew_consent for a guest. If a guest asks for either, say plainly that both need an Emirates Post account, and offer to continue as a guest or to sign in. A SIGNED-IN customer gets both switches in the Before payment block, default on. ",
  ],
  [
    "At payment: a guest has no card on file, so send them to the payment page. ",
    "At payment: a guest has no card on file, so send them to the payment page; a signed-in customer's saved card is attached to the save for you and pre-selected on that page, so never ask them for card details. ",
  ],
];
export const NOTE_REWORDINGS: [string, string][] = [
  [
    "this journey runs for a customer who is NOT signed in, so it uses the Guest endpoints and only those.",
    "this journey uses the Guest endpoints for every customer, signed in or not, and only those (they need no session).",
  ],
  [
    "NEVER offer to save a card or to enable auto-renewal here. A guest has no Emirates Post account to save either against, and the toggles are not shown for this journey.",
    "For a GUEST, never offer to save a card or to enable auto-renewal: a guest has no Emirates Post account to save either against. A SIGNED-IN customer is offered both as switches before payment, and their saved card is attached to the save for you.",
  ],
];

/** The fast path, as the model reads it. Appended once; replaced on re-run. */
export const FAST_PATH =
  ` ${MARKER}. When the customer is SIGNED IN and the box to renew is on their own account (their account list, the box they named in their first message, or the one they tapped Renew on in the panel), the renewal is ONE TAP: nothing is asked of them before the pay button, and the pay button opens Emirates Post's payment page itself.` +
  ` ENTRY: a first message that names a box to renew for another year ("Renew my PO Box 450293 in Dubai (DXB) for one more year, same bundle and options", or the pulse button's "Renew PO Box 450293 for another year") IS the whole request, and the term and the bundle in it are COLLECTED — one year, the bundle the box is on now, no add-on added or removed, auto-renewal left exactly as it is. Do not greet at length, do not read their account out, do not list their boxes, do not ask which box, do not ask how long, do not ask how to pay, and do not offer upgrades. NEVER answer this message with a confirmation question ("Just to confirm, you'd like to renew…?"): the message IS the confirmation. Take the emirate code from the message or from the account tool. If the box is NOT on their account, say so in one line and continue with the ordinary renewal below instead.` +
  ` THE ONE REPLY (signed in): you may open with one short line ("Renewing PO Box 450293 for one more year — one moment."), then call the details tool for the box, then the pricing tool ONCE for one year on the current bundle (isBundleChanged false, newBundleId the current bundle, the expiry rules above; for an expired box the grace rule, which may run to the next future anniversary), then record SILENTLY with collect_field — renewal_period 1_YEAR, payment_method gateway, and the subscriber fields (subscriber_first_name, subscriber_last_name, subscriber_mobile, subscriber_email, billing_area, billing_street) from the details response (poBoxAddressDetails and poBoxCustomerDetails) and the signed-in profile, never by asking; renewed_by is resolved for you; a value masked or missing in the details comes from the profile, and only a value that exists in neither is asked for, all such values in ONE message — then CALL THE SAVE TOOL in this same reply (do NOT call the renewed-by options tool — renewed_by is resolved for you — do not price twice, and send the collect_field calls and the save together in one go), with customerKYC { firstName, lastName, email, mobileNumber } carrying those same subscriber values, paymentProperties.saveCreditCard false and isAutomaticSubscriptionEnabled exactly as the box has it today (isAutoRenewEnabled in the details): nothing is switched on or off that the customer did not ask for, and their saved card, if Emirates Post holds one, is attached for you and pre-selected on their page. Then reply ONCE with: the \`\`\`summary block (PO Box, bundle, term 1 year, current expiry, NEW expiry, one row per charge, a row \`Auto-renewal: on/off, as now\`, total: last), followed immediately by the \`\`\`pay block (\`label: Pay AED <total> with Card\`, \`url:\` the paymentUrl from the save response, \`amount: AED <total>\`), then a \`\`\`buttons block with the single choice \`Pay AED <total> with Noqodi (UAE Pay) instead\`, then the sentence "By paying you accept the [Terms and Conditions](https://www.emiratespost.ae/terms-individual).", then ONE short sentence: to renew for longer or move to a different bundle, they only have to say so. No switches, no checkbox, no question. In an Arabic conversation the label reads \`ادفع AED <total> بالبطاقة\`, the button reads \`ادفع AED <total> عبر نقودي (UAE Pay) بدلاً من ذلك\`, and the terms sentence is in Arabic. Write nothing between the tools and the summary about what they returned. If the save tool fails or is refused, show the summary and say plainly what Emirates Post answered and that nothing has been charged, with the reference if there is one — no pay block, no retry, no second save.` +
  ` AFTER THE PAY BUTTON: when they come back from Emirates Post's payment page, the order ALREADY EXISTS — do NOT call the save tool again (a second save opens a second order). Record collect_field(terms_accepted, true) — they accepted the terms by paying, as the sentence under the button said — then call the confirm tool ONCE and close with ONE line giving the new expiry date and the receipt; if the box's auto-renewal is OFF, offer switching it on as the ONE next-step \`\`\`buttons choice (do NOT call nxn_set_auto_renew before they tap it — the box keeps its auto-renewal as it is), and on a yes call nxn_set_auto_renew for the box and say auto-renewal is on; if that call fails, say it could not be switched on, never that it is. The receipt download link is added under your reply for you: do not write one, and do not say it is above.` +
  ` "PAY WITH NOQODI (UAE PAY) INSTEAD" tapped: that tap, under the terms sentence, is the acceptance — record collect_field(terms_accepted, true) and collect_field(payment_method, uaepay), then call request_payment for the quoted total: our secure checkout card appears in the chat by itself, never a pay block. The renewal is ALREADY RECORDED by the save above, so when the payment reports paid do NOT call the save tool again (a second save opens a second order) and do NOT call the confirm tool (it reads Emirates Post's gateway, which did not take this payment): give the order reference from the save, the new expiry and the receipt, and say the renewal is recorded; if the box's auto-renewal is OFF, offer switching it on the same way, without calling nxn_set_auto_renew until they tap.` +
  ` IF THEY ASK FOR A DIFFERENT TERM OR BUNDLE after that reply, price exactly what they asked for and show the summary and the Before-payment \`\`\`toggles block (title: Before payment; default: on; checkboxes: terms_accepted; the lines save_card_consent, auto_renew_consent and terms_accepted; and the confirm line MUST read \`confirm: Pay AED <total> with Card | Pay AED <total> with Noqodi (UAE Pay)\` with the real total — TWO buttons for a SIGNED-IN customer, NOT \`Proceed to payment\`); that is the ordinary flow and it costs them one more tap, not a restart. THE TAP IS THE CHOICE OF HOW TO PAY there, so never ask it as a question. "with Card": record collect_field(payment_method, gateway), call the save tool (their saved card is attached for you and pre-selected on Emirates Post's payment page, so do not ask which card), emit the pay block, and confirm with the confirm tool when they return. "with Noqodi (UAE Pay)": record collect_field(payment_method, uaepay), then call request_payment — our secure checkout card appears in the chat by itself, never a pay block; when it reports paid, call the save tool ONCE to record the renewal — unless it was already saved in this conversation — IGNORE the payment URL that save returns, and do NOT call the confirm tool (it reads Emirates Post's gateway, which did not take this payment). Either way close with ONE line giving the new expiry date and the receipt. If auto_renew_consent is true, call nxn_set_auto_renew for the box and say auto-renewal is on; if that call fails, say it could not be switched on, never that it is.` +
  ` A GUEST (not signed in) is NOT on the signed-in shortcuts above — their subscriber details are still collected, only the Terms checkbox is shown, and the confirm line is \`confirm: Pay AED <total> with Card\` alone (in an Arabic conversation \`confirm: ادفع AED <total> بالبطاقة\`), with one sentence that paying with Noqodi (UAE Pay) needs them to sign in, because it needs the Emirates ID their sign-in carries — but the SAME-AS-NOW OPENER RULE applies to everyone, guest or signed in: when the first message says "same bundle and options", the customer has chosen their bundle and term, so do NOT show upgrade cards, bundle choices or duration cards, whatever the upgrade rule earlier in this guidance says; it is overridden here. One sentence that a longer term or a different bundle is available on request is all, in the same reply as the summary and the Before-payment block.`;

type Def = Record<string, any>;

/** Is Noqodi (UAE Pay) switched on for this agent? It decides which wording and which field are written. */
export function noqodiEnabled(def: Def): boolean {
  const all = Array.isArray(def.paymentMethods) ? def.paymentMethods : [];
  return all.some((m: any) => m?.key === "uaepay" && m?.enabled !== false);
}

/**
 * THE SAME GUIDANCE WITHOUT NOQODI (2026-10-12).
 *
 * Production has no Noqodi credentials yet, so its agents carry the method
 * switched off — and a fast path that promises a "Pay with Noqodi instead"
 * button there would put a button that cannot open a checkout in front of a
 * paying customer. Every Noqodi clause is taken out of the text for such an
 * agent; each anchor below must exist in the text it is applied to, so drift
 * between the two is caught by the tests rather than found in production.
 */
export function withoutNoqodi(text: string): string {
  const cut = (from: string, to: string, replacement: string) => {
    const a = out.indexOf(from);
    if (a === -1) return false;
    const b = out.indexOf(to, a);
    if (b === -1) throw new Error(`withoutNoqodi: no end for ${from.slice(0, 40)}`);
    out = out.slice(0, a) + replacement + out.slice(b);
    return true;
  };
  let out = text;
  const rules: [string, string][] = [
    [", a buttons block with the single choice \`Pay AED <total> with Noqodi (UAE Pay) instead\`", ""],
    [", plus one sentence that Noqodi (UAE Pay) needs a sign-in", ""],
    [", then a \`\`\`buttons block with the single choice \`Pay AED <total> with Noqodi (UAE Pay) instead\`", ""],
    [", the button reads \`ادفع AED <total> عبر نقودي (UAE Pay) بدلاً من ذلك\`, and the terms sentence is in Arabic.", ", and the terms sentence is in Arabic."],
    ["\`confirm: Pay AED <total> with Card | Pay AED <total> with Noqodi (UAE Pay)\` with the real total — TWO buttons for a SIGNED-IN customer, NOT \`Proceed to payment\`", "\`confirm: Pay AED <total> with Card\` with the real total, NOT \`Proceed to payment\`"],
    [", with one sentence that paying with Noqodi (UAE Pay) needs them to sign in, because it needs the Emirates ID their sign-in carries", ""],
  ];
  for (const [from, to] of rules) out = out.split(from).join(to);
  cut(" \"PAY WITH NOQODI (UAE PAY) INSTEAD\" tapped:", " IF THEY ASK FOR A DIFFERENT TERM", " NOQODI (UAE PAY) IS NOT OFFERED on this agent: no button for it and no sentence about it; if the customer asks for it, say it is not available here — not that it failed — and point back to the pay button.");
  cut(" \"with Noqodi (UAE Pay)\": record collect_field(payment_method, uaepay)", "Either way close with ONE line", " ");
  out = out.split(" Either way close with ONE line").join(" Close with ONE line").split("  Close with ONE line").join(" Close with ONE line");
  if (/Noqodi|نقودي|uaepay/.test(out)) throw new Error("withoutNoqodi left a Noqodi clause behind: " + /.{0,80}(Noqodi|نقودي|uaepay).{0,80}/.exec(out)?.[0]);
  return out;
}

export const topRuleFor = (noqodi: boolean) => (noqodi ? TOP_RULE : withoutNoqodi(TOP_RULE));
export const fastPathFor = (noqodi: boolean) => (noqodi ? FAST_PATH : withoutNoqodi(FAST_PATH));
export const paymentFieldFor = (noqodi: boolean) => (noqodi ? PAYMENT_FIELD : { ...PAYMENT_FIELD, options: PAYMENT_FIELD.options.filter((o) => o.value !== "uaepay") });

/** JSON with object keys sorted, so a value read back from jsonb compares equal to the one written. */
function stable(v: unknown): string {
  return JSON.stringify(v, (_k, val) => (val && typeof val === "object" && !Array.isArray(val) ? Object.fromEntries(Object.keys(val).sort().map((k) => [k, (val as Record<string, unknown>)[k]])) : val));
}

export function applyOneTap(input: Def): { def: Def; changes: string[] } {
  const def = JSON.parse(JSON.stringify(input)) as Def;
  const changes: string[] = [];
  const noqodi = noqodiEnabled(def);
  const topRule = topRuleFor(noqodi);
  const fastPath = fastPathFor(noqodi);
  const paymentField = paymentFieldFor(noqodi);
  for (const j of def.journeys ?? []) {
    if (!RENEWAL_JOURNEYS.includes(String(j.key))) continue;

    // 1. The consent switches, on the personal renewal only.
    if (j.key === FAST_PATH_JOURNEY) {
      const step = (j.steps ?? [])[0];
      if (!step) throw new Error(`${j.key} has no steps`);
      step.fields = step.fields ?? [];
      for (const f of CONSENT_FIELDS) {
        if (step.fields.some((x: any) => x?.key === f.key)) continue;
        step.fields.push({ key: f.key, type: f.type, label: f.label, validation: { required: false } });
        changes.push(`${j.key}: field += ${f.key}`);
      }
      const pf = step.fields.find((x: any) => x?.key === PAYMENT_FIELD.key);
      if (!pf) {
        step.fields.push({ ...paymentField, validation: { required: false } });
        changes.push(`${j.key}: field += ${PAYMENT_FIELD.key}`);
      } else if (stable(pf.options) !== stable(paymentField.options)) {
        pf.options = paymentField.options;
        changes.push(`${j.key}: payment_method options follow the methods switched on`);
      }
    }

    // 2. Guest-only sentences become conditional, in both renewals.
    let g = String(j.guidance ?? "");
    for (const [from, to] of REWORDINGS) {
      if (g.includes(from)) { g = g.split(from).join(to); changes.push(`${j.key}: guidance says "for a GUEST" where it said "without sign-in"`); }
    }
    const flow = j.submission?.apiFlow;
    if (flow && typeof flow.notes === "string") {
      let notes = flow.notes as string;
      for (const [from, to] of NOTE_REWORDINGS) {
        if (notes.includes(from)) { notes = notes.split(from).join(to); changes.push(`${j.key}: apiFlow.notes reworded for signed-in customers`); }
      }
      if (notes !== flow.notes) flow.notes = notes;
    }

    // 3. The fast path, on the personal renewal only; replaced, never stacked.
    if (j.key === FAST_PATH_JOURNEY) {
      // 3a. The short rule first, where the model reads first.
      const topAt = g.indexOf(TOP_MARKER);
      if (topAt === -1) {
        g = topRule + g;
        changes.push(`${j.key}: one-tap rule placed at the top of the guidance`);
      } else {
        const end = g.indexOf(`under "${MARKER}". `, topAt);
        const current = end === -1 ? null : g.slice(topAt, end + `under "${MARKER}". `.length);
        if (current !== topRule) {
          g = (current ? g.replace(current, topRule) : topRule + g);
          changes.push(`${j.key}: one-tap rule at the top rewritten`);
        }
      }
      const at = g.indexOf(` ${MARKER}`);
      const head = at === -1 ? g : g.slice(0, at);
      if (head + fastPath !== g) {
        changes.push(at === -1 ? `${j.key}: fast path appended` : `${j.key}: fast path rewritten`);
        g = head + fastPath;
      }
    }
    if (g !== String(j.guidance ?? "")) j.guidance = g;
  }
  // One line per distinct change: two rewordings in one journey are one fact.
  return { def, changes: [...new Set(changes)] };
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
    const { def, changes } = applyOneTap(rows[0].definition);
    console.log(`\n${SLUG} — one tap to renew`);
    for (const c of changes) console.log(`  ~ ${c}`);
    if (!changes.length) { console.log("\nAlready applied — nothing to change."); return; }
    if (DRY) { console.log(`\n--dry-run: ${changes.length} change(s) NOT written.`); return; }
    await pool.query(`update agents set definition = $1::jsonb where id = $2`, [JSON.stringify(def), rows[0].id]);
    console.log(`\n${changes.length} change(s) written.`);
  } finally { await pool.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(() => process.exit(0)).catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
}
