/**
 * Point an agent's sign-in button at the HOST portal's own login page.
 *
 * The customer signs in on the portal the widget is embedded in (their UAE PASS
 * client, their registered callback), the token lands in that origin's
 * localStorage, and our loader -- first-party on that page -- hands it to the
 * widget, which verifies it server-side. See hostLoginUrl in
 * packages/config/src/agent.ts for why this only works same-origin.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/set-host-login-url.ts --agent nxn-dialog --url https://box-stg.emiratespost.ae/... [--env <file>]
 *   npx tsx scripts/set-host-login-url.ts --agent nxn-dialog --clear
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const envArg = arg("env");
config({
  path: envArg ? resolve(envArg) : resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env"),
});

import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";

async function main() {
  const slug = arg("agent");
  const url = arg("url");
  const clear = process.argv.includes("--clear");
  if (!slug || (!url && !clear)) {
    console.error("usage: --agent <slug> (--url <https://...> | --clear) [--env <file>]");
    process.exit(2);
  }
  // Fail before writing rather than storing a value the widget will try to open.
  if (url) {
    const u = new URL(url);
    if (u.protocol !== "https:") throw new Error("host login URL must be https");
  }

  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, slug)).limit(1);
  if (!row) throw new Error(`${slug} not found`);
  const def = row.definition as unknown as Record<string, unknown>;

  const before = def.hostLoginUrl ?? null;
  const after = clear ? undefined : url;
  if (before === (after ?? null)) {
    console.log(`no change (${slug}: ${before ?? "unset"})`);
    return;
  }
  if (clear) delete def.hostLoginUrl;
  else def.hostLoginUrl = after;

  await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
  console.log(`${slug}: ${before ?? "unset"} -> ${after ?? "unset"}`);

  // The allow-list is what lets the loader's token postMessage be accepted at all,
  // so a login URL whose origin is not on it would sign the customer in on the
  // portal and then silently ignore the token.
  const origins = (def.allowedOrigins as string[] | undefined) ?? [];
  if (after) {
    const origin = new URL(after).origin;
    const ok = origins.some((o) => {
      try { return new URL(o).origin === origin; } catch { return false; }
    });
    console.log(ok ? `  ${origin} is in allowedOrigins` : `  WARNING: ${origin} is NOT in allowedOrigins — the token handoff will be ignored`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
