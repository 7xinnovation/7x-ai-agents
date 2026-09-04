/**
 * What is this deployment actually pointed at? (read-only)
 *
 * "Are the endpoints configured for production?" is not answerable from the
 * repository: base URLs, credentials and the ACTIVE ENVIRONMENT live in the
 * database and the app settings, and staging and production have separate ones
 * of each. This prints the answer for whichever database it is given.
 *
 * Reads nothing it does not print, writes nothing at all, and masks every
 * secret -- it reports whether a credential is SET, never what it is.
 *
 * Run from apps/web:
 *   npx tsx scripts/audit-agent-config.ts [--env <file>]
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

import { getDb, agents, agentIntegrations } from "@dialog/db";
import { eq } from "drizzle-orm";

const set = (v: unknown) => (v === undefined || v === null || v === "" ? "— MISSING" : "set");
const envVar = (n: string) => `${n}: ${process.env[n] ? "set" : "— MISSING"}`;

async function main() {
  const db = getDb();
  const rows = await db.select().from(agents);
  for (const row of rows) {
    const def = row.definition as unknown as Record<string, any>;
    const active = def.activeEnvironment ?? "production";
    console.log(`\n${"=".repeat(72)}\n${row.slug}   tenant=${def.tenantSlug}   ACTIVE ENVIRONMENT: ${active}`);
    console.log(`  allowedOrigins: ${(def.allowedOrigins ?? []).join(", ") || "— none"}`);
    console.log(`  hostLoginUrl:   ${def.hostLoginUrl ?? "— none"}`);

    const pay = def.integrations?.payment;
    if (pay) {
      console.log(`  payment: provider=${pay.provider}`);
      for (const [k, v] of Object.entries(pay.settings ?? {})) console.log(`      ${k}: ${v}`);
      console.log(`      secretRefs: ${(pay.secretRefs ?? []).map((r: string) => `${r}=${process.env[r] ? "set" : "— MISSING"}`).join(", ") || "none"}`);
    } else {
      console.log("  payment: — not bound");
    }

    const ints = await db.select().from(agentIntegrations).where(eq(agentIntegrations.agentId, row.id));
    for (const i of ints) {
      const envs = (i.environments ?? {}) as Record<string, any>;
      console.log(`  integration "${i.name}" ${i.enabled ? "" : "(DISABLED) "}— environments: ${Object.keys(envs).join(", ") || "none"}`);
      for (const [name, spec] of Object.entries(envs)) {
        const mark = name === active ? " <- ACTIVE" : "";
        console.log(`      [${name}]${mark}`);
        console.log(`         baseUrl:  ${spec.baseUrl ?? "— MISSING"}`);
        console.log(`         authType: ${spec.authType}   authValue: ${set(spec.authValue)}   apiKey: ${set(spec.apiKey)}`);
        if (spec.oauthTokenUrl) console.log(`         oauth:    tokenUrl=${spec.oauthTokenUrl}  clientId=${set(spec.oauthClientId)}`);
        const ops = (spec.operations ?? []) as { enabled?: boolean }[];
        console.log(`         operations: ${ops.filter((o) => o.enabled !== false).length}/${ops.length} enabled`);
      }
    }

    // Journey-level settings that decide whether money moves.
    for (const j of def.journeys ?? []) {
      const s = j.submission ?? {};
      if (!s.requiresPayment && !s.processingFee && !s.apiFlow) continue;
      console.log(
        `  journey ${j.key}: requiresPayment=${s.requiresPayment ?? false} amount=${s.amount ?? "—"} ${s.currency ?? ""}` +
          `${s.processingFee ? ` fee=${s.processingFee.percent}%` : ""}` +
          `${s.apiFlow?.saveTool ? ` saveTool=${s.apiFlow.saveTool}` : ""} requiresAuth=${j.requiresAuth}`
      );
    }
  }

  console.log(`\n${"=".repeat(72)}\nApp settings this process can see`);
  for (const n of [
    "NGENIUS_API_KEY", "SECRETS_KEY",
    "UAEPASS_BASE", "UAEPASS_CLIENT_ID", "UAEPASS_CLIENT_SECRET", "UAEPASS_MOCK",
    "NXN_CASE_API_BASE_URL", "NXN_CASE_TURNSTILE_TOKEN",
    "NXN_BRANCH_OPS_EMAIL", "NXN_EMX_TEAM_EMAIL",
    "CUSTOMER_PULSE_API_BASE_URL", "CUSTOMER_PULSE_API_KEY",
    "CUSTOMER_PULSE_ID_LICENSE_NEW", "CUSTOMER_PULSE_ID_LICENSE_RENEWAL",
    "MOE_API_BASE_URL", "MOE_API_TOKEN",
    "PUBLIC_APP_URL",
  ]) {
    // Values that are not secrets are worth SEEING, not just counting.
    const shown = /BASE_URL|MOCK|EMAIL|PUBLIC_APP_URL/.test(n) ? process.env[n] ?? "— MISSING" : set(process.env[n]);
    console.log(`  ${n}: ${shown}`);
  }
  console.log("\n(App settings above reflect THIS process, not the deployed app —");
  console.log(" run it on the server, or compare against the App Service settings.)");
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
