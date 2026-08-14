/**
 * Set the origins permitted to embed an agent.
 *
 * This does two jobs, and the second is the one that matters for the host handoff:
 *
 *  1. `frame-ancestors` in the embed CSP (middleware.ts) — who may iframe us.
 *     An empty list means ANY site can, which is the current state for NXN.
 *  2. The allow-list for the signed-token postMessage. The embed only reads a
 *     token from a frame whose origin is on this list, so an unrelated page
 *     cannot hand us one. With the list empty no token is accepted at all.
 *
 * The widget lives on Emirates Post's own site, so those are the origins — not
 * agent.7x.ae / 7xagents.7x-lab.com, which are where WE are served (the iframe
 * src), not who embeds us. Getting that backwards allows the wrong side.
 *
 * Run from apps/web:
 *   npx tsx scripts/set-allowed-origins.ts nxn-dialog https://emiratespost.ae ... [--env <file>]
 *   npx tsx scripts/set-allowed-origins.ts nxn-dialog --show
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
import { eq } from "drizzle-orm";

const argv = process.argv.slice(2).filter((x, i, all) => x !== "--env" && all[i - 1] !== "--env");
const slug = argv[0];
const showOnly = argv.includes("--show");
const origins = argv.slice(1).filter((x) => !x.startsWith("--"));

async function main() {
  if (!slug) throw new Error("usage: set-allowed-origins.ts <agent-slug> [origin ...] [--show]");
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, slug)).limit(1);
  if (!row) throw new Error(`${slug} not found`);
  const def = row.definition as { allowedOrigins?: string[]; [k: string]: unknown };

  console.log(`${slug} allowedOrigins now: ${JSON.stringify(def.allowedOrigins ?? [])}`);
  if (showOnly || !origins.length) {
    if (!origins.length && !showOnly) console.log("(no origins given — nothing changed)");
    return;
  }

  // Normalise to bare origins: a trailing path or slash would never match
  // event.origin, and the mismatch is silent — the token is simply ignored.
  const normalised = origins.map((o) => {
    try {
      return new URL(o).origin;
    } catch {
      throw new Error(`not a valid origin: ${o}`);
    }
  });

  def.allowedOrigins = [...new Set(normalised)];
  await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
  console.log(`updated to: ${JSON.stringify(def.allowedOrigins)}`);
  console.log("\nEmbedding is now restricted to these origins, and only they can hand the agent a signed token.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e.message ?? e);
    process.exit(1);
  });
