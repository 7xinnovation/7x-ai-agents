/**
 * Send callback requests to Emirates Post's own enquiry form (2026-09-04).
 *
 * Their /nextApi/case endpoint is CAPTCHA-gated -- every server-to-server call
 * answers 403 "Invalid CAPTCHA token", and Cloudflare Turnstile issues its token
 * to a browser, not to us. Until that is resolved the customer is pointed at the
 * form they would have filled in anyway, which is Emre's decision and the honest
 * interim: it goes into the same queue, and nothing is promised that did not
 * happen.
 *
 * The URL differs per environment, so it is chosen from the agent's own
 * activeEnvironment rather than hard-coded -- a staging assistant handing out the
 * production form would file test enquiries in the live queue.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/nxn-callback-link-2026-09-04.ts [--env <file>] [--dry-run] [--remove]
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

const SLUG = "nxn-dialog";
const DRY = process.argv.includes("--dry-run");
const REMOVE = process.argv.includes("--remove");
const MARKER = "CALLBACKS AND ENQUIRIES";
/**
 * The guidance below contains blank lines, so splitting the prompt on paragraphs
 * and dropping the ones that mention the MARKER removed only its FIRST paragraph
 * and left the rest behind -- then appended the whole block again. Two runs, and
 * the prompt was carrying one and a half copies. Every paragraph of the block is
 * identified instead, by phrases that appear nowhere else.
 */
const BLOCK_MARKERS = [MARKER, "Raise an enquiry](", "you have not created one", "want to speak to someone"];
const stripBlock = (prompt: string) =>
  prompt
    .split("\n\n")
    .filter((para) => !BLOCK_MARKERS.some((m) => para.includes(m)))
    .join("\n\n")
    .trim();

const ENQUIRY_URL: Record<string, string> = {
  staging: "https://www-stg.emiratespost.ae/contact-us/raise-an-enquiry",
  production: "https://www.emiratespost.ae/contact-us/raise-an-enquiry",
};

const guidanceFor = (url: string) =>
  `${MARKER} — when the customer asks for a callback, to speak to someone, or to raise a complaint or enquiry, ` +
  `give them Emirates Post's enquiry form: [Raise an enquiry](${url}). Say plainly that it opens Emirates Post's ` +
  `own enquiry page and that the team replies from there. ` +
  `\n\nDo NOT say you have logged, raised, submitted or filed anything, and do not invent a case or reference ` +
  `number — you have not created one, and a customer who believes a case exists will wait for a call that is not ` +
  `coming. Offer the link INSTEAD of claiming to have arranged the callback yourself. ` +
  `\n\nBefore handing it over, try once to actually answer them: most "I want to speak to someone" comes after ` +
  `something went wrong that you can still fix. If it is a question you can answer, answer it. If they still want ` +
  `a person, give them the link without argument.`;

/**
 * `persona` is the field, not `systemPrompt`.
 *
 * The definition is validated by a zod schema that STRIPS unknown keys, so an
 * earlier version of this script wrote a systemPrompt key that the runtime threw
 * away on read: the script reported success, a second run reported the guidance
 * already present, and the assistant never saw a word of it. Anything left over
 * from that is cleaned up below.
 */
interface Def { persona?: string; systemPrompt?: string; activeEnvironment?: string; [k: string]: unknown }

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`${SLUG} not found`);
  const def = row.definition as unknown as Def;
  const env = def.activeEnvironment ?? "production";
  const url = ENQUIRY_URL[env];
  if (!url) throw new Error(`no enquiry URL for environment "${env}"`);

  // Clear the key the earlier version wrote to, if it is ours.
  if (typeof def.systemPrompt === "string" && def.systemPrompt.includes(MARKER)) {
    const leftover = stripBlock(def.systemPrompt);
    if (leftover) def.systemPrompt = leftover;
    else delete def.systemPrompt;
    console.log("  (cleaned a stray systemPrompt key from an earlier run)");
  }
  const prompt = String(def.persona ?? "");
  const has = prompt.includes(MARKER);

  if (REMOVE) {
    if (!has) { console.log("nothing to do — no callback guidance present."); return; }
    def.persona = stripBlock(prompt);
    console.log("- callback guidance removed");
  } else {
    // Replace rather than append, so a re-run with a different environment
    // corrects the URL instead of leaving two of them in the prompt.
    const without = stripBlock(prompt);
    const next = `${without}\n\n${guidanceFor(url)}`.trim();
    if (next === prompt) { console.log(`nothing to do — already pointing at ${url}`); return; }
    def.persona = next;
    console.log(`${has ? "~" : "+"} callback guidance → ${url}  (${env})`);
  }

  if (DRY) { console.log("\n--dry-run: nothing written."); return; }
  await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
  console.log("\nwritten.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
