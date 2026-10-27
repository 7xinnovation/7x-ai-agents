/**
 * EPGL 2.0: Salesforce's four New Regulation endpoints, as tools (20 Oct 2026).
 *
 * They shipped the catalogue and the composite on 19 October, then pricing,
 * status and document re-upload on the 19th in a second pack. All four are one
 * Apex REST surface on the NewLaw sandbox behind one client-credentials app, so
 * they are registered as ONE integration with the operations of all four specs.
 *
 * The specs are in scripts/fixtures, redacted: Salesforce pre-filled their
 * sandbox client id and secret into the files they emailed, and a credential in
 * a repository is a credential published. They are read from the environment:
 *   EPGL_NEWLAW_CLIENT_ID, EPGL_NEWLAW_CLIENT_SECRET
 * and stored encrypted, like every other integration secret.
 *
 * THE OPERATIONS ARE PARSED, NOT TYPED OUT. lib/openapi.ts already turns a spec
 * into callable operations and it is the same parser the admin importer uses —
 * so what the agent can call and what Salesforce published cannot drift apart
 * by a typo. parseSpecDocument is the fetch-free half, added for this.
 *
 * Idempotent: the row is matched by name and replaced. Dry run by default.
 * Run from apps/web:
 *   EPGL_NEWLAW_CLIENT_ID=… EPGL_NEWLAW_CLIENT_SECRET=… \
 *     npx tsx scripts/epgl-2.0-integration-2026-10-20.ts [--env <file>] [--apply]
 */
import { config } from "dotenv";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const envArg = process.argv.indexOf("--env");
config({
  path:
    envArg !== -1 && process.argv[envArg + 1]
      ? resolve(process.argv[envArg + 1]!)
      : resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env"),
});
import { getDb, agents, agentIntegrations } from "@dialog/db";
import { eq, and } from "drizzle-orm";
import { parseSpecDocument } from "../lib/openapi";
import { encryptSecret } from "../lib/crypto";

const here = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes("--apply");
const SLUG = "epgl-dialog";
export const NAME = "EPGL New Regulation";
const SANDBOX = "https://epro--newlaw.sandbox.my.salesforce.com";

/**
 * Not every path in their specs may become a tool.
 *
 * The token endpoint is auth, not an operation.
 *
 * paymentNotification is a different kind of exclusion, and a deliberate one.
 * It arrived in the 27 October pack, and it is the call that tells Emirates
 * Post money has arrived — the one thing in this integration that must never be
 * reachable by a model that has, on this very agent, invented three API
 * failures including a fake Apex stack trace. It is taken server-side from the
 * settled payment instead (lib/epgl20Payment.ts), from the gateway's own
 * result, so there is nothing here for the model to be wrong about.
 */
const NOT_AN_OPERATION = /\/services\/oauth2\/token$|\/services\/apexrest\/paymentNotification$/;

export function operationsFrom(dir: string): { ops: unknown[]; files: string[] } {
  const files = readdirSync(dir).filter((f) => /^EPG-Licensing-.*\.openapi\.json$/.test(f)).sort();
  const seen = new Set<string>();
  const ops: unknown[] = [];
  for (const f of files) {
    const spec = JSON.parse(readFileSync(join(dir, f), "utf8"));
    const parsed = parseSpecDocument(spec, `file://${join(dir, f)}`, SANDBOX);
    for (const op of parsed.operations) {
      if (NOT_AN_OPERATION.test(op.path)) continue;
      // Four specs, one surface: the composite appears in more than one of them.
      const sig = `${op.method} ${op.path}`;
      if (seen.has(sig)) continue;
      seen.add(sig);
      ops.push(op);
    }
  }
  return { ops, files };
}

async function main() {
  const { ops, files } = operationsFrom(join(here, "fixtures"));
  console.log(`specs: ${files.join(", ")}`);
  console.log(`operations (token endpoints dropped, duplicates collapsed): ${ops.length}`);
  for (const o of ops as { method: string; path: string; toolName: string }[]) {
    console.log(`  ${o.method.padEnd(4)} ${o.path.padEnd(52)} -> ${o.toolName}`);
  }

  const clientId = process.env.EPGL_NEWLAW_CLIENT_ID ?? "";
  const clientSecret = process.env.EPGL_NEWLAW_CLIENT_SECRET ?? "";
  if (!clientId || !clientSecret) {
    console.log("\nEPGL_NEWLAW_CLIENT_ID / EPGL_NEWLAW_CLIENT_SECRET are not set.");
    console.log("The row can still be written; it just will not authenticate until they are.");
  }

  const spec = {
    specUrl: "",                       // emailed, not hosted: the fixtures are the source
    baseUrl: SANDBOX,
    // "oauth2_cc" is the ONLY spelling the runtime knows (AuthType in
    // lib/integrations). Written as "oauth2_client_credentials" this row looks
    // complete, logs nothing, and sends no bearer at all — every call comes
    // back 401 INVALID_SESSION_ID from Salesforce, which reads like expired
    // credentials rather than an integration that was never authenticating.
    authType: "oauth2_cc",
    oauthTokenUrl: `${SANDBOX}/services/oauth2/token`,
    oauthClientId: clientId,
    // THE SECRET BELONGS IN authValue. `apiKey` is a gateway key the runtime
    // puts in a HEADER on every single request, so the client secret went to
    // Salesforce on each call and the token grant had nothing to sign with.
    authValue: encryptSecret(clientSecret),
    apiKey: null,
    authHeader: "Authorization",
    operations: ops,
  };

  const db = getDb();
  const [agent] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!agent) { console.log(`\n${SLUG} is not on this database`); return; }
  const [existing] = await db.select().from(agentIntegrations)
    .where(and(eq(agentIntegrations.agentId, agent.id), eq(agentIntegrations.name, NAME))).limit(1);

  console.log(`\n${existing ? "replace" : "create"} integration "${NAME}" on ${SLUG} (staging env = their NewLaw sandbox)`);
  if (!APPLY) { console.log("\nDry run. Add --apply to write."); return; }

  if (existing) {
    await db.update(agentIntegrations)
      .set({ environments: { staging: spec } as never, enabled: true })
      .where(eq(agentIntegrations.id, existing.id));
  } else {
    await db.insert(agentIntegrations).values({
      agentId: agent.id, name: NAME, enabled: true, environments: { staging: spec } as never,
    });
  }
  console.log("written");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
