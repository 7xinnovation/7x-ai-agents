/**
 * A fact written DURING a turn has to survive the end of it (24 October 2026).
 *
 * Salesforce pushed seven status events for LR-54052 — payment, two status
 * changes, an information request, its resolution, the decision and the
 * issuance — and all seven answered unknown_application. The push endpoint
 * finds the conversation by matching the pushed id against
 * state.data.application_id, and that key was empty.
 *
 * It had been written. The epgl_application_id audit row is there at 12:11:53
 * with {"applicationId": "LR-54052"}, read correctly off their composite
 * response. What removed it was our own turn ending: the chat route finished
 * with one blind saveCase of the whole case, built from the snapshot the engine
 * loaded BEFORE the submission ran. The id was never in that snapshot, so the
 * save put the case back the way it was.
 *
 * mutateCase's row lock was never going to catch this. There is no race — the
 * two writes are seconds apart and in order. The second one is simply blind.
 *
 * Run from apps/web: npx tsx scripts/test-mid-turn-writes-2026-10-24.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { MID_TURN_DATA_KEYS, withMidTurnWrites } from "../lib/conversation";
import { emptyCase, type CaseState } from "@dialog/config";

const here = dirname(fileURLToPath(import.meta.url));
let pass = 0;
const fails: string[] = [];
function check(what: string, ok: boolean) {
  if (ok) pass++;
  else fails.push(what);
}

const base = (data: Record<string, unknown>): CaseState =>
  ({ ...emptyCase(), data: { ...emptyCase().data, ...data } }) as CaseState;

// ---- the defect itself -----------------------------------------------------
{
  const fresh = base({ application_id: "LR-54052", company_name: "7X TEST" });
  const turn = base({ company_name: "7X TEST" }); // the engine never saw the id
  const merged = withMidTurnWrites(fresh, turn);
  check("the application id survives a turn that never knew about it", merged.data.application_id === "LR-54052");
  check("and the turn's own data is still there", merged.data.company_name === "7X TEST");
}

// ---- it only ever adds -----------------------------------------------------
{
  const fresh = base({ application_id: "LR-00001" });
  const turn = base({ application_id: "LR-99999" });
  check("a value the turn carries wins — this restores, it does not revert",
    withMidTurnWrites(fresh, turn).data.application_id === "LR-99999");
}
{
  const fresh = base({});
  const turn = base({ company_name: "X" });
  const merged = withMidTurnWrites(fresh, turn);
  check("nothing invented when the row has nothing", merged.data.application_id === undefined);
  check("and an untouched state is returned as-is", merged === turn);
}
{
  const fresh = base({ unrelated_key: "from the row" });
  const turn = base({});
  check("only the listed keys are restored, never the whole row",
    withMidTurnWrites(fresh, turn).data.unrelated_key === undefined);
}
{
  const fresh = base({ __sf_documents_sent: ["moa"], __viban_finance_notified_at: "2026-10-24T00:00:00Z" });
  const turn = base({});
  const merged = withMidTurnWrites(fresh, turn);
  check("documents already pushed are not forgotten", Array.isArray(merged.data.__sf_documents_sent));
  check("an email already sent is not sent twice", merged.data.__viban_finance_notified_at === "2026-10-24T00:00:00Z");
}
{
  const fresh = base({ application_id: "LR-1" });
  const turn = base({});
  withMidTurnWrites(fresh, turn);
  check("the inputs are not mutated", turn.data.application_id === undefined);
}

// ---- the wiring, which is the half that actually broke ---------------------
{
  const route = readFileSync(join(here, "../app/api/chat/route.ts"), "utf8");
  check("the turn no longer ends with a blind whole-case write",
    !/await saveCase\(session\.caseId, finalState\)/.test(route));
  check("it ends with a merge against the freshest row",
    /await mutateCase\(session\.caseId, \(fresh\) => withMidTurnWrites\(fresh, finalState\)\)/.test(route));

  // The keys are spelled in two files. If one drifts the bug comes back silently.
  for (const [name, literal] of [
    ["VIBAN_NOTIFIED_KEY", "__viban_finance_notified_at"],
    ["SF_DOCS_SENT_KEY", "__sf_documents_sent"],
  ] as const) {
    check(`${name} still spells ${literal}, which MID_TURN_DATA_KEYS repeats`,
      new RegExp(`const ${name} = "${literal}"`).test(route) &&
        (MID_TURN_DATA_KEYS as readonly string[]).includes(literal));
  }

  // The push receiver is on staging and not yet on main, so this branch is
  // checked against whichever of the two it is sitting on. The key it matches
  // on is the whole point of the fix, so it is asserted wherever it exists.
  const pushPath = join(here, "../app/api/epgl/status/route.ts");
  if (existsSync(pushPath)) {
    const push = readFileSync(pushPath, "utf8");
    check("the key the push matches on is the key that is preserved",
      /'data' ->> 'application_id'/.test(push) &&
        (MID_TURN_DATA_KEYS as readonly string[]).includes("application_id"));
  } else {
    check("application_id is preserved, ready for the push receiver to match on",
      (MID_TURN_DATA_KEYS as readonly string[]).includes("application_id"));
  }
}

console.log(fails.length ? `FAIL ${fails.length}\n - ${fails.join("\n - ")}` : "");
console.log(`${pass} checks passed`);
process.exit(fails.length ? 1 : 0);
