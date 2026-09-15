/**
 * EPGL's 11 September enhancements — the parts that are code.
 *
 * The wording changes live in the agent definition and are checked against the
 * database at the bottom of this file. What is checked here first is the three
 * pieces of behaviour underneath them:
 *
 *   - a document requirement can depend on two facts at once, which is what a
 *     non-resident partner needs;
 *   - the widget and the server agree about which documents are required, which
 *     they did not before today;
 *   - and an OLD document is refused rather than explained away, once we hold
 *     enough of the company's names to tell "old" from "also".
 *
 * Run from apps/web:  npx tsx scripts/test-epgl-enhancements-2026-09-11.ts
 *   (add --env <file> to check the agent definition too)
 */
import { evalCondition } from "@dialog/config";
import { entityMismatch } from "../lib/docIdentity";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : `\n         ${JSON.stringify(got)}`}`); }
};

console.log("\nA requirement can depend on two facts");
{
  const EID2 = "partner_count >= 2 && partner_2_residence != 'Non Resident'";
  check("partner 2 is resident: asked for", evalCondition(EID2, { partner_count: 3, partner_2_residence: "Resident" }));
  check("partner 2 is a citizen: asked for", evalCondition(EID2, { partner_count: 3, partner_2_residence: "Citizen" }));
  check("residence unknown: still asked for", evalCondition(EID2, { partner_count: 3 }));
  check("partner 2 lives abroad: NOT asked for", !evalCondition(EID2, { partner_count: 3, partner_2_residence: "Non Resident" }));
  check("there is no partner 2: not asked for", !evalCondition(EID2, { partner_count: 1, partner_2_residence: "Resident" }));
  check("no count at all: not asked for", !evalCondition(EID2, { partner_2_residence: "Resident" }));
  // The spelling is EPGL's own picklist and goes to them unchanged.
  check("a near-miss spelling does NOT waive it", evalCondition(EID2, { partner_count: 2, partner_2_residence: "non resident" }));
}

console.log("\nA sole establishment has no MOA");
{
  const MOA = "legal_form != 'Sole Establishment'";
  check("sole establishment: no MOA asked for", !evalCondition(MOA, { legal_form: "Sole Establishment" }));
  check("LLC: MOA asked for", evalCondition(MOA, { legal_form: "Limited Liability Company (LLC)" }));
  // The one that looks the same and is not.
  check("LLC single owner: MOA still asked for", evalCondition(MOA, { legal_form: "Limited Liability Company - Single Owner(LLC - SO)" }));
  check("unknown legal form: MOA asked for", evalCondition(MOA, {}));
}

console.log("\nThe evaluator is one implementation, not three");
{
  check("numeric conditions work at all", evalCondition("partner_count >= 2", { partner_count: 2 }));
  check("an array counts as its length", evalCondition("partners >= 2", { partners: [1, 2] }));
  check("a missing count is not zero", !evalCondition("partner_count >= 1", {}));
  check("string equality still works", evalCondition("payment_method == 'viban'", { payment_method: "viban" }));
  check("bare truthy still works", evalCondition("declaration_accepted", { declaration_accepted: true }));
  check("no condition is always true", evalCondition(undefined, {}));

  const exp = readFileSync(new URL("../app/embed/[agent]/Experience.tsx", import.meta.url), "utf8");
  const mob = readFileSync(new URL("../app/m/[agent]/[cid]/page.tsx", import.meta.url), "utf8");
  const eng = readFileSync(new URL("../../../packages/core/src/case/engine.ts", import.meta.url), "utf8");
  for (const [name, src] of [["the widget", exp], ["the mobile page", mob], ["the engine", eng]] as const) {
    check(`${name} imports the evaluator`, /evalCondition/.test(src) && !/condition\.match\(\/\^/.test(src), name);
  }
  check("the widget lays each value out by its own script", /className="dlg-field-value" dir="auto"/.test(exp));
}

console.log("\nAn old MOA is refused; a trade name is not");
{
  // One name on file: we cannot tell a trade name from a wrong company, so the
  // YIFANG rule stands and the customer is asked.
  const oneName = { company_name: "YI FANG TAIWAN FRUIT TEA L.L.C" };
  const moa = { company_name: "YIFANG CAFE MIDDLE EAST L.L.C" };
  const r1 = entityMismatch(oneName, moa);
  check("one name on file -> ask, never refuse", r1?.severity === "confirm", r1);

  // Both of the company's names on file, and the document matches neither.
  const bothNames = {
    company_name: "YI FANG TAIWAN FRUIT TEA L.L.C",
    trade_name_en: "YIFANG CAFE MIDDLE EAST L.L.C",
  };
  const stale = { company_name: "ORIENTAL PEARL BEVERAGES L.L.C" };
  const r2 = entityMismatch(bothNames, stale);
  check("two names on file -> the third is refused", r2?.severity === "block", r2);
  check("...and the reason names both of ours", /YI FANG TAIWAN/.test(r2?.reason ?? "") && /YIFANG CAFE/.test(r2?.reason ?? ""), r2?.reason);
  check("...and tells them what to do about it", /upload the current version/i.test(r2?.reason ?? ""), r2?.reason);

  // Still not refused when it IS one of them.
  check("the registered name matches", entityMismatch(bothNames, { company_name: "YI FANG TAIWAN FRUIT TEA L.L.C" }) === null);
  check("the trade name matches", entityMismatch(bothNames, { company_name: "YIFANG CAFE MIDDLE EAST" }) === null);
  // And an exact identifier still settles everything, as before.
  check("a matching licence number settles it", entityMismatch(
    { ...bothNames, trade_license_number: "697670" },
    { company_name: "ANYTHING AT ALL", trade_license_number: "697670" }
  ) === null);
  // Two names that are really one name do not count as two.
  const sameTwice = { company_name: "YI FANG TAIWAN FRUIT TEA L.L.C", trade_name_en: "YI FANG TAIWAN FRUIT TEA" };
  check("one name written twice is still one name", entityMismatch(sameTwice, moa)?.severity === "confirm", entityMismatch(sameTwice, moa));
}

/* ── the definition, when an --env is given ───────────────────────────── */

const envAt = process.argv.indexOf("--env");
if (envAt !== -1) {
  const { databaseUrlFrom } = await import("./lib/envFile");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const pg = (await import("pg")).default;
  const { agents } = await import("@dialog/db");
  const { eq } = await import("drizzle-orm");
  const pool = new pg.Pool({ connectionString: databaseUrlFrom(process.argv[envAt + 1]!) });
  const db = drizzle(pool, { schema: { agents } });
  const [row] = await db.select().from(agents).where(eq(agents.slug, "epgl-dialog"));
  const def = row!.definition as any;
  const J = (k: string) => def.journeys.find((x: any) => x.key === k);
  const fieldKeys = (j: any) => new Set(j.steps.flatMap((s: any) => s.fields).map((f: any) => f.key));
  const docs = (j: any) => j.steps.flatMap((s: any) => s.documents ?? []);

  console.log("\nThe agent definition");
  check("1 — one business day, new licence", /typically within ONE business day/.test(J("new_license").guidance));
  check("1 — one business day, renewal", /typically within ONE business day/.test(J("renewal").guidance));
  check("1 — no 2-business-day claim survives", !/2 business days|يومي عمل/.test(J("new_license").guidance + J("renewal").guidance));

  check("3 — activities come off the licence", /TAKE THEM FROM THE TRADE LICENCE WHENEVER IT STATES THEM/.test(J("new_license").guidance));
  check("3 — the contradicting 8 Sep rule is gone", !/activity_codes is the customer's answer/.test(J("new_license").guidance));

  for (const k of ["new_license", "renewal"]) {
    check(`4 — the timeline sits with the payment choice (${k})`, /CARD PAYMENT: the licence is issued the SAME DAY/.test(J(k).guidance));
    check(`4 — and the Virtual IBAN day (${k})`, /VIRTUAL IBAN: the licence is issued by the NEXT BUSINESS DAY/.test(J(k).guidance));
  }

  check("5 — partner Arabic names exist", fieldKeys(J("new_license")).has("partner_1_name_ar") && fieldKeys(J("renewal")).has("partner_8_name_ar"));
  check("5 — the address and owner have Arabic too", fieldKeys(J("new_license")).has("address_street_ar") && fieldKeys(J("new_license")).has("owner_name_ar"));
  check("5 — and EPGL are sent the Arabic partner name", /EPG_Partner_Name_Arabic__c/.test(J("new_license").submission.apiFlow.notes));

  check("6 — the greeting names the service", /Apply for Postal Activity License/.test(def.greeting.en) && /Renew Postal Activity License/.test(def.greeting.en));
  check("6 — in Arabic too", /رخصة نشاط بريدي/.test(def.greeting.ar));
  check("6 — nothing is called a courier licence", !JSON.stringify(def.intents).includes("courier"));

  check("7 — the residence field exists", fieldKeys(J("new_license")).has("partner_1_residence"));
  check("7 — with EPGL's own three values", JSON.stringify(J("new_license").steps.flatMap((s: any) => s.fields).find((f: any) => f.key === "partner_1_residence").options).includes("Non Resident"));
  for (const k of ["new_license", "renewal"]) {
    const eids = docs(J(k)).filter((d: any) => /_emirates_id$/.test(d.key));
    check(`7 — all 8 Emirates IDs are gated on residence (${k})`, eids.length === 8 && eids.every((d: any) => /&& partner_\d_residence != 'Non Resident'$/.test(d.condition)), eids.map((d: any) => d.condition));
  }
  check("7 — and EPGL are sent the residence type", /EPG_Residence_Type__c/.test(J("renewal").submission.apiFlow.notes));

  check("8 — the legal form is captured", fieldKeys(J("new_license")).has("legal_form"));
  const moa = docs(J("new_license")).find((d: any) => d.key === "moa");
  check("8 — the MOA is skipped for a sole establishment", moa?.condition === "legal_form != 'Sole Establishment'", moa?.condition);
  // It WAS mandatory when this was written. EPGL's consolidated feedback later
  // the same day asked for the MOA to be optional everywhere, so the condition
  // below is now the only thing that varies by company type: for a sole
  // establishment the slot does not appear at all, which is different from
  // "you may skip it".
  check("8 — the MOA is optional, per the consolidated feedback", moa?.requirement === "optional", moa?.requirement);

  // The conditions must actually hold up against the shared evaluator.
  const soleTrader = { partner_count: 1, partner_1_residence: "Non Resident", legal_form: "Sole Establishment" };
  const required = docs(J("new_license")).filter((d: any) => d.requirement === "mandatory" && evalCondition(d.condition, soleTrader)).map((d: any) => d.key);
  check("a non-resident sole trader is asked for a licence and a passport, not an MOA or an EID",
    required.includes("trade_license") && required.includes("partner_1_passport") && !required.includes("moa") && !required.includes("partner_1_emirates_id"), required);

  // The knowledge base answers QUESTIONS, and a question starts no journey, so
  // the guidance above never reaches it. Three of EPGL's eight items were still
  // answered wrongly from here after the guidance was correct.
  const { kbChunks, kbDocuments } = await import("@dialog/db");
  const chunks = await db.select().from(kbChunks).where(eq(kbChunks.agentId, row!.id));
  const kbDocs = await db.select().from(kbDocuments).where(eq(kbDocuments.agentId, row!.id));
  const all = chunks.map((c: any) => c.content).join("\n");
  console.log("\nThe knowledge base");
  check("1 — no 2-business-day answer survives", !/2 business days|يومي عمل/.test(all));
  check("1 — and it says one", /typically within one business day/.test(all) && /خلال يوم عمل واحد/.test(all));
  check("4 — the payment methods have their own answer", /Paying by CARD[\s\S]{0,120}SAME DAY/.test(all) && /Virtual IBAN means the licence is issued by the NEXT BUSINESS DAY/.test(all));
  check("4 — in Arabic too", /يوم العمل التالي/.test(all));
  check("7 — a non-resident partner is not asked for an Emirates ID", /non-resident partner has no Emirates ID|has no Emirates ID/i.test(all));
  check("7 — in Arabic too", /لا يملك هوية إماراتية/.test(all));
  check("8 — a sole establishment has no MOA", /a sole establishment does not/i.test(all));
  check("8 — in Arabic too", /المؤسسة الفردية فلا يصدر لها عقد تأسيس/.test(all));
  check("6 — no document is titled a courier licence", !kbDocs.some((d: any) => /courier|بريد سريع/i.test(d.title)), kbDocs.map((d: any) => d.title));

  await pool.end();
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
