/**
 * The PO Box sandbox agent: a copy of the live NXN agent for the A2A doorway.
 *
 * Why a copy and not the agent itself: the sandbox runs with a simulated
 * Emirates Post session and a payable mock checkout, and its conversations are
 * an integrator's tests, not customers. Keeping them on their own agent keeps
 * them out of Emirates Post's transcripts and analytics.
 *
 * What is copied: the whole definition (journeys, guidance, tools, theme) and
 * every integration row (Emirates Post staging, EMX tracking), secrets included
 * as stored — the same SECRETS_KEY decrypts them. What changes: the slug and
 * name, the active environment (staging), and the payment bindings, which go
 * to the mock gateway so the Noqodi path lands on the mock checkout too.
 * `tenantSlug` stays "nxn": a dozen NXN behaviours key on it.
 *
 * Idempotent and re-runnable: a second run re-syncs the copy from the source.
 *
 * From apps/web:
 *   npx tsx scripts/create-sandbox-agent-2026-10-14.ts --env <file>            (dry run)
 *   npx tsx scripts/create-sandbox-agent-2026-10-14.ts --env <file> --apply
 * Options: --source nxn-dialog  --slug po-box-sandbox
 */
import { databaseUrlFromArgs } from "./lib/envFile";
import { poolFor } from "./lib/pgPool";

const arg = (n: string, d: string) => {
  const i = process.argv.indexOf(n);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1]! : d;
};
const APPLY = process.argv.includes("--apply");
const SOURCE = arg("--source", "nxn-dialog");
const SLUG = arg("--slug", "po-box-sandbox");
const NAME = "Emirates Post PO Box (Sandbox)";

type Def = Record<string, any>;

/** The definition of the copy, from the definition of the source. Pure, for tests. */
export function sandboxDefinition(source: Def, slug: string): Def {
  const def: Def = JSON.parse(JSON.stringify(source));
  def.slug = slug;
  def.name = NAME;
  def.activeEnvironment = "staging";
  def.integrations = {
    ...(def.integrations ?? {}),
    payment: { provider: "mock", settings: {}, secretRefs: [] },
    paymentGateways: { uaepay: { provider: "mock", settings: {}, secretRefs: [] } },
  };
  if (def.theme && typeof def.theme === "object") {
    def.theme = { ...def.theme, brandName: `${def.theme.brandName ?? "Emirates Post"} · Sandbox` };
  }
  return def;
}

async function main() {
  const pool = await poolFor(databaseUrlFromArgs());
  try {
    const { rows: src } = await pool.query(`select id, tenant_id, name, status, definition from agents where slug = $1`, [SOURCE]);
    const source = src[0];
    if (!source) throw new Error(`source agent "${SOURCE}" not found`);
    const def = sandboxDefinition(source.definition, SLUG);
    const { rows: ints } = await pool.query(`select name, environments, enabled from agent_integrations where agent_id = $1`, [source.id]);
    const { rows: tgt } = await pool.query(`select id from agents where slug = $1`, [SLUG]);
    console.log(`source ${SOURCE} (${source.id}) · ${ints.length} integration row(s): ${ints.map((r) => `"${r.name}"`).join(", ")}`);
    console.log(`target ${SLUG}: ${tgt[0] ? `exists (${tgt[0].id}), will re-sync` : "will be created"}`);
    console.log(`definition: ${def.journeys?.length ?? 0} journeys, payment → mock, uaepay → mock, activeEnvironment staging`);
    if (!APPLY) {
      console.log("\nDry run. Add --apply to write.");
      return;
    }
    await pool.query("begin");
    let targetId: string;
    if (tgt[0]) {
      targetId = tgt[0].id;
      await pool.query(`update agents set definition = $1::jsonb, name = $2, status = 'live', tenant_id = $3, updated_at = now() where id = $4`, [
        JSON.stringify(def),
        NAME,
        source.tenant_id,
        targetId,
      ]);
    } else {
      const { rows } = await pool.query(
        `insert into agents (tenant_id, slug, name, status, definition) values ($1, $2, $3, 'live', $4::jsonb) returning id`,
        [source.tenant_id, SLUG, NAME, JSON.stringify(def)]
      );
      targetId = rows[0].id;
    }
    await pool.query(`delete from agent_integrations where agent_id = $1`, [targetId]);
    for (const r of ints) {
      await pool.query(`insert into agent_integrations (agent_id, name, environments, enabled) values ($1, $2, $3::jsonb, $4)`, [
        targetId,
        r.name,
        JSON.stringify(r.environments ?? {}),
        r.enabled,
      ]);
    }
    await pool.query(
      `insert into audit_log (agent_id, actor, action, payload) values ($1, 'system', 'sandbox_agent_synced', $2::jsonb)`,
      [targetId, JSON.stringify({ by: "script:create-sandbox-agent-2026-10-14", source: SOURCE, integrations: ints.map((r) => r.name) })]
    );
    await pool.query("commit");
    console.log(`\nApplied. ${SLUG} = ${targetId}`);
  } catch (e) {
    await pool.query("rollback").catch(() => {});
    throw e;
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
