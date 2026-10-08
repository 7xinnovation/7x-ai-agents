/**
 * The knowledge base names Noqodi beside the card and the Virtual IBAN (2026-10-08).
 *
 * Asked cold on staging — "which ways can I pay the licence fee, and how much
 * is each?" — the agent answered from the knowledge base and listed Noqodi
 * (UAE Pay) with no price, because the six chunks that carry the fee were last
 * rewritten on 1 October, before Noqodi was a way to pay. The journey guidance
 * states all three prices when it presents the choice; this makes the cold
 * answer agree with it.
 *
 * Only the fee parenthetical is extended, in place, in both languages. As with
 * the 1 October script, embeddings are NOT regenerated: the sentence around the
 * figure is unchanged and the vector still finds the chunk it always found.
 *
 * Run where Noqodi is switched ON for the agent — staging today; production on
 * the day the switch is flipped there (docs/UAEPAY-ROLLOUT-2026-10-07.md). A
 * knowledge base that names a method the agent refuses would be worse than one
 * that omits it.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/epgl-kb-noqodi-2026-10-08.ts --env <file> [--dry-run]
 */
import { pathToFileURL } from "node:url";
import dns from "node:dns/promises";
import pg from "pg";
import { databaseUrlFrom } from "./lib/envFile";

export const SLUG = "epgl-dialog";

/** Each rule: the parenthetical as the 1 October script left it, and the same with Noqodi named. */
export const RULES: { find: string; replace: string }[] = [
  {
    find: "(AED 100,000, or AED 101,000 if paid by card, which adds an online payment fee of AED 1,000)",
    replace: "(AED 100,000 with Noqodi (UAE Pay) or by Virtual IBAN, or AED 101,000 if paid by card, which adds an online payment fee of AED 1,000)",
  },
  {
    find: "(AED 101,000 if paid by card, which adds an online payment fee of AED 1,000)",
    replace: "(AED 101,000 if paid by card, which adds an online payment fee of AED 1,000; AED 100,000 with Noqodi (UAE Pay) or by Virtual IBAN)",
  },
  {
    find: "(101,000 درهم عند الدفع بالبطاقة، شاملاً رسم الدفع الإلكتروني البالغ 1,000 درهم)",
    replace: "(101,000 درهم عند الدفع بالبطاقة، شاملاً رسم الدفع الإلكتروني البالغ 1,000 درهم؛ و100,000 درهم عند الدفع عبر نقودي (UAE Pay) أو بالتحويل البنكي)",
  },
];

export function rewrite(content: string): string {
  if (/noqodi|نقودي/i.test(content)) return content;
  let next = content;
  for (const r of RULES) next = next.split(r.find).join(r.replace);
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
    const { rows } = await pool.query(
      `select c.id, c.content, d.title, d.locale from kb_chunks c join kb_documents d on d.id = c.document_id join agents a on a.id = c.agent_id where a.slug = $1 and (c.content like '%101,000%')`,
      [SLUG]
    );
    console.log(`\n${SLUG} knowledge base — ${rows.length} chunk(s) carry the card figure`);
    let changes = 0;
    for (const r of rows) {
      const next = rewrite(r.content);
      if (next === r.content) { console.log(`  (already) ${r.title} [${r.locale}]`); continue; }
      console.log(`  ~ ${r.title} [${r.locale}]`);
      changes++;
      if (!DRY) await pool.query(`update kb_chunks set content = $1 where id = $2`, [next, r.id]);
    }
    if (!changes) { console.log("\nAlready applied — nothing to change."); return; }
    console.log(DRY ? `\n--dry-run: ${changes} chunk(s) NOT written.` : `\n${changes} chunk(s) written.`);
  } finally { await pool.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(() => process.exit(0)).catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
}
