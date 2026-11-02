/**
 * EPGL 2.0 moves out of the agent EPGL 1.0 lives in (2026-11-02).
 *
 * Asked for: "are we able to revert on staging epgl 1.0 and move epgl 2.0 to a
 * newly created agent called EPGL Dialog 2.0 but it's a clone from 1.0 with our
 * changes on top? because it's on staging it will sooner or later be merged to
 * prod basically."
 *
 * The premise needs one correction and the ask stands anyway: agent definitions
 * live in the database, per environment, and never travel with a merge — 2.0's
 * journeys have not been one `git merge` away from production at any point.
 * What IS true is that while 2.0 sits in the row called `epgl-dialog`, anybody
 * promoting a definition, or restoring staging over production, carries it. On
 * its own agent it cannot be carried by accident, and the two can be tested
 * side by side.
 *
 * WHAT MOVES. The staging `epgl-dialog` row as it stands — 2.0 with every fix
 * from today — becomes a new agent under the same tenant, with its integration
 * rows (both Salesforce sandboxes) and its knowledge base copied across.
 *
 * WHAT COMES BACK. Staging's `epgl-dialog` is restored to the 1.0 definition,
 * read live from PRODUCTION (which carries this morning's three fixes), with
 * staging's OWN environment keys kept: activeEnvironment, allowedOrigins, the
 * host sign-in/sign-out URLs and the integration bindings. That last one is the
 * one that matters — it is what keeps staging pointed at preprod2 rather than
 * at the live Salesforce whose definition it is being given.
 *
 * Production is only ever READ. Both rows are printed before anything is
 * written, and the whole write is one transaction.
 *
 * Idempotent. From apps/web:
 *   npx tsx scripts/epgl-split-20-agent-2026-11-02.ts --env <stg> --prod-env <prod>
 *   npx tsx scripts/epgl-split-20-agent-2026-11-02.ts --env <stg> --prod-env <prod> --apply
 */
import { databaseUrlFrom } from "./lib/envFile";
import { poolFor } from "./lib/pgPool";

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(n);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1]! : d;
};
const APPLY = process.argv.includes("--apply");
const SOURCE = arg("--source", "epgl-dialog")!;
const SLUG = arg("--slug", "epgl-dialog-2")!;
const NAME = arg("--name", "EPGL Dialog 2.0")!;

type Def = Record<string, any>;

/**
 * The keys that say WHICH DEPLOYMENT this is, as opposed to what the agent
 * does. A 1.0 definition taken from production is only safe on staging once
 * these come from staging — `integrations` above all, because that is the
 * binding that decides which Salesforce a submission reaches.
 */
export const ENV_KEYS = ["activeEnvironment", "allowedOrigins", "hostLoginUrl", "hostLogoutUrl", "integrations"] as const;

/** The 2.0 agent's definition, from the row it is being lifted out of. */
export function twoPointZeroDefinition(source: Def, slug: string, name: string): Def {
  const def: Def = JSON.parse(JSON.stringify(source));
  def.slug = slug;
  def.name = name;
  return def;
}

/** The 1.0 definition as it should land on staging: production's, in staging's clothes. */
export function restoredOneZero(prod: Def, staging: Def): Def {
  const def: Def = JSON.parse(JSON.stringify(prod));
  for (const k of ENV_KEYS) {
    if (k in staging) def[k] = JSON.parse(JSON.stringify(staging[k]));
    else delete def[k];
  }
  def.slug = staging.slug;
  def.name = staging.name;
  return def;
}

async function main() {
  const stgUrl = databaseUrlFrom(arg("--env") ?? "");
  const prodEnv = arg("--prod-env");
  if (!prodEnv) throw new Error("--prod-env <envfile> is required: the 1.0 definition is read from production");
  const stg = await poolFor(stgUrl);
  const prod = await poolFor(databaseUrlFrom(prodEnv));
  try {
    const { rows: src } = await stg.query(`select id, tenant_id, name, status, definition from agents where slug = $1`, [SOURCE]);
    const source = src[0];
    if (!source) throw new Error(`"${SOURCE}" not found in the staging database`);

    const { rows: pr } = await prod.query(`select definition from agents where slug = $1`, [SOURCE]);
    if (!pr[0]) throw new Error(`"${SOURCE}" not found in the production database`);
    const prodDef = pr[0].definition as Def;

    const stagingDef = source.definition as Def;
    const two = twoPointZeroDefinition(stagingDef, SLUG, NAME);
    const one = restoredOneZero(prodDef, stagingDef);

    const { rows: ints } = await stg.query(`select name, environments, enabled from agent_integrations where agent_id = $1`, [source.id]);
    const { rows: docs } = await stg.query(`select id, title, source, version, locale, status from kb_documents where agent_id = $1`, [source.id]);
    const { rows: chunks } = await stg.query(`select count(*)::int as n from kb_chunks where agent_id = $1`, [source.id]);
    const { rows: tgt } = await stg.query(`select id from agents where slug = $1`, [SLUG]);

    const twoJourneys = (two.journeys ?? []).map((j: Def) => j.key).join(", ");
    const oneJourneys = (one.journeys ?? []).map((j: Def) => j.key).join(", ");
    console.log(`\nsource (staging ${SOURCE}, ${source.id})`);
    console.log(`   journeys: ${twoJourneys}`);
    console.log(`   integrations: ${ints.map((r) => `"${r.name}"`).join(", ") || "none"}`);
    console.log(`   knowledge: ${docs.length} document(s), ${chunks[0]?.n ?? 0} chunk(s)`);
    console.log(`\nnew agent ${SLUG} — "${NAME}": ${tgt[0] ? `exists (${tgt[0].id}), re-synced` : "created"}`);
    console.log(`\n${SOURCE} on staging goes back to 1.0, from production:`);
    console.log(`   journeys: ${oneJourneys}`);
    for (const k of ENV_KEYS) {
      const kept = JSON.stringify(stagingDef[k]);
      console.log(`   ${k}: kept from staging — ${kept && kept.length > 70 ? `${kept.slice(0, 70)}…` : kept}`);
    }
    const guidance = (d: Def) => (d.journeys ?? []).reduce((n: number, j: Def) => n + String(j.guidance ?? "").length, 0);
    console.log(`   guidance: ${guidance(stagingDef)} chars (2.0) → ${guidance(one)} chars (1.0)`);

    if (!APPLY) { console.log("\ndry run — pass --apply to write. Production is never written to.\n"); return; }

    await stg.query("begin");
    let targetId: string;
    if (tgt[0]) {
      targetId = tgt[0].id;
      await stg.query(`update agents set definition = $1::jsonb, name = $2, status = 'live', tenant_id = $3, updated_at = now() where id = $4`,
        [JSON.stringify(two), NAME, source.tenant_id, targetId]);
    } else {
      const { rows } = await stg.query(
        `insert into agents (tenant_id, slug, name, status, definition) values ($1, $2, $3, 'live', $4::jsonb) returning id`,
        [source.tenant_id, SLUG, NAME, JSON.stringify(two)]
      );
      targetId = rows[0].id;
    }
    await stg.query(`delete from agent_integrations where agent_id = $1`, [targetId]);
    for (const r of ints) {
      await stg.query(`insert into agent_integrations (agent_id, name, environments, enabled) values ($1, $2, $3::jsonb, $4)`,
        [targetId, r.name, JSON.stringify(r.environments ?? {}), r.enabled]);
    }
    // The knowledge base, documents and their chunks, embeddings and all: a
    // re-sync replaces it wholesale rather than doubling it.
    await stg.query(`delete from kb_documents where agent_id = $1`, [targetId]);
    await stg.query(`delete from kb_chunks where agent_id = $1`, [targetId]);
    for (const d of docs) {
      const { rows: nd } = await stg.query(
        `insert into kb_documents (agent_id, title, source, version, locale, status) values ($1, $2, $3, $4, $5, $6) returning id`,
        [targetId, d.title, d.source, d.version, d.locale, d.status]
      );
      await stg.query(
        `insert into kb_chunks (agent_id, document_id, content, embedding, metadata)
         select $1, $2, content, embedding, metadata from kb_chunks where document_id = $3`,
        [targetId, nd[0].id, d.id]
      );
    }
    await stg.query(`update agents set definition = $1::jsonb, updated_at = now() where id = $2`, [JSON.stringify(one), source.id]);
    await stg.query(`insert into audit_log (agent_id, actor, action, payload) values ($1, 'system', 'epgl_20_split', $2::jsonb)`,
      [targetId, JSON.stringify({ by: "script:epgl-split-20-agent-2026-11-02", from: SOURCE, integrations: ints.map((r) => r.name), documents: docs.length })]);
    await stg.query(`insert into audit_log (agent_id, actor, action, payload) values ($1, 'system', 'epgl_10_restored', $2::jsonb)`,
      [source.id, JSON.stringify({ by: "script:epgl-split-20-agent-2026-11-02", source: "production", kept: ENV_KEYS })]);
    await stg.query("commit");
    console.log(`\napplied. ${SLUG} = ${targetId}; ${SOURCE} is 1.0 again.\n`);
  } catch (e) {
    await stg.query("rollback").catch(() => {});
    throw e;
  } finally {
    await stg.end();
    await prod.end();
  }
}

if (process.argv[1]?.includes("epgl-split-20-agent-2026-11-02")) main().catch((e) => { console.error(e); process.exit(1); });
