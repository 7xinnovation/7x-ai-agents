/**
 * Fix: a signed-in customer renewing a PO Box was being asked to "re-verify" with
 * a one-time passcode. Cause: the mock/UAE-PASS persona has no Emirates Post
 * BACKEND session token, so an authenticated Renewal/* call returns "needs a
 * session", and the model followed that into the passwordless OTP flow. Renewal
 * is guest-allowed and completes via the guest pricing + in-chat payment, so it
 * must never re-verify or send a passcode.
 *
 * Two changes (idempotent):
 *  1. Append a "never re-verify a renewal" directive to both renewal journeys.
 *  2. Disable the Account passwordLessToken / verifyPasswordLessToken tools so the
 *     agent cannot start a passcode flow at all (in the demo they are a dead-end
 *     anyway — they need a real phone/OTP).
 *
 * Run: npx tsx scripts/fix-nxn-renewal-otp.ts   (from apps/web)
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import { getDb, agents, agentIntegrations } from "@dialog/db";
import { eq } from "drizzle-orm";

const MARKER = "NEVER RE-VERIFY A RENEWAL";
const DIRECTIVE =
  `${MARKER}: renewal never requires sign-in, session re-verification, or a one-time passcode. ` +
  "If the customer is already signed in, do NOT ask them to sign in again or to confirm an email or mobile number. " +
  "Always use the GUEST renewal tools (Guest/Renewal/Details, Guest/Renewal/Pricing), which need no session; never the authenticated Renewal variants. " +
  "Reuse the price you already showed the customer; do not re-fetch pricing you already displayed. " +
  "Take payment with request_payment (the secure in-chat payment). " +
  "If any tool reports that the session needs verifying or was rejected, do NOT start a passcode or sign-in flow and do NOT ask for an email or mobile: continue with the guest tools and the price already shown, or offer a callback. Never send a one-time passcode for a renewal.";

const OTP_TOOLS = new Set(["post_api_Account_passwordLessToken", "post_api_Account_verifyPasswordLessToken"]);

async function main() {
  const db = getDb();
  const [agent] = await db.select().from(agents).where(eq(agents.slug, "nxn-dialog")).limit(1);
  if (!agent) throw new Error("nxn-dialog not found");
  const def = agent.definition as Record<string, any>;

  // 1) Guidance on both renewal journeys.
  for (const key of ["personal_po_box_renewal", "corporate_po_box_renewal"]) {
    const j = def.journeys.find((x: any) => x.key === key);
    if (!j) { console.log(`  (skip) ${key} not found`); continue; }
    const base = (j.guidance ?? "").split(`\n\n${MARKER}`)[0].split(MARKER)[0].trimEnd();
    j.guidance = `${base}\n\n${DIRECTIVE}`;
    console.log(`  ${key}: guidance ${j.guidance.length} chars`);
  }
  await db.update(agents).set({ definition: def as typeof agent.definition }).where(eq(agents.id, agent.id));

  // 2) Disable the OTP tools in the integration spec.
  const rows = await db.select().from(agentIntegrations).where(eq(agentIntegrations.agentId, agent.id));
  for (const r of rows) {
    const envs = (r.environments ?? {}) as Record<string, any>;
    let changed = false;
    for (const spec of Object.values(envs)) {
      for (const op of spec?.operations ?? []) {
        if (OTP_TOOLS.has(op.toolName) && op.enabled !== false) { op.enabled = false; changed = true; console.log(`  disabled tool: ${op.toolName}`); }
      }
    }
    if (changed) await db.update(agentIntegrations).set({ environments: envs }).where(eq(agentIntegrations.id, r.id));
  }
  console.log("NXN renewal OTP fix applied.");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
