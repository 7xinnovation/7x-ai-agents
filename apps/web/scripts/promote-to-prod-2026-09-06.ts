/**
 * Bring production's CONTENT up to staging, and fix what only production has wrong.
 *
 * The code deploys to both hosts from git; the agent definitions and the
 * knowledge base live in each environment's own database and do not travel with
 * it. Production's definitions were last written on 12-13 August, so every round
 * of Emirates Post and EPGL feedback since then exists on staging alone.
 *
 * WHAT MOVES — content, and only content:
 *   journey guidance, steps, title, intent, summary, requiresAuth
 *   persona, greeting, guardrails, theme, intents, locales
 *   documentsInChat, uploadsPerMessage, progressPlacement
 *   knowledge base documents and their chunks
 *
 * WHAT NEVER MOVES, because it names an environment:
 *   activeEnvironment · allowedOrigins · hostLoginUrl · integrations
 *   journey.submission — its apiFlow names the staging integration's tools and
 *   carries the payment binding set deliberately on production. Copying it would
 *   point the live gateway at the sandbox.
 *
 * WHAT IS FIXED IN PLACE on production, because it is wrong there and only there:
 *   paymentReturnUrl — production still returns customers to the STAGING host
 *   after they pay, so the page that tells the chat they are back is on the
 *   wrong origin and cannot reach it.
 *   apiFlow.saveTool — recorded without its integration prefix, so the
 *   submission it is supposed to mark is never recognised.
 *
 * Prints a full diff and writes nothing without --apply.
 *
 * Run from apps/web:
 *   npx tsx scripts/promote-to-prod-2026-09-06.ts --from <env> --to <env> [--apply]
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const FROM = arg("--from");
const TO = arg("--to");
const APPLY = process.argv.includes("--apply");
const ONLY = arg("--only");
if (!FROM || !TO) throw new Error("--from <envfile> and --to <envfile> are both required");

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { agents, kbDocuments, kbChunks } from "@dialog/db";
import { eq } from "drizzle-orm";

function urlFrom(file: string): string {
  const txt = readFileSync(resolve(file), "utf8");
  const m = /^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m.exec(txt);
  if (!m) throw new Error(`no DATABASE_URL in ${file}`);
  return m[1]!;
}
const connect = (file: string) => {
  const pool = new pg.Pool({ connectionString: urlFrom(file) });
  return { db: drizzle(pool, { schema: { agents, kbDocuments, kbChunks } }), pool };
};

/** Top-level definition keys that are content, not environment. */
const TOP = [
  "persona", "greeting", "guardrails", "theme", "intents", "locales",
  "documentsInChat", "documentsDisclaimer", "uploadsPerMessage", "progressPlacement",
] as const;
/** Per-journey keys that are content. `submission` is deliberately absent. */
const JOURNEY = ["title", "intent", "guidance", "steps", "summary", "requiresAuth"] as const;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

async function main() {
  const src = connect(FROM!);
  const dst = connect(TO!);
  try {
    const from = await src.db.select().from(agents);
    const to = await dst.db.select().from(agents);
    const bySlug = new Map(to.map((r) => [r.slug, r]));
    // The host production actually answers on, for anything that has to come
    // back to us after leaving the site.
    const prodHost = (arg("--host") ?? "https://agent.7x.ae").replace(/\/$/, "");

    for (const s of from) {
      if (ONLY && s.slug !== ONLY) continue;
      const t = bySlug.get(s.slug);
      if (!t) { console.log(`\n${s.slug}: NOT PRESENT in the target — skipped.`); continue; }
      const sd = s.definition as unknown as Record<string, any>;
      const td = JSON.parse(JSON.stringify(t.definition)) as Record<string, any>;
      const changes: string[] = [];

      for (const k of TOP) if (k in sd && !same(sd[k], td[k])) { td[k] = sd[k]; changes.push(k); }

      const sj = new Map<string, any>((sd.journeys ?? []).map((j: any) => [j.key, j]));
      for (const j of td.journeys ?? []) {
        const from_ = sj.get(j.key);
        if (from_) {
          for (const k of JOURNEY) {
            if (k in from_ && !same(from_[k], j[k])) {
              const size = k === "guidance" ? ` (${String(j[k] ?? "").length} → ${String(from_[k] ?? "").length} chars)` : "";
              j[k] = from_[k];
              changes.push(`${j.key}.${k}${size}`);
            }
          }
        }
        // Fixed in place, never copied: production's own binding, corrected.
        const flow = j.submission?.apiFlow;
        if (flow) {
          if (flow.paymentReturnUrl && !String(flow.paymentReturnUrl).startsWith(prodHost)) {
            const was = flow.paymentReturnUrl;
            flow.paymentReturnUrl = `${prodHost}/api/payments/ext-return`;
            changes.push(`${j.key}.paymentReturnUrl (${was} → ${flow.paymentReturnUrl})`);
          }
          // The saveTool must be the tool's FULL name or the submission it marks
          // is never recognised: the orchestrator compares it to the tool called.
          if (flow.saveTool && !flow.saveTool.includes("__")) {
            const real = (from_?.submission?.apiFlow?.saveTool ?? "") as string;
            if (real.endsWith(flow.saveTool)) {
              changes.push(`${j.key}.saveTool (${flow.saveTool} → ${real})`);
              flow.saveTool = real;
            }
          }
        }
      }

      if (!changes.length) { console.log(`\n${s.slug}: already identical.`); continue; }
      console.log(`\n${s.slug}: ${changes.length} change(s)`);
      for (const c of changes) console.log(`   ~ ${c}`);
      if (APPLY) {
        await dst.db.update(agents).set({ definition: td as never }).where(eq(agents.id, t.id));
        console.log("   written.");
      }
    }

    // ── Knowledge base ──────────────────────────────────────────────────────
    console.log("\nKnowledge base");
    for (const s of from) {
      if (ONLY && s.slug !== ONLY) continue;
      const t = bySlug.get(s.slug);
      if (!t) continue;
      const srcDocs = await src.db.select().from(kbDocuments).where(eq(kbDocuments.agentId, s.id));
      const dstDocs = await dst.db.select().from(kbDocuments).where(eq(kbDocuments.agentId, t.id));
      const have = new Set(dstDocs.map((d) => d.title));
      const missing = srcDocs.filter((d) => !have.has(d.title));
      if (!missing.length) { console.log(`  ${s.slug}: all ${srcDocs.length} document(s) present.`); continue; }
      console.log(`  ${s.slug}: ${missing.length} document(s) missing — ${missing.map((d) => d.title).join(" · ")}`);
      if (!APPLY) continue;
      for (const d of missing) {
        const chunks = await src.db.select().from(kbChunks).where(eq(kbChunks.documentId, d.id));
        const [created] = await dst.db
          .insert(kbDocuments)
          .values({ ...d, id: undefined as never, agentId: t.id })
          .returning();
        if (!created) continue;
        for (const c of chunks) {
          await dst.db.insert(kbChunks).values({ ...c, id: undefined as never, documentId: created.id });
        }
        console.log(`    + ${d.title} (${chunks.length} chunk(s))`);
      }
    }

    console.log(APPLY ? "\nApplied." : "\nDry run — nothing written. Add --apply to write.");
  } finally {
    await src.pool.end();
    await dst.pool.end();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
