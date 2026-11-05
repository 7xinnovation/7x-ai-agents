/**
 * The trade licence asked for twice, and an internal deadline shown to the
 * applicant (5 November 2026, LR-54419).
 *
 * Read-only against staging: the real definition, the real case, and the real
 * getApplicationStatus response the status card was built from.
 *
 * Run from apps/web:
 *   npx tsx scripts/test-licence-once-and-sla-2026-11-05.ts --env <stg env file>
 */
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { and, desc, eq, ilike } from "drizzle-orm";
import { agents, cases, apiCalls } from "@dialog/db";
import { recomputeReadiness, documentsAwaitingExpiry, requirementText } from "@dialog/core";
import { databaseUrlFrom } from "./lib/envFile";
import { withoutInternalStatusFields } from "@/lib/epglStatusFields";
// From the library, NEVER from the script: importing the script runs it.
import { LICENCE_SATISFIED_BY as SATISFIED_BY } from "@/lib/epglLicenceSlots";

const arg = (n: string) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : undefined; };
const ENV = arg("--env");
if (!ENV) throw new Error("--env <stg env file> is required");
const CONV = "ccf0cf08-dffb-451b-98dd-0b85e7a34db8";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : `\n       ${JSON.stringify(got)}`}`); }
};

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrlFrom(ENV!) });
  const db = drizzle(pool, { schema: { agents, cases, apiCalls } });
  try {
    const [a] = await db.select().from(agents).where(eq(agents.slug, "epgl-dialog-2"));
    const [k] = await db.select().from(cases).where(eq(cases.conversationId, CONV));
    if (!a || !k) throw new Error("agent or case not found");
    // The definition as it will be once the config script has run — applied in
    // memory here, so the test does not depend on the order things are deployed.
    const def = JSON.parse(JSON.stringify(a.definition)) as any;
    for (const j of def.journeys) for (const st of j.steps) for (const d of st.documents)
      if (SATISFIED_BY[d.key]) d.satisfiedBy = SATISFIED_BY[d.key];
    const state = k.state as any;

    console.log("\n1 · the moment of the double ask: product just chosen, only the licence in");
    const atAsk = { ...state, documents: state.documents.filter((d: any) => d.key === "trade_license") };
    const r = recomputeReadiness(def, atAsk);
    const missing = r.readiness.missing.map((m: any) => m.key);
    check("the licence on the case has its date", Boolean(atAsk.documents[0]?.validTo), atAsk.documents[0]);
    check("the CEP30 'Initial Name Approval' slot is NOT missing", !missing.includes("trade_licence_initial_name_approval"), missing);
    check("...nor waiting on a date", !documentsAwaitingExpiry(def, atAsk).includes("trade_licence_initial_name_approval"));
    check("the plain trade-licence slot is not missing either", !missing.includes("trade_licence"));
    check("the documents that ARE still needed are still asked for", missing.includes("moa") || missing.includes("sme_licence_federal_or_local_government"), missing);

    // Explicitly WITHOUT the declaration, whatever the stored definition holds.
    const without = JSON.parse(JSON.stringify(a.definition));
    for (const j of without.journeys) for (const st of j.steps) for (const d of st.documents) delete d.satisfiedBy;
    const before = recomputeReadiness(without, atAsk).readiness.missing.map((m: any) => m.key);
    check("(without the config, it IS missing — which is what was asked for twice)", before.includes("trade_licence_initial_name_approval"), before);

    console.log("\n2 · and the model is told it is the same document");
    const slot = def.journeys.find((j: any) => j.key === "new_license").steps.flatMap((s: any) => s.documents)
      .find((d: any) => d.key === "trade_licence_initial_name_approval");
    const text = requirementText(slot);
    check("the prompt says it is the same document as trade_license", /SAME document as trade_license/.test(text), text);
    check("...and never to ask for it separately", /never ask for it separately/.test(text), text);
    check("a slot without satisfiedBy prints as before", requirementText({ requirement: "mandatory" }) === "mandatory");

    console.log("\n3 · the operational SLA never reaches the model");
    const [call] = await db.select().from(apiCalls)
      .where(and(eq(apiCalls.conversationId, CONV), ilike(apiCalls.tool, "%getApplicationStatus")))
      .orderBy(desc(apiCalls.createdAt)).limit(1);
    const raw = String(call?.responseBody ?? "");
    check("the real response carries it", /"operationalSlaDue"/.test(raw), raw.slice(0, 120));
    const asTool = `HTTP 200 OK\n${raw}\n\nSome guidance the route appends.`;
    const out = withoutInternalStatusFields(asTool);
    check("it is removed", !/operationalSlaDue/.test(out.result) && out.removed >= 1, out.removed);
    check("the statutory deadline is left", /statutorySlaDue/.test(out.result));
    check("everything else survives — status, step, payment", /requestStatus|applicantStatus/.test(out.result) && /fees|payment/i.test(out.result));
    check("the guidance after the JSON is kept", out.result.endsWith("Some guidance the route appends."));
    check("a response without it is untouched", withoutInternalStatusFields('{"a":1}').result === '{"a":1}');
  } finally {
    await pool.end();
  }
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
