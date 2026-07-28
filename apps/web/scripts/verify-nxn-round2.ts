/** Dev check: the stored nxn-dialog definition parses and the new Round-2
 *  behaviours render into the system prompt. */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";
import { AgentDefinition } from "@dialog/config";
import { buildSystemPrompt } from "@dialog/core";

const emptyState = {
  journeyKey: null as string | null,
  currentStep: null as string | null,
  data: {},
  documents: [] as { key: string; status: "pending" }[],
  payment: { status: "none", reference: null, link: null, amount: null, currency: null },
  readiness: { complete: false, missing: [] as { key: string; kind: "field" }[] },
  status: "draft" as const,
  reference: null as string | null,
};

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, "nxn-dialog")).limit(1);
  if (!row) throw new Error("nxn-dialog not found");
  const def = AgentDefinition.parse(row.definition);
  console.log("definition parses OK; documentsInChat =", def.documentsInChat);

  const checks: [string, boolean][] = [];
  // Prompt with no journey: global rules present.
  const p = buildSystemPrompt(def, emptyState as never, "en", true, true, undefined, undefined);
  checks.push(["upload contract (documentsInChat)", p.stable.includes("# Documents in chat")]);
  checks.push(["escalation only on ask/failure", p.stable.includes('"Talk to a person": offer it ONLY')]);
  checks.push(["no pre-selection rule", p.stable.includes("Never pre-select for the customer")]);
  checks.push(["email honesty rule", p.stable.includes("NEVER tell the customer an email")]);
  checks.push(["language stickiness", p.stable.includes("NEVER change the reply language")]);
  checks.push(["volatile session language", p.volatile.includes("Session language: ENGLISH")]);

  // Journey-level guidance made it into the definition.
  const g = (k: string) => def.journeys.find((j) => j.key === k)?.guidance ?? "";
  checks.push(["rent personal: upload blocks", g("personal_po_box_rental").includes("key: agent_eid_front")]);
  checks.push(["rent personal: key fee upfront", g("personal_po_box_rental").includes("AED 25 courier fee")]);
  checks.push(["rent corporate: trade license upload", g("corporate_po_box_rental").includes("key: trade_license")]);
  checks.push(["rent corporate: locate block", g("corporate_po_box_rental").includes("`locate`")]);
  checks.push(["T&C checkbox in payment stage", g("personal_po_box_rental").includes("terms_accepted: I have read and agree")]);
  const notes = def.journeys.find((j) => j.key === "personal_po_box_renewal")?.submission?.apiFlow?.notes ?? "";
  checks.push(["renewal grace-period rule", notes.includes("BASE YEAR")]);
  checks.push(["persona nearest-branch", def.persona.includes("Nearest branch requests")]);
  checks.push(["terms_accepted field on renewal", Boolean(def.journeys.find((j) => j.key === "personal_po_box_renewal")?.steps.some((s) => s.fields.some((f) => f.key === "terms_accepted")))]);

  let fail = 0;
  for (const [name, ok] of checks) {
    console.log(` ${ok ? "PASS" : "FAIL"}  ${name}`);
    if (!ok) fail++;
  }
  if (fail) throw new Error(`${fail} checks failed`);
  console.log("All Round-2 verification checks passed.");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
