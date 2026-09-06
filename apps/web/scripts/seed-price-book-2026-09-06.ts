/**
 * Carry the measured price book from staging to production.
 *
 * The duration cards can only price a term Emirates Post has been SEEN to
 * charge for: Rental/Bundle publishes one year and null for everything longer,
 * and the annual rate does not scale — MyHome Instant's five years is 4,000, not
 * 4,975. Every one of those figures was learned by reserving a box and reading
 * the price back, and the reservations that taught us live in staging's audit
 * log. Production has its own, which is nearly empty, so on production every
 * multi-year term would show no price at all on day one.
 *
 * So the observations travel. Each row says what it is and where it came from,
 * and production's own first reservation of a term overwrites the seeded one —
 * the price book takes the NEWEST row for a bundle and term, so a real
 * production charge always wins over anything seeded here.
 *
 * It writes audit rows and nothing else: no agent definition, no integration, no
 * customer data. Dry run unless --apply.
 *
 * Run from apps/web:
 *   npx tsx scripts/seed-price-book-2026-09-06.ts --from <env> --to <env> [--apply]
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { agents, auditLog } from "@dialog/db";
import { eq, and, inArray, desc, sql } from "drizzle-orm";
import { rentInSelectResponse, feesInSelectResponse } from "../lib/registrationFees";

const arg = (n: string) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : undefined; };
const FROM = arg("--from"), TO = arg("--to"), APPLY = process.argv.includes("--apply");
if (!FROM || !TO) throw new Error("--from <envfile> and --to <envfile> are both required");

const urlFrom = (f: string) => {
  const m = /^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m.exec(readFileSync(resolve(f), "utf8"));
  if (!m) throw new Error(`no DATABASE_URL in ${f}`);
  return m[1]!;
};
const connect = (f: string) => {
  const pool = new pg.Pool({ connectionString: urlFrom(f) });
  return { db: drizzle(pool, { schema: { agents, auditLog } }), pool };
};

async function main() {
  const src = connect(FROM!), dst = connect(TO!);
  try {
    const [sa] = await src.db.select().from(agents).where(eq(agents.slug, "nxn-dialog")).limit(1);
    const [ta] = await dst.db.select().from(agents).where(eq(agents.slug, "nxn-dialog")).limit(1);
    if (!sa || !ta) throw new Error("nxn-dialog is missing from one side");

    const rows = await src.db
      .select({ payload: auditLog.payload, createdAt: auditLog.createdAt })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.agentId, sa.id),
          inArray(auditLog.action, ["integration_write", "registration_fee_observed"]),
          sql`${auditLog.payload}->>'path' ilike '%Rental/Select%'`
        )
      )
      .orderBy(desc(auditLog.createdAt))
      .limit(400);

    // The newest observation for each bundle and term, and nothing else: one row
    // per price, so production's log gains a price book rather than a history.
    const best = new Map<string, { payload: Record<string, unknown>; at: Date; rent: number }>();
    for (const r of rows) {
      const p = (r.payload ?? {}) as Record<string, unknown>;
      const response = typeof p.response === "string" ? p.response : "";
      if (!response) continue;
      const rents = new Map<string, number>([
        ...Object.entries((p.rents ?? {}) as Record<string, unknown>)
          .map(([k, v]) => [k, Number(v)] as [string, number])
          .filter(([, v]) => Number.isFinite(v) && v > 0),
        ...rentInSelectResponse(response, r.createdAt ?? new Date()),
      ]);
      for (const [key, rent] of rents) {
        const seen = best.get(key);
        if (!seen || (r.createdAt ?? new Date()) > seen.at) {
          best.set(key, { payload: p, at: r.createdAt ?? new Date(), rent });
        }
      }
    }

    console.log(`${best.size} priced term(s) to carry across:\n`);
    for (const [key, v] of [...best].sort()) console.log(`  ${key.padEnd(14)} rent ${v.rent}`);

    if (!APPLY) { console.log("\nDry run — nothing written. Add --apply."); return; }
    let written = 0;
    for (const [key, v] of best) {
      const p = v.payload;
      await dst.db.insert(auditLog).values({
        agentId: ta.id,
        actor: "system",
        action: "registration_fee_observed",
        payload: {
          tool: p.tool,
          method: "POST",
          path: "/api/Rental/Select",
          input: p.input,
          response: p.response,
          fees: Object.fromEntries(feesInSelectResponse(String(p.response ?? ""))),
          rents: Object.fromEntries(rentInSelectResponse(String(p.response ?? ""), v.at)),
          note:
            `Price observed on STAGING (${key}, rent ${v.rent}) on ${v.at.toISOString().slice(0, 10)} and seeded here by ` +
            "scripts/seed-price-book-2026-09-06 so the duration cards can price this term on day one. " +
            "Not a customer rental, and not a production reservation. A real production reservation of the same " +
            "bundle and term is newer and takes precedence automatically.",
        },
      });
      written++;
    }
    console.log(`\n${written} observation(s) written.`);
  } finally {
    await src.pool.end();
    await dst.pool.end();
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
