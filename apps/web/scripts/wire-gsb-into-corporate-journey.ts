/**
 * Make the corporate journey actually USE the GSB lookups (2026-08-14).
 *
 * The tools have existed for a while; the journey never called them. Its Stage 2
 * still said "the GSB ownership check is NOT integrated in this environment, so
 * you CANNOT verify that the customer's Emirates ID matches an owner" — true when
 * written, stale now, and an instruction not to do the thing we just built.
 *
 * The flow was described as: ask for the Emirates ID, then issuing entity and
 * companies as dropdowns keyed off it. Two corrections came out of the API:
 *
 *  - `entityCode` is an ISSUING AUTHORITY code, not an Emirates ID, and no
 *    endpoint is keyed by Emirates ID. It appears only in ownerDetails[] on the
 *    by-licence response, so it CHECKS ownership rather than filtering a list.
 *
 *  - We should not ask for it at all. GET /api/v1/Account returns the signed-in
 *    customer's emiratesId, so the chat route now surfaces it as a verified fact.
 *    Asking the customer to type it would be both redundant and unsafe: a typed
 *    Emirates ID would let anyone claim ownership of any licence.
 *
 * So the order is: authority (real dropdown, works today) -> trade licence number
 * -> company + owners -> ownership checked against the VERIFIED Emirates ID.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/wire-gsb-into-corporate-journey.ts [--env <file>] [--dry-run]
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
const dryRun = process.argv.includes("--dry-run");
const MARKER = "GSB TRADE LICENCE CHECK (2026-08-14):";

/** The sentence that told the agent the check did not exist. */
const STALE =
  "Stage 2 Trade License verification: the GSB ownership check is NOT integrated in this environment, so you CANNOT verify that the customer's Emirates ID matches an owner on the trade license — never say or imply that you checked, matched, or verified ownership against a government source.";

const REPLACEMENT =
  "Stage 2 Trade License verification: use the GSB lookups (see the rule at the end of this guidance). Never say you checked ownership against a government source unless " +
  "nxn_company_by_licence actually returned a verdict — an unrun check reported as passed is worse than no check.";

const RULE =
  `${MARKER} Verify the trade licence in this order, and never skip to typing.\n` +
  "1) ISSUING AUTHORITY. Call nxn_issuing_authorities and let the customer pick from what it returns. Record the entCode, not the display name — every later call matches on the code.\n" +
  "2) TRADE LICENCE NUMBER. Ask for it, or read it off the uploaded licence.\n" +
  "3) COMPANY + OWNERSHIP. Call nxn_company_by_licence with that authority code, the licence number, and — when the customer is signed in — the VERIFIED Emirates ID given to you in the known-customer note. Never pass an Emirates ID the customer typed: a typed one would let anyone claim ownership of any licence. Confirm the company name it returns instead of asking them to type it.\n" +
  "   - OWNERSHIP CONFIRMED: say the licence is registered to them and carry on.\n" +
  "   - OWNERSHIP NOT CONFIRMED: do not refuse them outright. Say the licence is registered to someone else, ask whether they are acting for the company, and route to document review.\n" +
  "   - OWNERSHIP UNKNOWN: say NOTHING about ownership either way and continue with document review. Unknown means the owner records carry no readable Emirates ID — it is not a failed check, and reporting it as one turns away real owners.\n" +
  "4) If a lookup cannot run (it needs the customer's Emirates Post session), say so plainly, continue on the uploaded documents, and never present an unverified licence as verified. " +
  "nxn_companies_by_authority lists the companies under one authority and is a fallback for a customer who cannot find their licence number — it is not a substitute for the ownership check.";

interface Journey { key: string; guidance?: string; [k: string]: unknown }

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`${SLUG} not found`);
  const def = row.definition as unknown as { journeys: Journey[] };

  const j = def.journeys.find((x) => x.key === "corporate_po_box_rental");
  if (!j) throw new Error("corporate_po_box_rental not found");

  const changes: string[] = [];
  let g = String(j.guidance ?? "");

  if (g.includes(STALE)) {
    g = g.replace(STALE, REPLACEMENT);
    changes.push("removed the stale 'GSB is NOT integrated' instruction");
  } else if (!g.includes(REPLACEMENT)) {
    console.log("  ! the stale Stage 2 sentence was not found — guidance has drifted, check it by hand");
  }

  if (g.includes(MARKER)) {
    console.log("  (skip) GSB rule already present");
  } else {
    g = `${g.trimEnd()}\n\n${RULE}`;
    changes.push("added the ordered GSB verification flow");
  }

  if (!changes.length) {
    console.log("nothing to do — already applied");
    return;
  }
  for (const c of changes) console.log(`  + ${c}`);
  if (dryRun) {
    console.log("\n--dry-run, nothing written");
    return;
  }
  j.guidance = g;
  await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
  console.log(`\ncorporate_po_box_rental guidance is now ${g.length} chars.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
