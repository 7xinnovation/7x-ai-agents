/**
 * Does this environment actually face the environment it claims to?
 *
 * A production database seeded from a staging snapshot looks completely healthy
 * while pointing every integration at staging — that is exactly how NXN ended up
 * live on box-stg and on the N-Genius SANDBOX outlet with a staging redirect URL.
 * Nothing errors; the money just never moves.
 *
 * So this asserts the boring thing nobody checks: every URL an agent will actually
 * call, plus the activeEnvironment that decides which set is used, and whether the
 * embed origins are pinned.
 *
 * Run from apps/web:
 *   npx tsx scripts/audit-environment.ts production --env <file>
 *   npx tsx scripts/audit-environment.ts staging
 *
 * Exits non-zero if anything in a production environment smells of staging.
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

import { getDb, agents } from "@dialog/db";
import { listIntegrations, type EnvKey } from "../lib/integrations";

const expected = (process.argv.find((x) => x === "staging" || x === "production") ?? "production") as EnvKey;

/** Markers that mean "this is not production", wherever they appear in a URL. */
// The trailing class must include ":" — without it "http://localhost:4500/..."
// slipped through as clean, which is how a localhost spec URL survived in prod.
const NON_PROD = /(^|[.\-/])(stg|stage|staging|sandbox|sbx|uat|preprod|pre-prod|test|dev|localhost|127\.0\.0\.1)([.\-/:]|$)/i;

let problems = 0;
const ok = (label: string, value: string) => console.log(`   ok    ${label.padEnd(26)} ${value}`);
const bad = (label: string, value: string, why: string) => {
  problems++;
  console.log(`   BAD   ${label.padEnd(26)} ${value}\n         ^ ${why}`);
};

/** Check a URL against the environment it is supposed to serve. */
function checkUrl(label: string, value: unknown) {
  const v = String(value ?? "").trim();
  if (!v) return; // absent is not the same as wrong; other checks cover required fields
  const smellsStaging = NON_PROD.test(v);
  if (expected === "production" && smellsStaging) bad(label, v, "points at a non-production host");
  else if (expected === "staging" && !smellsStaging && /^https?:/i.test(v)) {
    // Not a failure — staging legitimately calls some shared production services.
    console.log(`   note  ${label.padEnd(26)} ${v}\n         ^ production host referenced from staging`);
  } else ok(label, v);
}

async function main() {
  const db = getDb();
  const rows = await db.select().from(agents);
  console.log(`auditing ${rows.length} agents against expected environment: ${expected}\n`);

  for (const row of rows) {
    const def = row.definition as Record<string, any>;
    console.log(`${def.slug}  (tenant ${def.tenantSlug})`);

    const active = def.activeEnvironment ?? "production";
    if (active !== expected) bad("activeEnvironment", String(active), `should be ${expected}`);
    else ok("activeEnvironment", String(active));

    const origins: string[] = Array.isArray(def.allowedOrigins) ? def.allowedOrigins : [];
    if (!origins.length) {
      // frame-ancestors falls back to "*", and the host handoff cannot be trusted.
      bad("allowedOrigins", "[]", "any site may embed this agent, and no host may hand it a token");
    } else origins.forEach((o) => checkUrl("allowedOrigins[]", o));

    // Capability integrations (payment gateway, CRM, auth, lookup).
    for (const [cap, cfgv] of Object.entries((def.integrations ?? {}) as Record<string, any>)) {
      const settings = (cfgv?.settings ?? {}) as Record<string, unknown>;
      for (const key of ["baseUrl", "redirectUrl", "url", "endpoint"]) {
        if (settings[key]) checkUrl(`${cap}.${key}`, settings[key]);
      }
      if (cfgv?.provider === "mock" && expected === "production") {
        bad(`${cap}.provider`, "mock", "a mock provider is serving a production agent");
      }
    }

    // API integrations: only the ACTIVE environment's spec is ever called.
    for (const intg of await listIntegrations(row.id)) {
      const spec = intg.environments[active as EnvKey];
      if (!spec) {
        bad(`${intg.name}`, `(no ${active} spec)`, "the active environment has no configuration");
        continue;
      }
      if (!intg.enabled) console.log(`   note  ${intg.name.padEnd(26)} integration disabled`);
      checkUrl(`${intg.name}.baseUrl`, spec.baseUrl);
      checkUrl(`${intg.name}.specUrl`, spec.specUrl);
      const opCount = (spec.operations ?? []).length;
      console.log(`   ok    ${`${intg.name}.operations`.padEnd(26)} ${opCount}`);
    }
    console.log();
  }

  // Environment variables that carry a URL.
  console.log("app settings");
  for (const key of [
    "PUBLIC_APP_URL", "NEXT_PUBLIC_DIALOG_HOST", "UAEPASS_BASE", "UAEPASS_REDIRECT_URI",
    "AZURE_ANTHROPIC_ENDPOINT", "AZURE_REALTIME_ENDPOINT", "NGENIUS_BASE_URL", "DATABASE_URL",
  ]) {
    const v = process.env[key];
    if (!v) continue;
    if (key === "DATABASE_URL") {
      const host = (() => { try { return new URL(v).host; } catch { return v; } })();
      checkUrl(key, `https://${host}`);
    } else checkUrl(key, v);
  }

  console.log(problems ? `\n${problems} problem(s) found` : "\nno problems found");
  process.exit(problems ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
