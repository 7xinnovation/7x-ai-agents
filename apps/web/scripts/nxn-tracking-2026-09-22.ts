/**
 * Turn shipment tracking on (2026-09-22).
 *
 * Three things have to change together, and this does all three so no
 * environment ends up with two of them:
 *
 *   1. THE CREDENTIAL. A new "EMX Tracking" integration, one spec per
 *      environment, carrying the gateway's base URL and its X-API-KEY. The key
 *      is encrypted at rest like every other secret and is read from the
 *      environment here — it is never written into this file, because a key in
 *      the repository is a key on everybody's laptop.
 *
 *   2. THE GUIDANCE. Every journey's guidance carries, word for word, "SHIPMENT
 *      TRACKING IS NOT ONE OF OUR SERVICES... there is no tool behind any of
 *      that and there is nothing to check", followed by an instruction not to
 *      ask for a tracking number and to point at a web page instead. That was
 *      true this morning. A tool the prompt forbids is a tool that never gets
 *      called, so the block is replaced rather than left to argue with itself.
 *
 *   3. THE INTENT. `shipment_tracking` describes itself as "NOT offered by this
 *      assistant; answered by pointing to Emirates Post's tracking page", and
 *      that description is what the classifier reads.
 *
 * Idempotent, and each part is skipped if it is already done. Run from apps/web:
 *
 *   EMX_TRACKING_KEY=<key> \
 *   npx tsx scripts/nxn-tracking-2026-09-22.ts --target staging|production [--dry-run]
 *
 * The key belongs to the environment you are pointing at: staging's gateway will
 * not accept production's and the other way round.
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
import { encryptSecret } from "../lib/crypto";

const SLUG = "nxn-dialog";
const INTEGRATION = "EMX Tracking";

const GATEWAY: Record<string, string> = {
  staging: "https://api-stg.emx.ae",
  production: "https://api.emx.ae",
};

const target = process.argv[process.argv.indexOf("--target") + 1] ?? "";
if (!GATEWAY[target]) {
  console.error(`Pass --target staging|production (got ${JSON.stringify(target)}).`);
  process.exit(1);
}
const dryRun = process.argv.includes("--dry-run");
const KEY = process.env.EMX_TRACKING_KEY ?? "";

/** The refusal, exactly as it stands in all five journeys today. */
const OLD_BLOCK =
  "SHIPMENT TRACKING IS NOT ONE OF OUR SERVICES. This assistant handles PO Boxes: renting one, renewing one, and managing one. " +
  "It cannot track a shipment, find a parcel, tell anyone where a delivery has got to, or look up an AWB or tracking number — " +
  "there is no tool behind any of that and there is nothing to check.\n\n" +
  "So say so at once, in one line, the first time they ask. Do not ask for a tracking number, do not offer to look, do not say " +
  "you are checking, and never invent a status. Point them to Emirates Post's own tracking:\n" +
  "- English: [Track a shipment](https://www.emiratespost.ae/all-services/track-a-package) · 600 599 999\n" +
  "- Arabic: [تتبع شحنة](https://www.emiratespost.ae/ar/all-services/track-a-package) · 600 599 999\n\n" +
  "Then offer what you CAN do, once, as a short choice — rent a PO Box, renew one, manage one — and leave it there. " +
  "A customer who came for a parcel and is told plainly where to go has been helped; one who is asked for a tracking number and " +
  "then told it cannot be checked has been kept.";

const NEW_BLOCK =
  "SHIPMENT TRACKING (2026-09-22): you CAN track a shipment now. Call nxn_track_shipment with the tracking or AWB number and " +
  "answer from what it returns — the current status first, then the history as a short list, each line a date, a status and a " +
  "location where there is one. If the customer has not given a number, ask for it in one line; nothing else is needed and they " +
  "do not have to sign in.\n\n" +
  "Never answer a tracking question from your own knowledge, never estimate a delivery date, and never show a step the tool did " +
  "not return. When it finds nothing, that is a real answer and not a fault: say plainly that nothing is showing for that number, " +
  "suggest they check the digits, and mention that an item posted very recently may not have been scanned yet.\n\n" +
  "NAMES ARE NOT PART OF THE ANSWER. The tool deliberately does not return who sent the item or who signed for it, because a " +
  "tracking number is the only thing the person asking has had to present. Do not ask for a name, do not offer one, and do not " +
  "speculate about who received something.\n\n" +
  "Tracking is a lookup, not a journey: answer it, then let the conversation go where the customer wants. Do not steer them into " +
  "renting a PO Box off the back of it.";

function encrypted(): string {
  const v = encryptSecret(KEY);
  if (!v) throw new Error("could not encrypt the key — is SECRETS_KEY set for this environment?");
  return v;
}

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`No agent ${SLUG} in this database`);
  let changes = 0;

  /* 1. The credential. ---------------------------------------------------- */
  const existing = (await db.select().from(agentIntegrations).where(eq(agentIntegrations.agentId, row.id))).find(
    (r) => r.name === INTEGRATION
  );
  const spec = {
    specUrl: "",
    baseUrl: GATEWAY[target]!,
    authType: "apiKey" as const,
    authValue: null,
    authHeader: null,
    apiKey: KEY ? encrypted() : (existing?.environments as Record<string, { apiKey?: string }>)?.[target]?.apiKey ?? null,
    apiKeyHeader: "X-API-KEY",
    operations: [],
  };
  if (!spec.apiKey) {
    throw new Error(`No key for ${target}. Set EMX_TRACKING_KEY to the X-API-KEY Emirates Post issued for ${GATEWAY[target]}.`);
  }
  const environments = { ...((existing?.environments as Record<string, unknown>) ?? {}), [target]: spec };
  if (existing) {
    const before = JSON.stringify((existing.environments as Record<string, unknown>)?.[target] ?? null);
    // The ciphertext differs on every encryption, so comparing it would report a
    // change for ever. Everything BUT the key is compared; a key that needs
    // rotating is rotated by passing EMX_TRACKING_KEY, which is explicit.
    const strip = (s: string) => s.replace(/"apiKey":"[^"]*"/, '"apiKey":"…"');
    if (strip(before) === strip(JSON.stringify(spec)) && !process.env.EMX_TRACKING_KEY) {
      console.log(`  (already) ${INTEGRATION} / ${target}`);
    } else {
      console.log(`  ~ ${INTEGRATION} / ${target}: ${GATEWAY[target]}${process.env.EMX_TRACKING_KEY ? " (key set)" : ""}`);
      if (!dryRun) await db.update(agentIntegrations).set({ environments, enabled: true }).where(eq(agentIntegrations.id, existing.id));
      changes++;
    }
  } else {
    console.log(`  + ${INTEGRATION} / ${target}: ${GATEWAY[target]} (key set)`);
    if (!dryRun) await db.insert(agentIntegrations).values({ agentId: row.id, name: INTEGRATION, environments, enabled: true });
    changes++;
  }

  /* 2 and 3. The guidance and the intent. --------------------------------- */
  const def = row.definition as typeof row.definition & {
    journeys?: { key: string; guidance?: string }[];
    intents?: { key: string; description?: { en?: string; ar?: string } }[];
  };
  let defChanged = false;

  for (const j of def.journeys ?? []) {
    const before = String(j.guidance ?? "");
    if (before.includes(NEW_BLOCK)) { console.log(`  (already) ${j.key}`); continue; }
    if (!before.includes(OLD_BLOCK)) {
      // Loud rather than silent: the text is matched exactly, so a journey that
      // does not contain it has been edited elsewhere and needs a person.
      console.log(`  !! ${j.key}: the old tracking block is not there — check it by hand`);
      continue;
    }
    j.guidance = before.replace(OLD_BLOCK, NEW_BLOCK).replace(/\n{3,}/g, "\n\n").trim();
    console.log(`  ~ ${j.key}: tracking guidance replaced`);
    defChanged = true;
  }

  const intent = (def.intents ?? []).find((i) => i.key === "shipment_tracking");
  if (intent) {
    const en = "Track a shipment: where a parcel, letter or consignment has got to, by tracking or AWB number";
    const ar = "تتبع شحنة: أين وصلت الطردية أو الرسالة، عبر رقم التتبع";
    if (intent.description?.en !== en) {
      intent.description = { ...(intent.description ?? {}), en, ar };
      console.log("  ~ intent shipment_tracking: no longer described as unavailable");
      defChanged = true;
    } else {
      console.log("  (already) intent shipment_tracking");
    }
  }

  if (defChanged) {
    changes++;
    if (!dryRun) await db.update(agents).set({ definition: def }).where(eq(agents.id, row.id));
  }

  console.log(dryRun ? `\n--dry-run: ${changes} change(s) NOT written.` : changes ? `\n${changes} change(s) written.` : "\nAlready applied.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
