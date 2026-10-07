/**
 * "Pay with Card" or "Pay with Noqodi (UAE Pay)" — per agent, per environment (2026-10-07).
 *
 * The decision on 7 October: every agent offers the card (N-Genius, as today)
 * and Noqodi — the federal UAE Pay platform — as a second way to pay, under
 * those two names. The plumbing already exists from 2 October: a gateway
 * binding per method (`integrations.paymentGateways`), a per-agent switch per
 * method (`paymentMethods`), and `request_payment` choosing the gateway from
 * the `payment_method` the customer recorded. This script puts an agent into
 * the wanted state and is safe to run again: a second run says "already".
 *
 * WHAT IT WRITES, in order
 *   1. The switches. `paymentMethods` lists exactly the methods this agent has,
 *      with the customer-facing names. Noqodi is ON only with --enable; the card
 *      and Virtual IBAN keep whatever position they already hold. A method the
 *      agent does not have is dropped — NXN had Virtual IBAN switched on, and
 *      has no bank-transfer route, so the model was being told to offer one.
 *   2. The gateway binding, when told how (--base-url, --merchant, --host) or
 *      when --enable needs one. Field by field, because jsonb reorders keys.
 *   3. The `payment_method` field's options, wherever a journey has one: the
 *      card is relabelled, Noqodi is added with --enable and removed without.
 *   4. The journey guidance: the sentence that names the buttons is rewritten
 *      to two or three choices, and the Noqodi paragraph — prices computed from
 *      THIS environment's journey amount and card-only surcharge — is written
 *      with --enable and cut without, so the prompt never mentions a method
 *      that is switched off.
 *
 * WHERE THE CHAT CANNOT OFFER IT YET. Emirates Post's rentals and renewals pay
 * on Emirates Post's own gateway: their Save opens the payment and their
 * UpdatePayment / ConfirmPayment checks THAT gateway, so a payment we took on
 * Noqodi cannot be confirmed to them. NXN therefore gets the switch (off) and
 * the binding, and no field or guidance, until Emirates Post can either hand
 * us a UAE Pay link or accept an external payment reference
 * (docs/NXN-UAEPAY-ASK-2026-10-07.md). Run with --enable on NXN and it refuses.
 *
 * PRODUCTION REFUSES UAT. The UAT merchant and host are the defaults, which is
 * right for staging and a live customer sent to a sandbox on production. An
 * agent whose activeEnvironment is production must be given --base-url and
 * --merchant that are not the UAT ones (or --allow-uat, deliberately).
 *
 * Run from apps/web:
 *   npx tsx scripts/uaepay-rollout-2026-10-07.ts --env <file> --agent epgl-dialog --host https://7xagents.7x-lab.com --enable
 *   npx tsx scripts/uaepay-rollout-2026-10-07.ts --env <file> --agent nxn-dialog  --host https://7xagents.7x-lab.com --base-url https://uat-api.uaepay.ae --merchant MR123093
 *   npx tsx scripts/uaepay-rollout-2026-10-07.ts --env <prod> --agent epgl-dialog --host https://agent.7x.ae --base-url https://api.uaepay.ae --merchant <prod code> --enable
 * Add --dry-run to see the plan without writing. The environment it runs
 * against needs UAEPAY_CLIENT_ID and UAEPAY_CLIENT_SECRET in its app settings
 * before --enable means anything: the binding names them, it does not hold them.
 */
import { pathToFileURL } from "node:url";
import dns from "node:dns/promises";
import pg from "pg";
import { databaseUrlFrom } from "./lib/envFile";

export const METHOD = "uaepay";
export const UAT = { baseUrl: "https://uat-api.uaepay.ae", merchant: "MR123093" };

/** The names the customer is given, in both languages. */
export const LABELS: Record<string, { en: string; ar: string }> = {
  gateway: { en: "Pay with Card", ar: "الدفع بالبطاقة" },
  viban: { en: "Bank transfer (Virtual IBAN)", ar: "تحويل بنكي (آيبان افتراضي)" },
  uaepay: { en: "Pay with Noqodi (UAE Pay)", ar: "الدفع عبر نقودي (UAE Pay)" },
};

/**
 * Which methods each agent actually has, and whether the chat can offer the
 * choice. The chat can offer it only where OUR checkout takes the money.
 */
export const PROFILES: Record<string, { methods: string[]; offerInChat: boolean; why?: string }> = {
  "epgl-dialog": { methods: ["gateway", "viban", "uaepay"], offerInChat: true },
  "nxn-dialog": {
    methods: ["gateway", "uaepay"],
    offerInChat: false,
    why: "Emirates Post's Save opens the payment on THEIR gateway and their confirm step checks it; a Noqodi payment we took cannot be confirmed to them yet",
  },
};
const DEFAULT_PROFILE: { methods: string[]; offerInChat: boolean; why?: string } = { methods: ["gateway", "uaepay"], offerInChat: true };

export interface RolloutOptions {
  enable: boolean;
  host?: string;
  baseUrl?: string;
  merchant?: string;
  allowUat?: boolean;
}

const money = (n: number) => `AED ${n.toLocaleString("en-US")}`;

/** The sentence in the PAYMENT OPTIONS block that names the buttons, in either of its states. */
const CHOICES_RE =
  /A ```buttons block with exactly (?:two|three) choices: [^.]*\. Record the answer with collect_field\(payment_method, gateway\)[^.]*\./;
function choicesSentence(enabled: boolean): string {
  return enabled
    ? `A \`\`\`buttons block with exactly three choices: "${LABELS.gateway!.en}", "${LABELS.uaepay!.en}" and "${LABELS.viban!.en}". Record the answer with collect_field(payment_method, gateway), collect_field(payment_method, uaepay) or collect_field(payment_method, viban).`
    : `A \`\`\`buttons block with exactly two choices: "${LABELS.gateway!.en}" and "${LABELS.viban!.en}". Record the answer with collect_field(payment_method, gateway) or collect_field(payment_method, viban).`;
}

/** The Noqodi paragraph, in any version written since 2 October, so a re-run replaces rather than stacks. */
export const MARKER = "UAEPAY IS THE THIRD WAY TO PAY";
const BLOCK_RE = /\s*UAEPAY IS THE THIRD WAY TO PAY[\s\S]*?do not mention (?:UAEPay|Noqodi)(?: \(UAE Pay\))?\./;

export function noqodiGuidance(base: number, onlineFee: number): string {
  const card = base + onlineFee;
  return (
    ` ${MARKER} — to the customer it is "${LABELS.uaepay!.en}", never "UAEPay" alone — and it costs LESS than the card: the licence fee is ${money(base)} and Noqodi adds no online payment fee, so a Noqodi (UAE Pay) payment is ${money(base)} while a card payment is ${money(card)}.` +
    ` State all three prices when you present the choice — ${LABELS.gateway!.en} ${money(card)}, ${LABELS.uaepay!.en} ${money(base)}, ${LABELS.viban!.en} ${money(base)} — rather than mentioning the fee only after they have chosen.` +
    ` NOQODI (UAE PAY) IS TAKEN EXACTLY LIKE THE CARD: record collect_field(payment_method, uaepay), then call request_payment and the secure payment card appears in the chat by itself; it opens the UAE Pay page, where they pay with their noqodi wallet, a card or their bank. Never paste a link.` +
    ` Noqodi (UAE Pay) is for SIGNED-IN applicants only: it requires the payer's Emirates ID, which comes from their UAE PASS sign-in and is never something to ask them for. If the applicant is not signed in, offer card and Virtual IBAN only and do not mention Noqodi.`
  );
}

type Def = Record<string, any>;

/**
 * The whole change, as a pure function of the definition and the options —
 * so it can be tested on a fixture and so --dry-run shows exactly what a
 * write would do.
 */
export function applyRollout(input: Def, opts: RolloutOptions): { def: Def; changes: string[] } {
  const def = JSON.parse(JSON.stringify(input)) as Def;
  const changes: string[] = [];
  const slug = String(def.slug ?? "");
  const profile = PROFILES[slug] ?? DEFAULT_PROFILE;
  const offer = opts.enable && profile.offerInChat;

  if (opts.enable && !profile.offerInChat) {
    throw new Error(`${slug}: Noqodi cannot be switched on here yet — ${profile.why}. Run without --enable to prepare the switch and the binding.`);
  }

  // 1. The switches: exactly this agent's methods, named for the customer.
  const had: any[] = Array.isArray(def.paymentMethods) ? def.paymentMethods : [];
  const wanted = profile.methods.map((key) => {
    const stored = had.find((m) => m?.key === key);
    const enabled = key === METHOD ? opts.enable : stored ? stored.enabled !== false : true;
    const entry: Record<string, unknown> = { key, label: LABELS[key] ?? stored?.label ?? { en: key, ar: key }, enabled };
    if (stored?.note) entry.note = stored.note;
    return entry;
  });
  for (const m of had) if (!profile.methods.includes(m?.key)) changes.push(`paymentMethods -= ${m.key} (this agent has no such route)`);
  if (JSON.stringify(canon(had)) !== JSON.stringify(canon(wanted))) {
    changes.push(`paymentMethods = ${wanted.map((m) => `${m.key}:${m.enabled ? "on" : "off"}`).join(", ")}`);
    def.paymentMethods = wanted;
  }

  // 2. The binding, when told how or when switching on needs one.
  def.integrations ??= {};
  const existing = def.integrations.paymentGateways?.[METHOD] as Record<string, any> | undefined;
  const wantsBinding = opts.enable || opts.baseUrl !== undefined || opts.merchant !== undefined;
  if (wantsBinding) {
    const baseUrl = (opts.baseUrl ?? existing?.settings?.baseUrl ?? UAT.baseUrl).replace(/\/$/, "");
    const merchant = opts.merchant ?? existing?.settings?.merchantCode ?? UAT.merchant;
    const host = (opts.host ?? "").replace(/\/$/, "");
    const returnUrl = host ? `${host}/api/payments/return` : existing?.settings?.returnUrl;
    if (!returnUrl) throw new Error("Pass --host https://… — a payment with no return URL strands the customer on the UAE Pay page");
    const isUat = /(^|\/\/)uat-/.test(baseUrl) || merchant === UAT.merchant;
    if (String(def.activeEnvironment ?? "production") === "production" && isUat && !opts.allowUat) {
      throw new Error(`${slug} is a production agent and ${baseUrl} / ${merchant} are the UAT gateway and merchant. Pass the production --base-url and --merchant from Noqodi's onboarding (or --allow-uat, deliberately).`);
    }
    const binding = {
      provider: METHOD,
      settings: { baseUrl, merchantCode: merchant, returnUrl },
      secretRefs: ["UAEPAY_CLIENT_ID", "UAEPAY_CLIENT_SECRET"],
    };
    const same =
      existing?.provider === binding.provider &&
      JSON.stringify([...(existing?.secretRefs ?? [])].sort()) === JSON.stringify([...binding.secretRefs].sort()) &&
      (["baseUrl", "merchantCode", "returnUrl"] as const).every((k) => existing?.settings?.[k] === binding.settings[k]);
    if (!same) {
      def.integrations.paymentGateways ??= {};
      def.integrations.paymentGateways[METHOD] = binding;
      changes.push(`integrations.paymentGateways.${METHOD} -> ${merchant} at ${baseUrl}, returning to ${returnUrl}`);
    }
  } else if (opts.enable && !existing) {
    throw new Error("Switching Noqodi on needs a gateway binding: pass --base-url, --merchant and --host");
  }

  // 3 and 4. The field and the guidance, where the chat offers the choice.
  for (const j of def.journeys ?? []) {
    let hasField = false;
    for (const step of j.steps ?? []) {
      for (const f of step.fields ?? []) {
        if (f?.key !== "payment_method") continue;
        hasField = true;
        if (!profile.offerInChat) continue;
        const options: any[] = Array.isArray(f.options) ? f.options : [];
        const next: any[] = [];
        for (const o of options) {
          const value = typeof o === "string" ? o : o?.value;
          if (value === METHOD && !offer) { changes.push(`${j.key}: payment_method -= ${METHOD}`); continue; }
          next.push(typeof o === "string" ? o : LABELS[value] ? { ...o, label: LABELS[value] } : o);
        }
        if (offer && !next.some((o) => (typeof o === "string" ? o : o?.value) === METHOD)) {
          next.push(typeof next[0] === "string" ? METHOD : { value: METHOD, label: LABELS[METHOD] });
          changes.push(`${j.key}: payment_method += ${METHOD}`);
        }
        if (JSON.stringify(canon(options)) !== JSON.stringify(canon(next))) {
          if (!changes.some((c) => c.startsWith(`${j.key}: payment_method`))) changes.push(`${j.key}: payment_method options relabelled`);
          f.options = next;
        }
      }
    }
    if (!hasField || !profile.offerInChat) continue;

    let g = String(j.guidance ?? "");
    if (!g) continue;
    const before = g;
    g = g.replace(CHOICES_RE, choicesSentence(offer));
    const sub = (j.submission ?? {}) as Record<string, any>;
    const base = Number(sub.amount);
    const fee = Number((Array.isArray(sub.surcharges) ? sub.surcharges : []).find((x: any) => x?.key === "online_payment_fee")?.amount ?? 0);
    if (offer) {
      if (!Number.isFinite(base) || base <= 0) throw new Error(`${j.key}: no chargeable amount on the journey — the guidance would state a price nothing charges`);
      const para = noqodiGuidance(base, fee);
      g = BLOCK_RE.test(g) ? g.replace(BLOCK_RE, para) : g + para;
    } else {
      g = g.replace(BLOCK_RE, "");
    }
    if (g !== before) {
      j.guidance = g;
      changes.push(offer ? `${j.key}: guidance offers three ways — card ${money(base + fee)}, Noqodi ${money(base)}, Virtual IBAN ${money(base)}` : `${j.key}: guidance names two ways, Noqodi not mentioned`);
    }
  }
  if (!profile.offerInChat) changes.push(`(${slug}: no field or guidance written — ${profile.why})`);

  return { def, changes };
}

function canon(v: unknown): unknown {
  return Array.isArray(v)
    ? v.map(canon)
    : v && typeof v === "object"
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canon(x)]))
      : v;
}

/**
 * A pool that does not depend on this Mac's resolver.
 *
 * getaddrinfo intermittently answers ENOTFOUND for the Azure Postgres CNAME
 * chain while dig resolves it fine; resolving through c-ares and pinning the
 * address, with the hostname kept for TLS, sidesteps it. In CI or on Azure the
 * fallback is the hostname itself.
 */
async function poolFor(url: string): Promise<pg.Pool> {
  const u = new URL(url);
  let host = u.hostname;
  try {
    dns.setServers(["1.1.1.1", "8.8.8.8"]);
    host = (await dns.resolve4(u.hostname))[0] ?? host;
  } catch { /* use the hostname */ }
  return new pg.Pool({
    host,
    port: Number(u.port || 5432),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.slice(1),
    ssl: { servername: u.hostname, rejectUnauthorized: false },
  });
}

async function main() {
  const arg = (n: string) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : undefined; };
  const ENV = arg("--env"); const AGENT = arg("--agent");
  if (!ENV || !AGENT) throw new Error("--env <envfile> and --agent <slug> are required");
  const opts: RolloutOptions = {
    enable: process.argv.includes("--enable"),
    host: arg("--host"),
    baseUrl: arg("--base-url"),
    merchant: arg("--merchant"),
    allowUat: process.argv.includes("--allow-uat"),
  };
  const DRY = process.argv.includes("--dry-run");
  const pool = await poolFor(databaseUrlFrom(ENV));
  try {
    const { rows } = await pool.query(`select id, definition from agents where slug = $1`, [AGENT]);
    if (!rows.length) throw new Error(`No agent ${AGENT} in this database`);
    const { def, changes } = applyRollout(rows[0].definition, opts);
    console.log(`\n${AGENT} (${def.activeEnvironment ?? "production"}) — Noqodi ${opts.enable ? "ON" : "off"}`);
    const real = changes.filter((c) => !c.startsWith("("));
    for (const c of changes) console.log(`  ${c.startsWith("(") ? "  " : "~"} ${c}`);
    if (!real.length) { console.log("\nAlready applied — nothing to change."); return; }
    if (DRY) { console.log(`\n--dry-run: ${real.length} change(s) NOT written.`); return; }
    await pool.query(`update agents set definition = $1::jsonb where id = $2`, [JSON.stringify(def), rows[0].id]);
    console.log(`\n${real.length} change(s) written.`);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(() => process.exit(0)).catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
}
