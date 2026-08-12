/**
 * Binds NXN's payment capability to the real Network International (N-Genius)
 * gateway, staging outlet.
 *
 * The outlet reference and base URL are NOT secrets and belong to the agent, so
 * they live in the binding's settings — that keeps them per-agent (a second
 * agent will have its own outlet) and visible in the definition. Only the API
 * key is a secret, referenced by name and read from the environment at call
 * time (NGENIUS_API_KEY); it is never stored in the definition.
 *
 * Switching the provider from "mock" to "ngenius" changes request_payment from
 * the internal demo checkout to a real hosted payment page on the sandbox.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/wire-nxn-ngenius.ts
 *   prod: DATABASE_URL=<...> npx tsx scripts/wire-nxn-ngenius.ts
 *   revert: PROVIDER=mock npx tsx scripts/wire-nxn-ngenius.ts
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";

const SLUG = "nxn-dialog";
const PROVIDER = process.env.PROVIDER ?? "ngenius";

/** Staging outlet (Network International sandbox). */
const BINDING = {
  provider: "ngenius",
  settings: {
    baseUrl: "https://api-gateway.sandbox.ngenius-payments.com",
    outletRef: "b78ef8c7-ce2a-41d6-84c9-e6219557a991",
    // Where the gateway returns the customer after they pay. The in-chat card
    // also polls /api/payments/status, which asks the gateway directly, so the
    // conversation settles even if the customer closes the popup early.
    redirectUrl: `${process.env.PUBLIC_APP_URL ?? "https://7xagents.7x-lab.com"}/api/payments/return`,
  },
  secretRefs: ["NGENIUS_API_KEY"],
};

const MOCK_BINDING = { provider: "mock", settings: {}, secretRefs: [] as string[] };

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`${SLUG} not found`);
  const def = row.definition as unknown as {
    integrations: Record<string, unknown>;
    activeEnvironment?: string;
  };

  // The sandbox outlet must never be bound to a production agent.
  if (PROVIDER === "ngenius" && def.activeEnvironment !== "staging") {
    throw new Error(
      `refusing to bind the SANDBOX outlet: ${SLUG} activeEnvironment is "${def.activeEnvironment}", not "staging"`
    );
  }

  const next = PROVIDER === "mock" ? MOCK_BINDING : BINDING;
  const before = JSON.stringify(def.integrations.payment ?? null);
  if (before === JSON.stringify(next)) {
    console.log("No changes — already applied.");
    return;
  }

  def.integrations.payment = next;
  await db.update(agents).set({ definition: def as never, updatedAt: new Date() }).where(eq(agents.id, row.id));
  console.log(`${SLUG} payment binding → ${next.provider}`);
  if (next.provider === "ngenius") {
    console.log(`  outlet   ${BINDING.settings.outletRef}`);
    console.log(`  base URL ${BINDING.settings.baseUrl}`);
    console.log(`  API key  read at call time from NGENIUS_API_KEY (not stored)`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });

export {};
