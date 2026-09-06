/**
 * Per-account agent scope (2026-09-06).
 *
 * A viewer given "nxn-dialog" must see Emirates Post and nothing else — not the
 * EPGL editor, not EPGL conversations, not an EPGL-wide analytics total. The
 * rules that decide this are small and pure; this pins them.
 *
 * The one that is easy to get wrong is the empty list: empty means EVERY agent,
 * because that is what every account had before the column existed. A scope
 * only ever exists to narrow.
 *
 * Run from apps/web:
 *   npx tsx scripts/test-agent-scope-2026-09-06.ts
 */
import { canSeeAgent, scopeApplies } from "@/lib/users";
import { sessionCanSee } from "@/lib/session";
import { withinScope, selectAgent } from "@/lib/scope";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => {
  console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : extra ?? "");
  ok ? pass++ : fail++;
};

const NXN = { slug: "nxn-dialog", name: "Emirates Post" };
const EPGL = { slug: "epgl-dialog", name: "EPGL" };
const BOTH = [NXN, EPGL];

// ── who a scope applies to ──────────────────────────────────────────────────
check("a viewer can be scoped", scopeApplies("viewer"));
check("an editor can be scoped", scopeApplies("editor"));
check("an admin cannot — they can lift it themselves", !scopeApplies("admin"));
check("an owner cannot", !scopeApplies("owner"));

// ── canSeeAgent ─────────────────────────────────────────────────────────────
check("no scope means every agent", canSeeAgent({ role: "viewer", agentScope: [] }, "epgl-dialog"));
check("a null scope means every agent", canSeeAgent({ role: "viewer", agentScope: null }, "epgl-dialog"));
check("a scoped viewer sees the named agent", canSeeAgent({ role: "viewer", agentScope: ["nxn-dialog"] }, "nxn-dialog"));
check("...and not the other one", !canSeeAgent({ role: "viewer", agentScope: ["nxn-dialog"] }, "epgl-dialog"));
check("two named agents are both visible", canSeeAgent({ role: "viewer", agentScope: ["nxn-dialog", "epgl-dialog"] }, "epgl-dialog"));
check("an admin's scope is ignored", canSeeAgent({ role: "admin", agentScope: ["nxn-dialog"] }, "epgl-dialog"));
check("an owner's scope is ignored", canSeeAgent({ role: "owner", agentScope: ["nxn-dialog"] }, "epgl-dialog"));

// ── the edge copy, carried in the session cookie ────────────────────────────
const claims = (role: any, scope?: string[]) => ({ uid: "u", email: "e", role, scope, exp: 0 });
check("no session sees nothing", !sessionCanSee(null, "nxn-dialog"));
check("an unscoped session sees everything", sessionCanSee(claims("viewer"), "epgl-dialog"));
check("an empty scope sees everything", sessionCanSee(claims("viewer", []), "epgl-dialog"));
check("a scoped session is held to it", !sessionCanSee(claims("viewer", ["nxn-dialog"]), "epgl-dialog"));
check("...and admins are not", sessionCanSee(claims("admin", ["nxn-dialog"]), "epgl-dialog"));

// ── the list, and what "all agents" resolves to ─────────────────────────────
check("no scope leaves the list alone", withinScope(BOTH, null).length === 2);
check("a scope narrows the list", JSON.stringify(withinScope(BOTH, ["epgl-dialog"])) === JSON.stringify([EPGL]));
check("a scope naming an agent that is gone yields nothing", withinScope(BOTH, ["deleted"]).length === 0);

check("unscoped, no param means all agents", selectAgent(BOTH, undefined, null) === undefined);
check("unscoped, a param selects it", selectAgent(BOTH, "epgl-dialog", null) === EPGL);
check(
  "SCOPED, no param falls to their own agent — never an all-agents total",
  selectAgent(withinScope(BOTH, ["epgl-dialog"]), undefined, ["epgl-dialog"]) === EPGL
);
check(
  "SCOPED, a param outside the scope does NOT fall back to everything",
  selectAgent(withinScope(BOTH, ["epgl-dialog"]), "nxn-dialog", ["epgl-dialog"]) === EPGL
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
