/**
 * The twin that never fired, and the partner-1 documents that never left
 * (4 November 2026).
 *
 * Run against the REAL staging definition and the REAL case from the
 * LR-54109 run, read-only. The previous tests for both of these passed on
 * fixtures the runtime never produces; this one uses what the runtime has.
 *
 *  - The twin passed a CASE id to getCase, which takes a CONVERSATION id, and
 *    got null every time inside its own try. Zero document_twin_filled rows.
 *  - At the upload the product is not chosen yet, and `product_family !=
 *    'CEP30'` is true of an empty value, so it would have picked the plain
 *    trade-licence slot on a CEP30 application.
 *  - File rows took their slot from whichever journey defined the key LAST,
 *    which for moa / partner_1_passport / partner_1_emirates_id is renewal,
 *    where they carry no EPGL name — so the follow-up could never match them.
 *
 * Run from apps/web:  npx tsx scripts/test-twin-and-partner1-2026-11-04.ts --env <stg env file>
 */
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { eq } from "drizzle-orm";
import { agents, cases } from "@dialog/db";
import { databaseUrlFrom } from "./lib/envFile";
import { catalogueTwinOf, conditionDecidable, type TwinSlot } from "@/lib/documentTwins";
import { slotsForJourney } from "@/lib/journeySlots";
import { documentCompositeBody, withEpglDocumentFiles, type EpglCaseFile } from "@/lib/epglComposite";
import { readFileSync } from "node:fs";

const arg = (n: string) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : undefined; };
const ENV = arg("--env");
if (!ENV) throw new Error("--env <stg env file> is required");
const CONV = "a463115b-112c-4535-8ddb-7dbf4ced64eb";

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
    const journeys = (a.definition as any).journeys as { key: string; steps: { documents: TwinSlot[] }[] }[];
    const newLicence = journeys.find((j) => j.key === "new_license")!;
    const slots = newLicence.steps.flatMap((s) => s.documents);
    const [kase] = await db.select().from(cases).where(eq(cases.conversationId, CONV));
    const data = (kase!.state as any).data as Record<string, unknown>;

    console.log("\nthe twin is looked up by conversation, as getCase expects");
    const fill = readFileSync(new URL("../lib/documentTwinsFill.ts", import.meta.url), "utf8");
    check("fillCatalogueTwins calls getCase with the conversation id", /await getCase\(conversationId\)/.test(fill));
    const upload = readFileSync(new URL("../app/api/upload/route.ts", import.meta.url), "utf8");
    check("the upload route passes the conversation id", /fillCatalogueTwins\(agent\.definition, conversationId, agent\.id\)/.test(upload));
    check("...and the case id is not passed to getCase anywhere in it any more",
      !/getCase\(caseRow\.caseId\)/.test(upload));
    const route = readFileSync(new URL("../app/api/chat/route.ts", import.meta.url), "utf8");
    check("the chat turn fills twins too, before the model reads readiness",
      route.indexOf("fillCatalogueTwins(agent.definition, session.conversationId") > 0 &&
      route.indexOf("fillCatalogueTwins(agent.definition, session.conversationId") < route.indexOf("let liveState = session.state;"));

    console.log("\nthe twin waits for the product, then picks the right slot");
    const noProduct = { ...data, product_family: undefined, product_code: undefined, product_is_sme: undefined };
    check("with no product chosen, the plain trade-licence condition is undecidable",
      !conditionDecidable("product_family != 'CEP30'", noProduct));
    check("...so no twin is chosen at the upload (it used to be the WRONG slot)",
      catalogueTwinOf(slots, "trade_license", noProduct, () => false) === null,
      catalogueTwinOf(slots, "trade_license", noProduct, () => false));
    check("once the case is CEP30, the twin is the initial-approval slot",
      catalogueTwinOf(slots, "trade_license", data, () => false) === "trade_licence_initial_name_approval",
      catalogueTwinOf(slots, "trade_license", data, () => false));
    check("a LOCKERS case gets the plain trade-licence slot",
      catalogueTwinOf(slots, "trade_license", { ...data, product_family: "LOCKERS" }, () => false) === "trade_licence");
    check("a condition naming no fields is always decidable", conditionDecidable(undefined, {}));
    check("quoted values are not mistaken for field names", conditionDecidable("product_family == 'CEP30'", { product_family: "X" }));

    console.log("\nfile rows take their slot from the case's own journey");
    const map = slotsForJourney(journeys as any, "new_license");
    for (const k of ["moa", "partner_1_passport", "partner_1_emirates_id"]) {
      check(`${k} carries EPGL's name on a new-licence case`, Boolean((map.get(k) as any)?.salesforceType), (map.get(k) as any)?.salesforceType);
    }
    const renewalMap = slotsForJourney(journeys as any, "renewal");
    check("a renewal case still gets renewal's own definition", !(renewalMap.get("partner_1_passport") as any)?.salesforceType);
    check("a key the active journey lacks is still filled from another",
      [...slotsForJourney(journeys as any, "new_license").keys()].length >= [...new Set(journeys.flatMap((j) => j.steps.flatMap((s) => s.documents.map((d) => d.key))))].length);

    console.log("\nand the partner-1 follow-up, built the way the route now builds it");
    const files: EpglCaseFile[] = ["partner_1_passport", "partner_1_emirates_id", "moa"].map((k) => ({
      key: k, fileName: `${k}.pdf`, bytes: new Uint8Array([1]),
      salesforceType: (map.get(k) as any)?.salesforceType, validityRequired: (map.get(k) as any)?.validityRequired, validTo: "2034-01-01",
    }));
    const body = documentCompositeBody("LR-54109", files.map((f) => ({ key: f.key, salesforceType: f.salesforceType, validityRequired: f.validityRequired, validTo: f.validTo })));
    const filled = await withEpglDocumentFiles({ body: body! }, files, async () => null);
    check("all three are built", ((body as any)?.compositeRequest ?? []).length === 3);
    check("...and all three find their file — none dropped", filled.unmatched.length === 0 && filled.inlined.length === 3, filled);
  } finally {
    await pool.end();
  }
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
