/**
 * MyHome: the delivery address may be in any emirate (16 October 2026).
 *
 * Decided by 7X on 16 October: a MyHome box registered in one emirate may be
 * delivered to an address in another (a Dubai box for a customer living in
 * Sharjah is accepted). This reverses two guidance paragraphs:
 *
 *  - "WHERE A MYHOME BOX IS DELIVERED (2026-09-08)", which said delivery is
 *    ONLY within the box's emirate, is replaced by the rule below;
 *  - "MYHOME ADDRESS IN THE BOX'S EMIRATE (2026-10-16)", added earlier the same
 *    day to enforce the old rule, is removed.
 *
 * The code was changed in the same commit: the save checks the area against
 * the ADDRESS's emirate, and the map pin and the area search accept another
 * emirate. Idempotent. Applies to nxn-dialog and po-box-sandbox.
 *
 * From apps/web:
 *   npx tsx scripts/nxn-myhome-any-emirate-2026-10-16.ts --env <file>           (dry run)
 *   npx tsx scripts/nxn-myhome-any-emirate-2026-10-16.ts --env <file> --apply
 */
import { databaseUrlFromArgs } from "./lib/envFile";
import { poolFor } from "./lib/pgPool";

const APPLY = process.argv.includes("--apply");
const SLUGS = ["nxn-dialog", "po-box-sandbox"];

export const MARKER = "WHERE A MYHOME BOX IS DELIVERED (revised 2026-10-16)";
export const RULE =
  `${MARKER}: a MyHome or MyHome Instant box may be delivered to an address in ANY emirate of the UAE — it does not have to be the emirate the box is registered in. ` +
  `A customer renting a box in Dubai who lives in Sharjah gives their Sharjah address, and that is a normal rental. When you ask for the address, do not say which emirate it must be in, and never warn, refuse or suggest moving the box because the address is in another emirate. ` +
  `Record the address with ITS OWN emirate code (Sharjah is SHJ even for a Dubai box), search its area in that emirate, and send that emirate as myHomeProfile.myHomeAddress.emirateCode. ` +
  `The order of questions does not change: the emirate and branch still come before the address, because the save needs the delivery office and fails without it.`;

/** The 8 September paragraph, from its heading to its last sentence. */
const OLD_RULE = /WHERE A MYHOME BOX IS DELIVERED \(2026-09-08\):[\s\S]*?fails without it\./;
/** The paragraph added earlier on 16 October, which this reverses. */
const WRONG_RULE = /\s*MYHOME ADDRESS IN THE BOX'S EMIRATE \(2026-10-16\):[\s\S]*?the save refuses it\./;

export function revised(guidance: string): string | null {
  let g = guidance;
  if (WRONG_RULE.test(g)) g = g.replace(WRONG_RULE, "");
  if (OLD_RULE.test(g)) g = g.replace(OLD_RULE, RULE);
  return g === guidance ? null : g;
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
        const next = revised(j.guidance ?? "");
        if (next) {
          j.guidance = next;
          changed.push(j.key);
        }
      }
      const left = (def.journeys ?? []).filter((j: { guidance?: string }) => /delivered ONLY within the emirate|MYHOME ADDRESS IN THE BOX'S EMIRATE/.test(j.guidance ?? "")).map((j: { key: string }) => j.key);
      console.log(`${slug}: ${changed.length ? `~ ${changed.join(", ")}` : "already up to date"}${left.length ? `  (old wording still in: ${left.join(", ")})` : ""}`);
      if (APPLY && changed.length) {
        await pool.query(`update agents set definition = $1::jsonb, updated_at = now() where id = $2`, [JSON.stringify(def), rows[0].id]);
        await pool.query(`insert into audit_log (agent_id, actor, action, payload) values ($1, 'system', 'guidance_updated', $2::jsonb)`, [
          rows[0].id,
          JSON.stringify({ by: "script:nxn-myhome-any-emirate-2026-10-16", journeys: changed, marker: MARKER }),
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
