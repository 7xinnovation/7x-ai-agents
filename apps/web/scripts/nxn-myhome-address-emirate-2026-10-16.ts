/**
 * MyHome: the delivery address must be in the box's emirate (16 October 2026).
 *
 * Reported: a MyHome box rented in Dubai with an address in Sharjah. The
 * guidance has said since 8 September that a MyHome box is delivered only
 * within its emirate, but nothing said what that means at the ADDRESS step,
 * and the model accepted the Sharjah address. The code now refuses it at the
 * area search, the map pin and the save; this states the rule where the
 * address is asked for, so the customer is asked the right question first.
 *
 * Appended after the existing "WHERE A MYHOME BOX IS DELIVERED" paragraph in
 * every journey that carries it. Idempotent (marker). Applies to nxn-dialog and
 * po-box-sandbox.
 *
 * From apps/web:
 *   npx tsx scripts/nxn-myhome-address-emirate-2026-10-16.ts --env <file>           (dry run)
 *   npx tsx scripts/nxn-myhome-address-emirate-2026-10-16.ts --env <file> --apply
 */
import { databaseUrlFromArgs } from "./lib/envFile";
import { poolFor } from "./lib/pgPool";

const APPLY = process.argv.includes("--apply");
const SLUGS = ["nxn-dialog", "po-box-sandbox"];
export const MARKER = "MYHOME ADDRESS IN THE BOX'S EMIRATE (2026-10-16)";
const ANCHOR = "WHERE A MYHOME BOX IS DELIVERED (2026-09-08)";
export const RULE =
  ` ${MARKER}: so the DELIVERY ADDRESS of a MyHome or MyHome Instant box must be in the SAME emirate as the box. ` +
  `When you ask for the address, say which emirate it has to be in ("your address in Dubai"). If the customer gives an address, area or map pin in another emirate, do NOT record it and do NOT continue: tell them a MyHome box in <emirate> delivers only within <emirate>, and offer the choices — an address in <emirate>, renting the box in the emirate they live in instead (emirate, branch and box are then chosen again), or a MyBox collected at the branch. ` +
  `Never send an address emirate different from the box's; the save refuses it.`;

/** The guidance with the rule after the anchor's paragraph, or null when there is nothing to do. */
export function withRule(guidance: string): string | null {
  if (!guidance.includes(ANCHOR) || guidance.includes(MARKER)) return null;
  const at = guidance.indexOf(ANCHOR);
  const end = guidance.indexOf("\n", at);
  const cut = end === -1 ? guidance.length : end;
  return guidance.slice(0, cut) + RULE + guidance.slice(cut);
}

async function main() {
  const pool = await poolFor(databaseUrlFromArgs());
  try {
    for (const slug of SLUGS) {
      const { rows } = await pool.query(`select id, definition from agents where slug = $1`, [slug]);
      if (!rows[0]) {
        console.log(`${slug}: not on this database`);
        continue;
      }
      const def = rows[0].definition;
      const changed: string[] = [];
      for (const j of def.journeys ?? []) {
        const next = withRule(j.guidance ?? "");
        if (next) {
          j.guidance = next;
          changed.push(j.key);
        }
      }
      console.log(`${slug}: ${changed.length ? `~ ${changed.join(", ")}` : "already up to date"}`);
      if (APPLY && changed.length) {
        await pool.query(`update agents set definition = $1::jsonb, updated_at = now() where id = $2`, [JSON.stringify(def), rows[0].id]);
        await pool.query(`insert into audit_log (agent_id, actor, action, payload) values ($1, 'system', 'guidance_updated', $2::jsonb)`, [
          rows[0].id,
          JSON.stringify({ by: "script:nxn-myhome-address-emirate-2026-10-16", journeys: changed, marker: MARKER }),
        ]);
      }
    }
    if (!APPLY) console.log("\nDry run. Add --apply to write.");
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
