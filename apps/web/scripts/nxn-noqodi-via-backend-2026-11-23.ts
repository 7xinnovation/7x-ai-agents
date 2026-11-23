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
    { label: { ar: "الدفع عبر نقودي (UAE Pay)", en: "Pay with Noqodi (UAE Pay)" }, value: "uaepay" },
  ],
  validation: { required: false },
};

export function guidanceBlock(renewal: boolean): string {
  return [
    MARK,
    "NOQODI (UAE PAY) IS TAKEN BY EMIRATES POST, LIKE THE CARD. This block SUPERSEDES every other instruction in this guidance about Noqodi: paying it on our secure checkout, calling request_payment for it, a \"Pay … with Noqodi (UAE Pay) instead\" button under the pay block, or ignoring the payment URL a save returns. None of that applies any more.",
    "How it works now: the customer chooses how to pay BEFORE the save, and the save opens the payment on that way. Record collect_field(payment_method, gateway) for the card or collect_field(payment_method, uaepay) for Noqodi, THEN call the save tool — the request is set to Noqodi or the card for you from that field. The save returns a paymentUrl either way: show it as the pay block (label `Pay AED <total> with Card` or `Pay AED <total> with Noqodi (UAE Pay)`, as they chose), and when they are back confirm it with the confirm tool, exactly as for the card. NEVER call request_payment in this journey.",
    "WHERE THEY CHOOSE: on the Before payment toggles block, for a SIGNED-IN customer the confirm line offers both — `confirm: Pay with Card | Pay with Noqodi (UAE Pay)` (Arabic: `confirm: الدفع بالبطاقة | الدفع عبر نقودي (UAE Pay)`)" +
      (renewal ? " — on a renewal with the real total in each, `Pay AED <total> with Card | Pay AED <total> with Noqodi (UAE Pay)`" : "") +
      ". The tap IS the choice; never ask it as a question. With Noqodi, skip the saved-card choice (a saved card is the card gateway's) and do not attach one.",
    "GUESTS: Emirates Post takes Noqodi for signed-in customers only. A guest's confirm line stays the card alone, with one sentence that paying with Noqodi (UAE Pay) needs them to sign in.",
    "Once the pay block is shown the way to pay is fixed: a second save would open a second order. If they ask to switch, say this order's payment is open for the way they chose and they can pick the other next time.",
    END,
  ].join("\n");
}

type Def = Record<string, any>;

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
