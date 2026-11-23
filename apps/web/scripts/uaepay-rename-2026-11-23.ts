/**
 * "Noqodi (UAE Pay)" is now "UAE PAY" to the customer (Emre, 2026-11-23), on
 * nxn-dialog, epgl-dialog and epgl-dialog-2: the payment method's label, the
 * payment_method field's option, and every mention in the journey guidance.
 *
 * Lower-case "noqodi" is left alone: it is the wallet the UAE Pay page offers
 * ("pay with their noqodi wallet, a card or their bank"), not the button's name.
 * The NXN guidance block markers keep their spelling, so
 * nxn-noqodi-via-backend-2026-11-23.ts still finds its block.
 *
 * Safe to run again. Run from apps/web:
 *   npx tsx scripts/uaepay-rename-2026-11-23.ts --env <file> [--dry-run]
 */
import { pathToFileURL } from "node:url";
import dns from "node:dns/promises";
import pg from "pg";
import { databaseUrlFrom } from "./lib/envFile";

export const AGENTS = ["nxn-dialog", "epgl-dialog", "epgl-dialog-2"];
const PROTECT = ["<!--nxn:NOQODI VIA EMIRATES POST", "<!--/nxn:NOQODI VIA EMIRATES POST"];

/** Rename every customer-facing "Noqodi" in one string. */
export function renameText(s: string): string {
  let out = s;
  PROTECT.forEach((p, i) => { out = out.split(p).join(`\u0000${i}\u0000`); });
  out = out
    .split("الدفع عبر نقودي (UAE Pay)").join("الدفع عبر UAE PAY")
    .split("عبر نقودي (UAE Pay)").join("عبر UAE PAY")
    .split("نقودي (UAE Pay)").join("UAE PAY")
    .split("Noqodi (UAE Pay)").join("UAE PAY")
    .split("NOQODI (UAE PAY)").join("UAE PAY")
    .replace(/(?<![A-Za-z_])Noqodi(?![A-Za-z_])/g, "UAE PAY")
    .replace(/(?<![A-Za-z_])NOQODI(?![A-Za-z_])/g, "UAE PAY");
  PROTECT.forEach((p, i) => { out = out.split(`\u0000${i}\u0000`).join(p); });
  return out;
}

export function renameDefinition(def: unknown): { def: unknown; count: number } {
  let count = 0;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") { const r = renameText(v); if (r !== v) count++; return r; }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return { def: walk(def), count };
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
    for (const slug of AGENTS) {
      const { rows } = await pool.query(`select id, definition from agents where slug = $1`, [slug]);
      if (!rows.length) { console.log(`${slug}: not in this database`); continue; }
      const { def, count } = renameDefinition(rows[0].definition);
      if (!count) { console.log(`${slug}: already applied`); continue; }
      if (DRY) { console.log(`${slug}: ${count} string(s) would change (--dry-run)`); continue; }
      await pool.query(`update agents set definition = $1::jsonb where id = $2`, [JSON.stringify(def), rows[0].id]);
      console.log(`${slug}: ${count} string(s) renamed`);
    }
  } finally {
    await pool.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
}
