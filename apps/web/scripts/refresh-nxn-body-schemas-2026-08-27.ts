/**
 * Give the NXN operations their real request-body schemas (2026-08-27).
 *
 * A customer paid AED 300 for a new PO Box on staging and the rental was never
 * created. The failure log (added 2026-08-24) has what the backend actually said:
 *
 *   POST /api/Rental/Save -> HTTP 400
 *   {"TotalAmount":["Total Amount is required"],
 *    "UserProfile":["User Profile is required"],
 *    "PaymentProperties":["Payment Properties is required"],
 *    "SubscriptionReferenceNumber":["Subscription Reference Number is required"]}
 *
 * Not "a system issue on Emirates Post's end", which is what the customer was
 * told: we sent a body missing four required fields. The stored operation carried
 * `body: { type: "object", description: "JSON request body" }` and nothing else,
 * because the parser discarded every request-body schema. The model was told an
 * object goes here and had to guess what belongs in it.
 *
 * lib/openapi.ts now dereferences those schemas. This backfills the operations
 * already in the database rather than re-importing, because a re-import replaces
 * the whole environment and would silently re-enable the write operations that are
 * deliberately turned off.
 *
 * Matching is by method + path, ignoring the /v1 segment: the stored paths are
 * unversioned (/api/Rental/Save) and the spec is versioned (/api/v1/Rental/Save).
 * The unversioned form is what has been in use and answers, so paths and tool
 * names are left exactly as they are — only inputSchema and hasBody change, and
 * only where a match is found.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/refresh-nxn-body-schemas-2026-08-27.ts [--env <file>] [--dry]
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const envArg = process.argv.indexOf("--env");
config({
  path:
    envArg !== -1 && process.argv[envArg + 1]
      ? resolve(process.argv[envArg + 1]!)
      : resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env"),
});

import { getDb, agentIntegrations } from "@dialog/db";
import { eq } from "drizzle-orm";
import { getAgentBySlug } from "../lib/agents";
import { parseSpec } from "../lib/openapi";

const SLUG = "nxn-dialog";
const ENV = "staging";
const SPEC_URL = "https://box-stg.emiratespost.ae/services/pobox/swagger/v1/swagger.json";
const DRY = process.argv.includes("--dry");

/** /api/v1/Rental/Save and /api/Rental/Save are the same operation here. */
const norm = (p: string) => p.replace(/\/v\d+(?=\/)/i, "").replace(/\/+$/, "").toLowerCase();

async function main() {
  const agent = await getAgentBySlug(SLUG);
  if (!agent) throw new Error(`${SLUG} not found`);

  const spec = await parseSpec(SPEC_URL);
  const bySig = new Map(spec.operations.map((o) => [`${o.method} ${norm(o.path)}`, o]));
  console.log(`spec: ${spec.operations.length} operations from ${SPEC_URL}\n`);

  const db = getDb();
  const rows = await db.select().from(agentIntegrations).where(eq(agentIntegrations.agentId, agent.id));
  let touched = 0;

  for (const row of rows) {
    const envs = row.environments as Record<string, { operations?: Record<string, unknown>[]; specUrl?: string }>;
    const env = envs?.[ENV];
    if (!env?.operations?.length) continue;

    let gained = 0;
    let already = 0;
    let unmatched: string[] = [];
    for (const op of env.operations) {
      const sig = `${String(op.method)} ${norm(String(op.path))}`;
      const fresh = bySig.get(sig);
      if (!fresh) { unmatched.push(sig); continue; }
      const bodyNow = (op.inputSchema as { properties?: Record<string, { properties?: object }> })?.properties?.body;
      const bodyNew = (fresh.inputSchema.properties as Record<string, { properties?: object }>).body;
      // Only operations that gain a real body schema are worth rewriting.
      if (!bodyNew?.properties) continue;
      if (bodyNow?.properties) { already++; continue; }
      op.inputSchema = fresh.inputSchema;
      op.hasBody = fresh.hasBody;
      gained++;
      console.log(`  + ${op.toolName}  ${Object.keys(bodyNew.properties).length} body fields`);
    }
    // Point at the spec itself, not the Swagger UI page it was importing from.
    if (env.specUrl !== SPEC_URL) { env.specUrl = SPEC_URL; console.log(`  specUrl -> ${SPEC_URL}`); gained++; }

    console.log(`\n${row.name}/${ENV}: ${gained} updated, ${already} already had a schema, ${unmatched.length} not in spec`);
    if (unmatched.length) console.log(`  not in spec: ${unmatched.slice(0, 8).join(", ")}${unmatched.length > 8 ? " …" : ""}`);

    if (gained && !DRY) {
      await db.update(agentIntegrations).set({ environments: envs as never }).where(eq(agentIntegrations.id, row.id));
      touched++;
    }
  }
  console.log(DRY ? "\n(dry run — nothing written)" : `\n${touched} integration(s) written.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
