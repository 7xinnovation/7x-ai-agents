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
 *            summary, the Before-payment switches and "Pay AED x" at once;
 *            longer terms and other bundles are one sentence away.
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

/** The two switches a signed-in customer gets back. Not required: a guest never sees them. */
export const CONSENT_FIELDS = [
  { key: "save_card_consent", type: "boolean", label: { en: "Save my card for future payments", ar: "حفظ بطاقتي للمدفوعات المستقبلية" } },
  { key: "auto_renew_consent", type: "boolean", label: { en: "Renew my box automatically", ar: "تجديد صندوقي تلقائيًا" } },
];

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
  ` ${MARKER}. When the customer is SIGNED IN and the box to renew is on their own account (their account list, the box they named in their first message, or the one they tapped Renew on in the panel), the renewal is ONE TAP: nothing is asked of them before the pay button.` +
  ` ENTRY: a first message that names a box to renew for another year ("Renew my PO Box 450293 in Dubai (DXB) for one more year, same bundle and options") IS the whole request, and the term and the bundle in it are COLLECTED — one year, the bundle the box is on now, no add-on added or removed. Do not greet at length, do not read their account out, do not list their boxes, do not ask which box, do not ask how long, and do not offer upgrades. Take the emirate code from the message or from the account tool. If the box is NOT on their account, say so in one line and continue with the ordinary renewal below instead.` +
  ` THE ONE REPLY: call the details tool for the box, then the pricing tool ONCE for one year on the current bundle (isBundleChanged false, newBundleId the current bundle, the expiry rules above; for an expired box the grace rule, which may run to the next future anniversary), and reply ONCE with: the \`\`\`summary block (PO Box, bundle, term 1 year, current expiry, NEW expiry, one row per charge, total: last) followed immediately by the \`\`\`toggles block (title: Before payment; default: on; checkboxes: terms_accepted; the lines save_card_consent, auto_renew_consent and terms_accepted; and the confirm line MUST read \`confirm: Pay AED <total>\` with the real total, NOT \`Proceed to payment\`), then ONE short sentence: to renew for longer or move to a different bundle, they only have to say so. Nothing else, and no question. Record renewal_period as 1_YEAR and the subscriber fields (subscriber_first_name, subscriber_last_name, subscriber_mobile, subscriber_email, billing_area, billing_street) SILENTLY with collect_field from the details response (poBoxAddressDetails and poBoxCustomerDetails) and the signed-in profile, never by asking; renewed_by is resolved for you. A value masked or missing in the details comes from the profile; ask only for a value that exists in neither, and for all such values in ONE message.` +
  ` IF THEY ASK FOR A DIFFERENT TERM OR BUNDLE after that reply, price exactly what they asked for and show the summary and the switches again; that is the ordinary flow and it costs them one more tap, not a restart.` +
  ` THEN, WITHOUT ASKING AGAIN: on confirm call the save tool (their saved card is attached for you and pre-selected on the payment page, so do not ask which card), emit the pay block, confirm with the confirm tool when they return, and close with ONE line giving the new expiry date and the receipt. If auto_renew_consent is true, call nxn_set_auto_renew for the box and say auto-renewal is on; if that call fails, say it could not be switched on, never that it is.` +
  ` A GUEST (not signed in) is NOT on the signed-in shortcuts above — their subscriber details are still collected and only the Terms checkbox is shown — but the SAME-AS-NOW OPENER RULE applies to everyone, guest or signed in: when the first message says "same bundle and options", the customer has chosen their bundle and term, so do NOT show upgrade cards, bundle choices or duration cards, whatever the upgrade rule earlier in this guidance says; it is overridden here. One sentence that a longer term or a different bundle is available on request is all, in the same reply as the summary and the Before-payment block.`;

type Def = Record<string, any>;

export function applyOneTap(input: Def): { def: Def; changes: string[] } {
  const def = JSON.parse(JSON.stringify(input)) as Def;
  const changes: string[] = [];
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
      const at = g.indexOf(` ${MARKER}`);
      const head = at === -1 ? g : g.slice(0, at);
      if (head + FAST_PATH !== g) {
        changes.push(at === -1 ? `${j.key}: fast path appended` : `${j.key}: fast path rewritten`);
        g = head + FAST_PATH;
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
