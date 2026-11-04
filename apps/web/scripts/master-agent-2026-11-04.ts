/**
 * Creates (or refreshes) the MASTER AGENT in one environment's database.
 *
 * Asked for, 4 November 2026: one agent offering both EPGL and NXN, built
 * without rebuilding either, so that any change to EPGL or NXN is the master's
 * behaviour too. See lib/masterAgent for how a turn is routed.
 *
 * What is written is deliberately small: the master's name, theme, greeting
 * and the list of delegates. No journeys, knowledge, integrations or prompt
 * are copied — those are read from the delegates' own rows on every turn.
 * The theme and the allowed embedding origins are TAKEN from the delegates
 * when this runs (NXN's Mira branding; every origin either may be embedded
 * on), and re-running the script refreshes them.
 *
 * Idempotent. Prints the definition and writes only with --apply. From apps/web:
 *   npx tsx scripts/master-agent-2026-11-04.ts --env <stg.env>
 *   npx tsx scripts/master-agent-2026-11-04.ts --env <stg.env> --apply
 * Options: --slug (default ep-master), --nxn (default nxn-dialog),
 *          --epgl (default epgl-dialog; e.g. epgl-dialog-2 on staging).
 */
import { AgentDefinition } from "@dialog/config";
import { databaseUrlFrom } from "./lib/envFile";
import { poolFor } from "./lib/pgPool";

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(n);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1]! : d;
};
const APPLY = process.argv.includes("--apply");
const SLUG = arg("--slug", "ep-master")!;
const NXN = arg("--nxn", "nxn-dialog")!;
const EPGL = arg("--epgl", "epgl-dialog")!;
const TENANT = { slug: "ep", name: "Emirates Post Group" };

type Def = Record<string, any>;

/** The master's definition, from the two delegates as they are now. */
export function masterDefinition(nxn: Def, epgl: Def, slug = SLUG): Def {
  const origins = [...new Set([...(nxn.allowedOrigins ?? []), ...(epgl.allowedOrigins ?? [])])];
  return {
    slug,
    tenantSlug: TENANT.slug,
    name: "Emirates Post",
    persona:
      "Front door for Emirates Post services. Every conversation is handled by the specialist agent for the service the customer needs; this persona is never used to answer.",
    locales: ["en", "ar"],
    allowedOrigins: origins,
    theme: nxn.theme,
    greeting: {
      en:
        "Hello, I'm Mira, your Emirates Post assistant. I can help you rent, renew or manage a PO Box, or apply for and renew a postal licence. What can I do for you?\n\n" +
        "```buttons\n- PO Boxes\n- Postal licences\n```",
      ar:
        "مرحباً، أنا ميره، مساعدتك من بريد الإمارات. يمكنني مساعدتك في استئجار صندوق بريد أو تجديده أو إدارته، أو التقديم على ترخيص بريدي أو تجديده. كيف أقدر أساعدك؟\n\n" +
        "```buttons\n- صناديق البريد\n- التراخيص البريدية\n```",
    },
    delegates: [
      {
        slug: nxn.slug,
        label: { en: "PO Boxes", ar: "صناديق البريد" },
        summary: { en: "Emirates Post PO Boxes for individuals and companies: renting, renewing, managing, tracking shipments, branches." },
      },
      {
        slug: epgl.slug,
        label: { en: "Postal licences", ar: "التراخيص البريدية" },
        summary: { en: "EPGL postal and courier licences for businesses: new licences, renewals, licensing rules and application status." },
      },
    ],
    defaultDelegate: nxn.slug,
    // A master runs no turn itself; these stay empty on purpose.
    intents: [],
    journeys: [],
    activeEnvironment: nxn.activeEnvironment ?? "production",
  };
}

async function main() {
  const pool = await poolFor(databaseUrlFrom(arg("--env")));
  try {
    const load = async (slug: string) => {
      const r = await pool.query("select definition, status from agents where slug = $1", [slug]);
      if (!r.rows[0]) throw new Error(`delegate ${slug} not found in this database`);
      if (r.rows[0].status === "disabled") throw new Error(`delegate ${slug} is disabled`);
      return r.rows[0].definition as Def;
    };
    const def = AgentDefinition.parse(masterDefinition(await load(NXN), await load(EPGL)));
    console.log(JSON.stringify({ ...def, theme: "(from " + NXN + ")" }, null, 2));
    const existing = await pool.query("select id, status from agents where slug = $1", [SLUG]);
    console.log(existing.rows[0] ? `\n${SLUG} exists (${existing.rows[0].status}) — will be refreshed` : `\n${SLUG} is new`);
    if (!APPLY) {
      console.log("dry run — pass --apply to write");
      return;
    }
    await pool.query("begin");
    const t = await pool.query(
      "insert into tenants (slug, name) values ($1, $2) on conflict (slug) do update set name = tenants.name returning id",
      [TENANT.slug, TENANT.name]
    );
    await pool.query(
      `insert into agents (tenant_id, slug, name, status, definition) values ($1, $2, $3, 'live', $4)
       on conflict (slug) do update set definition = excluded.definition, name = excluded.name, updated_at = now()`,
      [t.rows[0].id, SLUG, def.name, JSON.stringify(def)]
    );
    await pool.query("commit");
    console.log(`written: ${SLUG} → delegates ${NXN}, ${EPGL}`);
  } catch (e) {
    await pool.query("rollback").catch(() => {});
    throw e;
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.includes("master-agent-2026-11-04")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
