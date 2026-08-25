/**
 * Cap how many upload controls one reply may render.
 *
 * FB-1565 ("one ask at a time") is implemented in the renderer: Markdown.tsx
 * stops after uploadCtx.maxUploads controls however many blocks the model emitted.
 * It reads agent.uploadsPerMessage — and that was never set on any agent, so the
 * cap has been inert since it was written. EPGL's own guidance says "Ask for
 * exactly ONE document per turn"; the model emitted two anyway, and both drew.
 *
 * A prompt rule asks the model not to. This makes it so regardless.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/set-uploads-per-message.ts --agent <slug> --count <n> [--env <file>]
 *   npx tsx scripts/set-uploads-per-message.ts --agent <slug> --clear [--env <file>]
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

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
};

async function main() {
  const slug = arg("agent");
  const clear = process.argv.includes("--clear");
  const countRaw = arg("count");
  if (!slug || (!clear && !countRaw)) {
    console.error("usage: --agent <slug> --count <n> | --agent <slug> --clear");
    process.exit(2);
  }
  const count = clear ? undefined : Number(countRaw);
  if (!clear && (!Number.isInteger(count) || (count as number) < 1)) {
    console.error(`--count must be a positive integer, got ${countRaw}`);
    process.exit(2);
  }

  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, slug)).limit(1);
  if (!row) throw new Error(`${slug} not found`);
  const def = row.definition as unknown as { uploadsPerMessage?: number };
  const before = def.uploadsPerMessage;

  if (clear) delete def.uploadsPerMessage;
  else def.uploadsPerMessage = count;

  if (before === def.uploadsPerMessage) {
    console.log(`${slug}: already ${before ?? "(unset)"} — nothing to do`);
    return;
  }
  await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
  console.log(`${slug}: ${before ?? "(unset)"} -> ${def.uploadsPerMessage ?? "(unset)"}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
