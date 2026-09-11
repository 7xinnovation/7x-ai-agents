/**
 * The consolidated 11 September testing feedback.
 *
 * Three things here are code and the rest is content, so this checks the code
 * properly and then asserts the content is actually in the database — the same
 * split as the enhancements suite beside it, and for the same reason: on
 * 11 September the guidance was right and the knowledge base was still wrong,
 * and nothing failed until somebody asked a question.
 *
 * Run from apps/web:  npx tsx scripts/test-epgl-consolidated-2026-09-11.ts
 *   (add --env <file> to check the agent definition and knowledge base too)
 */
import { maskIdentity, maskForDisplay, isIdentityKey } from "../lib/maskIdentity";
import { evalCondition } from "@dialog/config";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : `\n         ${JSON.stringify(got)}`}`); }
};

console.log("\nIdentity numbers are shown without being displayed in full");
{
  const eid = "784-1990-4193131-4";
  const masked = maskIdentity(eid);
  check("an Emirates ID keeps its last four", masked.endsWith("131-4"), masked);
  check("...and gives up the rest", !masked.includes("784") && !masked.includes("1990"), masked);
  check("...and keeps its shape", masked.split("-").length === 4, masked);
  check("a passport keeps its last four", maskIdentity("Z8G229333") === "•••••9333", maskIdentity("Z8G229333"));
  // The point of the panel is that the applicant can check what was read.
  check("enough is left to tell your own card from a misread digit", maskIdentity("784-1990-4193131-4") !== maskIdentity("784-1990-4193131-9"));
  check("something too short to be an identity number is untouched", maskIdentity("4-4") === "4-4");
  check("an empty value is untouched", maskIdentity("") === "");

  check("the owner's Emirates ID is masked", maskForDisplay("owner_emirates_id", "784-1990-4193131-4").startsWith("•"));
  check("a partner's passport is masked", maskForDisplay("partner_3_passport_no", "Z8G229333").startsWith("•"));
  check("the trade licence number is NOT", maskForDisplay("trade_license_number", "697670") === "697670");
  check("the company name is NOT", maskForDisplay("company_name", "YI FANG TAIWAN FRUIT TEA L.L.C").includes("YI FANG"));
  check("a phone number is NOT — it is not an identity document", maskForDisplay("contact_phone", "0553708434") === "0553708434");
  check("key matching is by name, not by value shape", isIdentityKey("partner_1_emirates_id") && !isIdentityKey("license_expiry_date"));

  const exp = readFileSync(new URL("../app/embed/[agent]/Experience.tsx", import.meta.url), "utf8");
  check("the panel masks what it renders", /maskForDisplay\(k, displayValue\(v\)\)/.test(exp));
  check("...and the pencil still edits the real value", /setEditVal\(displayValue\(v\)\)/.test(exp));
}

console.log("\nA field can be required only in some applications");
{
  const C = "initial_approval_number == ''";
  check("no initial approval: the trade licence number is required", evalCondition(C, {}));
  check("...still required when the field is empty", evalCondition(C, { initial_approval_number: "" }));
  check("an initial approval on file: not required", !evalCondition(C, { initial_approval_number: "1777380" }));

  const eng = readFileSync(new URL("../../../packages/core/src/case/engine.ts", import.meta.url), "utf8");
  check("readiness honours a field's condition", /if \(!evalCondition\(field\.condition, state\.data\)\) continue;/.test(eng));
  const exp = readFileSync(new URL("../app/embed/[agent]/Experience.tsx", import.meta.url), "utf8");
  check("and so does the widget's count", /f\.required && docApplies\(f\.condition\)/.test(exp));
  for (const p of ["app/embed/[agent]/page.tsx", "app/api/agents/[agent]/route.ts"]) {
    const src = readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
    check(`${p} passes the condition through`, /condition: f\.condition/.test(src));
  }
}

console.log("\nAn auth-free journey cannot have sign-in demanded of it");
{
  const tools = readFileSync(new URL("../../../packages/core/src/ai/tools.ts", import.meta.url), "utf8");
  const block = tools.slice(tools.indexOf('case "request_authentication"'), tools.indexOf('case "request_escalation"'));
  check("the guard exists", /active\.requiresAuth === false/.test(block));
  check("...and only fires while a journey is ACTIVE", /const active = findJourney\(agent, state\.journeyKey\)/.test(block) && /active &&/.test(block));
  check("...and refuses rather than prompting", /isError: true/.test(block) && block.indexOf("active.requiresAuth === false") < block.lastIndexOf('events.push({ type: "auth_required"'));
  check("the already-signed-in guard is still there", /if \(ctx\.authenticated\)/.test(block));
}

const envAt = process.argv.indexOf("--env");
if (envAt !== -1) {
  const { databaseUrlFrom } = await import("./lib/envFile");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const pg = (await import("pg")).default;
  const { agents, kbChunks } = await import("@dialog/db");
  const { eq } = await import("drizzle-orm");
  const pool = new pg.Pool({ connectionString: databaseUrlFrom(process.argv[envAt + 1]!) });
  const db = drizzle(pool, { schema: { agents, kbChunks } });
  const [row] = await db.select().from(agents).where(eq(agents.slug, "epgl-dialog"));
  const def = row!.definition as any;
  const J = (k: string) => def.journeys.find((x: any) => x.key === k);
  const fields = (j: any) => j.steps.flatMap((s: any) => s.fields);
  const docs = (j: any) => j.steps.flatMap((s: any) => s.documents ?? []);
  const kb = (await db.select().from(kbChunks).where(eq(kbChunks.agentId, row!.id))).map((c: any) => c.content).join("\n");
  const guidance = J("new_license").guidance + J("renewal").guidance;

  console.log("\nThe fee");
  check("nothing quotes AED 100,000 any more", !/100,000/.test(kb + guidance), (kb + guidance).match(/.{60}100,000.{40}/)?.[0]);
  check("the knowledge base says 150,000", /AED 150,000/.test(kb) && /150,000 درهم/.test(kb));
  check("and so do both journeys", (J("new_license").guidance.match(/AED 150,000/) ?? []).length === 1 && /AED 150,000/.test(J("renewal").guidance));

  console.log("\nThe SLA");
  check("one business day is eight working hours", /one business day \(8 working hours\)/.test(kb) && /8 working hours/.test(guidance));
  check("in Arabic too", /8 ساعات عمل/.test(kb) && /8 ساعات عمل/.test(guidance));

  console.log("\nThe rest of the list");
  check("the persona no longer sells courier licences", !/courier licen/i.test(def.persona));
  check("a question does not start an application", /ASK-A-QUESTION DOES NOT START AN APPLICATION/.test(def.persona));
  check("the card is offered first, as the same-day route", /OFFER THE CARD FIRST/.test(J("new_license").guidance) && /OFFER THE CARD FIRST/.test(J("renewal").guidance));
  check("...and the IBAN's destination is named", /added to their workspace/.test(J("new_license").guidance));
  check("identity numbers are not repeated in chat", /IDENTITY NUMBERS ARE NOT REPEATED IN FULL/.test(J("new_license").guidance));
  check("a non-resident is asked for no Emirates ID NUMBER either", /AND NOT THE NUMBER EITHER/.test(J("new_license").guidance));
  check("signing in is named as optional, not asked for", /SIGNING IN IS OPTIONAL HERE/.test(J("new_license").guidance) && /SIGNING IN IS OPTIONAL HERE/.test(J("renewal").guidance));
  check("...and the journeys really are auth-free", J("new_license").requiresAuth === false && J("renewal").requiresAuth === false);

  const moa = docs(J("new_license")).find((d: any) => d.key === "moa");
  check("the MOA is optional", moa?.requirement === "optional", moa?.requirement);
  check("...and still hidden entirely for a sole establishment", moa?.condition === "legal_form != 'Sole Establishment'");

  for (const k of ["new_license", "renewal"]) {
    const lease = docs(J(k)).find((d: any) => d.key === "lease_contract");
    check(`the lease contract has a slot (${k})`, Boolean(lease), lease?.requirement);
    check(`...and cannot block an application (${k})`, lease?.requirement === "optional");
  }

  const tln = fields(J("new_license")).find((f: any) => f.key === "trade_license_number");
  check("the trade licence number is conditional", tln?.condition === "initial_approval_number == ''", tln?.condition);
  check("...and still required when there is no approval number", tln?.validation?.required === true);

  const fin = new Set(fields(J("renewal")).map((f: any) => f.key));
  check("the renewal has three separate acknowledgments", fin.has("terms_accepted") && fin.has("commitment_form_accepted") && fin.has("idep_integration_accepted"));
  check("...each timestamped", fin.has("commitment_form_accepted_at") && fin.has("idep_integration_accepted_at"));
  check("...each its own checkbox in the guidance", /commitment_form_accepted: </.test(J("renewal").guidance) && /idep_integration_accepted: </.test(J("renewal").guidance));
  check("...and mapped to its own Salesforce field", /ACKNOWLEDGMENTS \(2026-09-11\)/.test(J("renewal").submission.apiFlow.notes));
  check("the old combined line is gone", !/I accept the terms and conditions and the mandatory IDEP integration/.test(J("renewal").guidance));

  // An applicant with an initial approval and no licence must be able to finish.
  const withApproval = { initial_approval_number: "1777380", legal_form: "Sole Establishment", partner_count: 1, partner_1_residence: "Non Resident" };
  const stillRequired = fields(J("new_license")).filter((f: any) => f.validation?.required && evalCondition(f.condition, withApproval)).map((f: any) => f.key);
  check("an initial-approval applicant is not asked for a trade licence number", !stillRequired.includes("trade_license_number"), stillRequired.length);
  const reqDocs = docs(J("new_license")).filter((d: any) => d.requirement === "mandatory" && evalCondition(d.condition, withApproval)).map((d: any) => d.key);
  check("...and the only mandatory documents left are the licence and the passport", reqDocs.sort().join(",") === "partner_1_passport,trade_license", reqDocs);

  await pool.end();
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
