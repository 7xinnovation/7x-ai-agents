/**
 * MyHome: the delivery address is asked LATE and ONCE (16 October 2026).
 *
 * Reported the same afternoon: right after "MyHome" was picked the agent asked
 * for the home address and offered the map pin, then backtracked to the branch,
 * and after the authorised-agent step asked for the address a second time.
 *
 * Cause: the "revised 2026-10-16" paragraph (nxn-myhome-any-emirate) replaced
 * the 8 September one, which anchored its remark to the moment the EMIRATE is
 * chosen. The replacement talked only about the address and gave no moment, so
 * the model reached for it at the bundle. This rewrites that paragraph: any
 * emirate is still fine, and the timing is spelled out. Idempotent.
 *
 * From apps/web:
 *   npx tsx scripts/nxn-myhome-address-timing-2026-10-16.ts --env <file>           (dry run)
 *   npx tsx scripts/nxn-myhome-address-timing-2026-10-16.ts --env <file> --apply
 */
import { databaseUrlFromArgs } from "./lib/envFile";
import { poolFor } from "./lib/pgPool";

const APPLY = process.argv.includes("--apply");
const SLUGS = ["nxn-dialog", "po-box-sandbox"];

/** The paragraph written earlier on 16 October, from its heading to its last sentence. */
const PREVIOUS = /WHERE A MYHOME BOX IS DELIVERED \(revised 2026-10-16\):[\s\S]*?fails without it\./;

export const MARKER = "WHERE A MYHOME BOX IS DELIVERED, AND WHEN TO ASK (revised 2026-10-16 pm)";
export const RULE =
  `${MARKER}: a MyHome or MyHome Instant box may be delivered to an address in ANY emirate of the UAE — not only the emirate the box is registered in. A Dubai box for a customer who lives in Sharjah is a normal rental: never warn, refuse or suggest moving the box because of it. ` +
  `Record the address with ITS OWN emirate code (Sharjah is SHJ even for a Dubai box), search its area in that emirate, and send that emirate as myHomeProfile.myHomeAddress.emirateCode. ` +
  `WHEN TO ASK — this is strict. Choosing MyHome is NOT the moment to ask for the address: in the reply to the bundle choice do not ask for an address, do not mention pinning a location, and do not emit a \`\`\`locate block — go straight on to the next question (emirate, then branch). ` +
  `Ask for the delivery address exactly ONCE: after the branch, the box number and the duration are chosen and the authorised-agent question is answered, and before the order summary (see WHEN THE MYHOME ADDRESS IS TAKEN). ` +
  `If the customer gives an address or drops a pin earlier anyway, keep it — say you will use it for delivery — carry on with the question you were on, and when you reach the address step confirm THAT address instead of asking for it again.`;

export function revised(guidance: string): string | null {
  if (guidance.includes(MARKER)) return null;
  if (!PREVIOUS.test(guidance)) return null;
  return guidance.replace(PREVIOUS, RULE);
}

async function main() {
  const pool = await poolFor(databaseUrlFromArgs());
  try {
    for (const slug of SLUGS) {
      const { rows } = await pool.query(`select id, definition from agents where slug = $1`, [slug]);
      if (!rows[0]) { console.log(`${slug}: not on this database`); continue; }
      const def = rows[0].definition;
      const changed: string[] = [];
      for (const j of def.journeys ?? []) {
        const next = revised(j.guidance ?? "");
        if (next) { j.guidance = next; changed.push(j.key); }
      }
      const has = (def.journeys ?? []).filter((j: { guidance?: string }) => (j.guidance ?? "").includes(MARKER)).map((j: { key: string }) => j.key);
      console.log(`${slug}: ${changed.length ? `~ ${changed.join(", ")}` : "nothing to change"}  (carries the rule: ${has.join(", ") || "none"})`);
      if (APPLY && changed.length) {
        await pool.query(`update agents set definition = $1::jsonb, updated_at = now() where id = $2`, [JSON.stringify(def), rows[0].id]);
        await pool.query(`insert into audit_log (agent_id, actor, action, payload) values ($1, 'system', 'guidance_updated', $2::jsonb)`, [
          rows[0].id, JSON.stringify({ by: "script:nxn-myhome-address-timing-2026-10-16", journeys: changed, marker: MARKER }),
        ]);
      }
    }
    if (!APPLY) console.log("\nDry run. Add --apply to write.");
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
