/**
 * The licence asked for twice, a date asked for that was already read, and
 * creates that EPGL's Apex could not finish (4 November 2026, CN-1234568).
 *
 * Real-data parts run read-only against the staging definition and the case
 * from that run (conversation 46b71bcd).
 *
 * Run from apps/web:
 *   npx tsx scripts/test-epgl-20-licence-and-limits-2026-11-04.ts --env <stg env file>
 */
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { agents, cases } from "@dialog/db";
import { recomputeReadiness, conditionDecidable } from "@dialog/core";
import { databaseUrlFrom } from "./lib/envFile";
import { twinValidTo } from "@/lib/documentTwinsFill";
import {
  withEpglDocumentItems, capDocumentItems, inBatches, MAX_DOCUMENTS_PER_CALL, type EpglCaseFile,
} from "@/lib/epglComposite";

const arg = (n: string) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : undefined; };
const ENV = arg("--env");
if (!ENV) throw new Error("--env <stg env file> is required");
const CONV = "46b71bcd-ea2a-4d19-b929-37f9fd07dd08";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : `\n       ${JSON.stringify(got)}`}`); }
};

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrlFrom(ENV!) });
  const db = drizzle(pool, { schema: { agents, cases } });
  try {
    const [a] = await db.select().from(agents).where(eq(agents.slug, "epgl-dialog-2"));
    if (!a) throw new Error("epgl-dialog-2 not found");
    const [k] = await db.select().from(cases).where(eq(cases.conversationId, CONV));
    if (!k) throw new Error("case not found");
    const def = a.definition as any;
    const state = k.state as any;
    const slots = def.journeys.find((j: any) => j.key === "new_license").steps.flatMap((s: any) => s.documents);

    console.log("\n1 · readiness does not ask for a slot before it can tell whether it applies");
    const noDocs = { ...state, documents: [] as unknown[] };
    const before = recomputeReadiness(def, { ...noDocs, data: { ...state.data, product_family: undefined, product_code: undefined, product_is_sme: undefined } });
    const beforeKeys = before.readiness.missing.map((m: any) => m.key);
    check("no product yet: the plain 'Trade Licence' slot is NOT asked for", !beforeKeys.includes("trade_licence"), beforeKeys);
    check("...nor the CEP30 one", !beforeKeys.includes("trade_licence_initial_name_approval"));
    check("...but our own trade licence slot still is", beforeKeys.includes("trade_license"), beforeKeys);
    const cep30 = recomputeReadiness(def, noDocs).readiness.missing.map((m: any) => m.key);
    check("once CEP30: the CEP30 slot is required", cep30.includes("trade_licence_initial_name_approval"), cep30);
    check("...and the plain one never is", !cep30.includes("trade_licence"), cep30);
    check("mandatory documents are untouched by the rule", cep30.includes("beneficial_ownership_declaration"));
    check("an empty product makes 'product_family != CEP30' undecidable", !conditionDecidable("product_family != 'CEP30'", {}));

    console.log("\n2 · the twin carries the expiry the licence was read with");
    check("the run's case read the licence expiry", state.data.license_expiry_date === "2027-12-31", state.data.license_expiry_date);
    check("our trade_license slot has no date of its own", !state.documents.find((d: any) => d.key === "trade_license")?.validTo);
    check("so the CEP30 twin takes the licence's expiry",
      twinValidTo(undefined, "trade_licence_initial_name_approval", slots, state.data) === "2027-12-31");
    check("a date on the source document wins over it",
      twinValidTo("2030-01-01", "trade_licence_initial_name_approval", slots, state.data) === "2030-01-01");
    check("a non-licence twin never borrows the licence's date",
      twinValidTo(undefined, "beneficial_ownership_declaration", slots, state.data) === undefined);
    check("a malformed date is not passed on", twinValidTo("31/12/2027", "beneficial_ownership_declaration", slots, {}) === undefined);
  } finally {
    await pool.end();
  }

  console.log("\n3 · never more documents in one call than their Apex can attach");
  const file = (k: string): EpglCaseFile => ({ key: k, fileName: `${k}.pdf`, bytes: new Uint8Array([1]), salesforceType: `Type ${k}` });
  const TEN = Array.from({ length: 10 }, (_, i) => file(`slot_${i}`));
  const create = (modelDocs: number) => ({
    body: {
      allOrNone: true,
      compositeRequest: [
        { method: "POST", url: "/services/data/v60.0/sobjects/EPG_License_Request__c", referenceId: "NewLicenseRequest", body: {} },
        ...Array.from({ length: modelDocs }, (_, i) => ({
          method: "POST", url: "/services/data/v60.0/sobjects/EPG_Document__c", referenceId: `M${i}`, body: { Document_Type: `Model ${i}` },
        })),
      ],
    },
  });
  const docCount = (inp: any) => (inp.body.compositeRequest as any[]).filter((i) => /EPG_Document__c$/.test(i.url)).length;
  check("the cap is four", MAX_DOCUMENTS_PER_CALL === 4);
  const ten = withEpglDocumentItems(create(0), TEN);
  check("ten sendable files: the create carries four", docCount(ten.input) === 4, docCount(ten.input));
  check("...and records exactly those four as added, so the rest go later", ten.added.length === 4, ten.added);
  const withModel = withEpglDocumentItems(create(2), TEN);
  check("the model's own items count against it", docCount(withModel.input) === 4 && withModel.added.length === 2);
  const full = withEpglDocumentItems(create(4), TEN);
  check("no room left: nothing added", full.added.length === 0);
  const overfull = capDocumentItems(create(7));
  check("seven written by the model are trimmed to four", docCount(overfull.input) === 4 && overfull.dropped === 3);
  check("...keeping the application itself", (overfull.input as any).body.compositeRequest.some((i: any) => /License_Request/.test(i.url)));
  check("a call within the limit is left exactly as it was", capDocumentItems(create(3)).dropped === 0);
  check("the follow-up batches ten as four, four, two", inBatches(TEN).map((b) => b.length).join() === "4,4,2");

  const route = readFileSync(new URL("../app/api/chat/route.ts", import.meta.url), "utf8");
  check("the follow-up sends one call per batch", /for \(const batch of inBatches\(toSend\)\) \{/.test(route));
  check("...and a failed batch does not stop the next", /if \(res\.isError\) continue;/.test(route));
  const intg = readFileSync(new URL("../lib/integrations.ts", import.meta.url), "utf8");
  check("every composite is capped after the injection", intg.indexOf("capDocumentItems(input)") > intg.indexOf("withEpglDocumentItems(input, files)"));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
