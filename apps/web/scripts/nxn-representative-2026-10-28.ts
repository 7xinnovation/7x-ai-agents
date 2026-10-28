/**
 * The service is a REPRESENTATIVE, not an "authorised agent" (2026-10-28).
 *
 * Emirates Post asked for the customer-facing name of this add-on to change.
 * Two surfaces were named, with the Arabic alongside:
 *
 *   on the card:          Add a representative      إضافة مندوب
 *   in the summary line:  Representative · Included  مندوب · مشمول
 *
 * Both of those are WRITTEN BY THE MODEL from the journey guidance — there is
 * no template to edit — so the rename is a guidance change, and it has to be
 * the whole vocabulary rather than the two strings. An assistant whose card
 * says "Add a representative" and whose side panel still has a step titled
 * "Authorized agent (optional)" has not been renamed; it has been renamed in
 * one place, which reads as a bug.
 *
 * So every customer-facing occurrence moves together: the intent description,
 * the step titles, the field labels, the manage-a-box options, and the prose in
 * all five journey guidances, in English and Arabic.
 *
 * NOTHING INTERNAL IS RENAMED, and that is deliberate. `add_agent` is still
 * `add_agent`; the uploads are still `agent_eid_front` / `agent_eid_back`; and
 * `listBoxAgentDetail`, `ADD_AGENT` and `REMOVE_AGENT` are Emirates Post's own
 * payload keys, not ours to restyle. Renaming a field key would orphan every
 * value already collected against it, and renaming a payload key would simply
 * be rejected. The replacements below are whole phrases for that reason — never
 * a bare "agent", which appears inside all of those tokens.
 *
 * Idempotent: a second run finds nothing to replace and reports "already".
 * Run from apps/web:
 *   npx tsx scripts/nxn-representative-2026-10-28.ts --env <file> [--dry-run]
 */
import { databaseUrlFrom } from "./lib/envFile";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { agents } from "@dialog/db";
import { eq } from "drizzle-orm";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const ENV = arg("--env");
if (!ENV) throw new Error("--env <envfile> is required");
const DRY = process.argv.includes("--dry-run");
const SLUG = "nxn-dialog";
const MARKER = "THE WORD IS REPRESENTATIVE (2026-10-28)";

/**
 * Longest first, and the article forms BEFORE the bare phrase.
 *
 * "an authorised agent" has to be caught as a unit or the article is left
 * behind: a blind "authorised agent" -> "representative" turns the field label
 * "Add an authorized agent?" into "Add an representative?". Both spellings are
 * live — the labels were written -ized and the guidance -ised — so both are
 * listed rather than normalised first, which would make the counts lie.
 */
const PHRASES: [string, string][] = [
  // The service term, with its article.
  ["an authorised agent", "a representative"],
  ["an authorized agent", "a representative"],
  ["An authorised agent", "A representative"],
  ["An authorized agent", "A representative"],
  ["authorised agents", "representatives"],
  ["authorized agents", "representatives"],
  ["AUTHORISED AGENT", "REPRESENTATIVE"],
  ["AUTHORIZED AGENT", "REPRESENTATIVE"],
  ["Authorised agent", "Representative"],
  ["Authorized agent", "Representative"],
  ["Authorised Agent", "Representative"],
  ["Authorized Agent", "Representative"],
  ["authorised agent", "representative"],
  ["authorized agent", "representative"],

  /**
   * And the places the guidance says plain "agent" and means this service.
   * Each one is quoted in full from the live text, so a phrase that has since
   * been reworded is reported as not-found rather than half-matched.
   */
  ["Stage 2 Add Agent (OPTIONAL)", "Stage 2 Add Representative (OPTIONAL)"],
  ["'Add an agent to this PO Box?'", "'Add a representative to this PO Box?'"],
  ["'No agent for now'", "'No representative for now'"],
  ["the first agent is included", "the first representative is included"],
  ["The first agent is Inclusive", "The first representative is Inclusive"],
  ["a SECOND agent would cost", "a SECOND representative would cost"],
  ["Agents BEYOND the first are charged", "Representatives BEYOND the first are charged"],
  ["the registration fee AND the first agent", "the registration fee AND the first representative"],
  ["add an agent to it", "add a representative to it"],
  ["an agent whose Emirates ID has expired", "a representative whose Emirates ID has expired"],
  ["the agent's full name, ID number and EID expiry", "the representative's full name, ID number and EID expiry"],
  ["Then ask agent email + phone.", "Then ask the representative's email + phone."],
  ["the agent can be added later", "the representative can be added later"],
  ["proceed with NO agent", "proceed with NO representative"],
  ["proceed with no agent.", "proceed with no representative."],

  /**
   * The second pass. A preview of the renamed text, printing every line that
   * still said "agent", found ten the phrase list above walked straight past —
   * among them the CORPORATE journey's own stage heading (Stage 4, not Stage
   * 2), a hyphenated "authorised-agent", and the two lines that tell the model
   * what rows to put in the summary block. Those last two are the ones the
   * customer actually reads, so a rename that stopped at the first pass would
   * have shipped a card saying "representative" above a summary line that
   * still said "agent".
   */
  ["Stage 4 Add Agent (OPTIONAL)", "Stage 4 Add Representative (OPTIONAL)"],
  ["the authorised-agent question", "the representative question"],
  ["agent (if added)", "representative (if added)"],
  ["each extra agent", "each extra representative"],
  ["cheaper per agent than", "cheaper per representative than"],
  ["the agent lines beside it", "the representative lines beside it"],
  ["auto-renew and agent status", "auto-renew and representative status"],
  ["changing bundle/branch/agent/delivery", "changing bundle/branch/representative/delivery"],

  /**
   * Arabic. "وكيل مفوّض" is the old term; "مندوب" is the one they asked for.
   * The definite form goes first so "الوكيل المفوّض" becomes "المندوب" rather
   * than "الـمندوب", and both the shadda and no-shadda spellings are listed
   * because both are in the file.
   */
  ["الوكيل المفوّض", "المندوب"],
  ["الوكيل المفوض", "المندوب"],
  ["وكيل مفوّض", "مندوب"],
  ["وكيل مفوض", "مندوب"],
  ["وكلاء مفوّضين", "مندوبين"],
  ["وكلاء مفوضين", "مندوبين"],
];

/**
 * The two surfaces Emirates Post named, pinned so the model cannot drift back.
 *
 * The summary row is specified down to the value: `Included` is not decoration,
 * it is the statement that the first one is inside Emirates Post's reservation
 * amount. Adding its list price on top of a total that already contains it is a
 * bug we have had — AED 450 quoted on a 400 rental, refused with "121
 * MISMATCH_IN_AMOUNT: TotalAmountShouldBe:400".
 */
const RULE =
  ` ${MARKER}. Emirates Post renamed this add-on in the customer's words: it is a REPRESENTATIVE.` +
  ` The older wording — "authorised", "authorized", or a bare "agent" — is not used for it with the customer, in either language.` +
  ` THE CARD: its title reads exactly \`Add a representative\` — in an Arabic conversation \`إضافة مندوب\` — and the declining card reads \`No representative for now\` (\`بدون مندوب حالياً\`) with no price line at all.` +
  ` THE SUMMARY ROW: it reads exactly \`Representative\` against the value \`Included\` — in Arabic \`مندوب\` against \`مشمول\` — and nothing else on the line: no name, no figure, no "No charge", no parenthesis.` +
  ` Included is the true word because the reservation amount already contains the first one; their details stay in the panel where they were collected, which is where a name belongs.` +
  ` NOTHING INTERNAL CHANGES: the field is still add_agent, the uploads are still agent_eid_front and agent_eid_back, and listBoxAgentDetail, ADD_AGENT and REMOVE_AGENT are Emirates Post's payload keys — send them exactly as they are.`;

/**
 * THE RULE MUST NOT MATCH THE RENAME, or it edits itself.
 *
 * Checked here rather than trusted, because the first draft failed it: it said
 * `Never call it an "authorised agent"` and the rename obligingly turned that
 * into `Never call it a "representative"`. Stripping the block before the
 * rename (below) already fixes the damage; this stops the wording from drifting
 * back into a shape where the order of two operations is load-bearing.
 */
const selfMatch = PHRASES.filter(([find]) => RULE.includes(find)).map(([find]) => find);
if (selfMatch.length) throw new Error(`RULE contains phrases this script renames: ${selfMatch.join(" | ")}`);

/**
 * Other rules that live in this guidance, so a slice that would swallow one is
 * refused rather than performed.
 */
const OTHER_MARKERS = [
  "ADD-ONS ARE CARDS (2026-09-30",
  "THE TIME OF AN ACCEPTANCE IS NOT YOURS TO WRITE (2026-09-15)",
  "SIGNED-IN FAST PATH, TWO TAPS (2026-10-08)",
  "CORPORATE QA (2026-08-14)",
  "ONE-TAP RENEWAL OPENER, READ FIRST (2026-10-11)",
  "FEEDBACK RULES (2026-07-31)",
];

/** Tokens that contain "agent" and must survive untouched. */
const PROTECTED = [
  "add_agent",
  "agent_eid_front",
  "agent_eid_back",
  "listBoxAgentDetail",
  "ADD_AGENT",
  "REMOVE_AGENT",
];

const counts = new Map<string, number>();

function rename(s: string): string {
  let out = s;
  for (const [find, replace] of PHRASES) {
    if (!out.includes(find)) continue;
    counts.set(find, (counts.get(find) ?? 0) + out.split(find).length - 1);
    out = out.split(find).join(replace);
  }
  return out;
}

/** Walk every string in the definition, leaving the shape alone. */
function walk(node: unknown): unknown {
  if (typeof node === "string") return rename(node);
  if (Array.isArray(node)) return node.map(walk);
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) out[k] = walk(v);
    return out;
  }
  return node;
}

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrlFrom(ENV!) });
  const db = drizzle(pool, { schema: { agents } });
  try {
    const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG));
    if (!row) throw new Error(`No agent ${SLUG} in this database`);
    const before = JSON.stringify(row.definition);
    console.log(`${SLUG}: definition is ${before.length} chars, last written ${row.updatedAt?.toISOString?.() ?? "?"}`);

    /**
     * A RULE ALREADY IN PLACE COMES OFF BEFORE THE RENAME, NOT AFTER.
     *
     * The rule's job is to forbid the old words, so it has to be able to say
     * them — and the rename does not know the difference between a word being
     * used and a word being quoted. Run the other way round, a second pass
     * rewrites the prohibition into "the older wording is not used", with the
     * wording it names gone. The block is therefore stripped here, renamed
     * along with everything else as whatever is left, and appended fresh
     * below, which also makes the script genuinely idempotent: run it twice and
     * the second run reports nothing to write.
     */
    const parsed = JSON.parse(before) as Record<string, unknown>;
    for (const j of (parsed.journeys as Record<string, unknown>[]) ?? []) {
      const g = String(j.guidance ?? "");
      const at = g.indexOf(` ${MARKER}`);
      if (at === -1) continue;
      /**
       * Slicing to a marker is only safe while the block runs to the END of the
       * guidance, and this is the failure that cost 4,047 characters of live
       * EPGL guidance on 27 October: a script kept only what followed its own
       * marker, which was right until another block was prepended in front of
       * it. So the tail is checked before it is trusted — short enough to be
       * this rule and nothing else, and carrying no other rule's marker.
       */
      const tail = g.slice(at);
      const intruder = OTHER_MARKERS.find((m) => tail.includes(m));
      if (intruder) throw new Error(`${String(j.key)}: "${intruder}" sits AFTER this rule — refusing to slice`);
      if (tail.length > 2500) throw new Error(`${String(j.key)}: the tail after the marker is ${tail.length} chars, too long to be this rule alone — refusing to slice`);
      j.guidance = g.slice(0, at);
      console.log(`  - ${String(j.key)}: lifted the previous ${MARKER} block (${tail.length} chars)`);
    }

    /**
     * The baseline for the protected-token check is the text the rename will
     * actually see — after the old rule block has been lifted, before the new
     * one goes on. Measured against the raw `before` it counts five copies of
     * a rule that is about to be removed and reports six tampered keys;
     * measured against the final text it counts five copies of the rule about
     * to be added and reports the same six the other way up. Neither of those
     * is the rename, which is the thing being checked.
     */
    const baseline = JSON.stringify(parsed);
    const protectedBefore = PROTECTED.map((t) => [t, baseline.split(t).length - 1] as const);

    const def = walk(parsed) as Record<string, unknown>;

    /**
     * MEASURED BEFORE THE PIN GOES IN, or the check marks its own work wrong.
     * The rule below names every protected token once, in the sentence telling
     * the model not to rename them, so appending it to five journeys adds five
     * to each count — which the first run duly reported as six tampered keys.
     * What is being checked is the RENAME, so it is checked on the rename.
     */
    const afterRename = JSON.stringify(def);

    // The pin, once per journey, appended the way every other rule here is.
    for (const j of (def.journeys as Record<string, unknown>[]) ?? []) {
      const g = String(j.guidance ?? "");
      if (!g || g.includes(MARKER)) continue;
      j.guidance = g + RULE;
      console.log(`  + ${String(j.key)}: ${MARKER}`);
    }

    const after = JSON.stringify(def);

    console.log("\nreplacements:");
    const found = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    if (!found.length) console.log("  (none — the vocabulary is already renamed)");
    for (const [find, n] of found) console.log(`  ${String(n).padStart(3)} × ${find}`);
    const missed = PHRASES.filter(([f]) => !counts.has(f)).map(([f]) => f);
    if (missed.length) console.log(`\nnot present: ${missed.join(" | ")}`);

    /**
     * The check that matters: a field key or an Emirates Post payload key lost
     * here would not show up until a customer's answer went nowhere.
     */
    console.log("\nprotected tokens (before → after):");
    let broke = false;
    for (const [t, n] of protectedBefore) {
      const now = afterRename.split(t).length - 1;
      console.log(`  ${t}: ${n} → ${now}${n === now ? "" : "   ⚠ CHANGED"}`);
      if (n !== now) broke = true;
    }
    if (broke) throw new Error("a protected token changed — refusing to write");

    const left = (afterRename.match(/[Aa]uthoris\w*[ -]agent|[Aa]uthoriz\w*[ -]agent|وكيل مفو/g) ?? []).length;
    // Counted on the rename too: the rule itself quotes the old words in order
    // to forbid them, and a check that trips over its own prohibition is noise.
    console.log(`\nold term still present afterwards: ${left}`);

    console.log(`definition ${before.length} → ${after.length} chars`);
    if (after === before) {
      console.log("\nAlready applied — nothing written.");
      return;
    }
    if (DRY) {
      console.log("\n--dry-run: NOT written.");
      return;
    }
    await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
    console.log("\nWritten.");
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
