/** Dev check: the stored epgl-dialog definition parses and the Round-1-internal
 *  feedback behaviours are present (definition + prompt + KB). */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import { getDb, agents, kbDocuments } from "@dialog/db";
import { eq } from "drizzle-orm";
import { AgentDefinition } from "@dialog/config";
import { buildSystemPrompt } from "@dialog/core";

const emptyState = {
  journeyKey: null as string | null,
  currentStep: null as string | null,
  data: {},
  documents: [] as never[],
  payment: { status: "none", reference: null, link: null, amount: null, currency: null },
  readiness: { complete: false, missing: [] as never[] },
  status: "draft" as const,
  reference: null as string | null,
};

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, "epgl-dialog")).limit(1);
  if (!row) throw new Error("epgl-dialog not found");
  const def = AgentDefinition.parse(row.definition);
  console.log("definition parses OK; documentsInChat =", def.documentsInChat);

  const g = (k: string) => def.journeys.find((j) => j.key === k)?.guidance ?? "";
  const issuance = def.journeys.find((j) => j.key === "new_license")!;
  const p = buildSystemPrompt(def, emptyState as never, "en", false, true, undefined, undefined);
  const kb = await db.select({ title: kbDocuments.title }).from(kbDocuments).where(eq(kbDocuments.agentId, row.id));

  const checks: [string, boolean][] = [
    ["FB-1434 greeting buttons (en)", /```buttons/.test(def.greeting.en ?? "")],
    ["FB-1434 greeting buttons (ar)", /```buttons/.test(def.greeting.ar ?? "")],
    ["FB-1436 TL/Initial Approval label", issuance.steps.some((s) => s.documents.some((d) => d.label.en === "Trade License / Initial Approval"))],
    ["FB-1441 initial_approval_number field", issuance.steps.some((s) => s.fields.some((f) => f.key === "initial_approval_number"))],
    ["FB-1448 renewal expiry label fixed", def.journeys.find((j) => j.key === "renewal")!.steps.some((s) => s.fields.some((f) => f.label.en === "Trade license expiry date"))],
    ["FB-1421 upfront preparation list", g("new_license").includes("full list of what they should have ready")],
    ["FB-1328 name+email at start", g("new_license").includes("capture the customer's NAME and EMAIL")],
    ["FB-1328 UAE PASS email override", g("new_license").includes("UAE PASS provides a verified email")],
    ["FB-1422 corporate owner rule", g("new_license").includes("CORPORATE OWNERS")],
    ["FB-1443+ type validation rules", g("new_license").includes("DOCUMENT TYPE VALIDATION")],
    ["FB-1450 declaration link", g("new_license").includes("(/declaration/epgl)") && g("renewal").includes("(/declaration/epgl)")],
    ["FB-1423 next-steps completion", g("new_license").includes("What happens next")],
    ["FB-1444 application-reference rule", g("new_license").includes("NEVER present a payment reference")],
    // FB-1439 was re-opened on 2026-07-31: the format is now DD-MM-YYYY.
    ["FB-1439 global date-format rule", p.stable.includes('"14-02-2027"')],
    ["FB-1424 FAQ KB (en+ar)", kb.filter((d) => /FAQ|الأسئلة الشائعة/.test(d.title)).length >= 2],
  ];

  let fail = 0;
  for (const [name, ok] of checks) {
    console.log(` ${ok ? "PASS" : "FAIL"}  ${name}`);
    if (!ok) fail++;
  }
  if (fail) throw new Error(`${fail} checks failed`);
  console.log("All EPGL Round-1-internal verification checks passed.");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
