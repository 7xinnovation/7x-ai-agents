/**
 * Salesforce's answers to the payload review, as behaviour.
 *
 * Run from apps/web:  npx tsx scripts/test-epgl-salesforce-answers-2026-09-13.ts
 *   (add --env <file> to check the agent definition too)
 */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : `\n         ${JSON.stringify(got)}`}`); }
};
const src = readFileSync(new URL("../lib/integrations.ts", import.meta.url), "utf8");

console.log("\nThe request number comes from the endpoint they support");
{
  const fn = src.slice(src.indexOf("async function epglRequestNumber("), src.indexOf("async function epglRequestNumberViaSoql("));
  check("their status endpoint is asked first", /epglStatusIdentifier\(spec, id\)/.test(fn));
  check("...and SOQL is the fallback, not the path", /return epglRequestNumberViaSoql\(spec, id\)/.test(fn));
  const st = src.slice(src.indexOf("async function epglStatusIdentifier("), src.indexOf("async function epglRequestNumberViaSoql("));
  check("it reads requestIdentifier", /requestIdentifier/.test(st));
  check("the id is still validated before it is used in a URL", /\^\[a-zA-Z0-9\]\{15,18\}\$/.test(st));
  check("a literal \"null\" is not a reference", /toLowerCase\(\) !== "null"/.test(st));
  check("it cannot hang the turn", /setTimeout\(\(\) => ctl\.abort\(\), 6000\)/.test(st));
}

console.log("\nA field that does not exist is not sent");
{
  check("EPG_Payment_Reference__c is no longer filled", !/EPG_Payment_Reference__c: facts\.paymentReference/.test(src));
  check("...and the reason is recorded where it was", /EPG_Payment_Reference__c is NOT sent/.test(src));
}

console.log("\nThe Virtual IBAN status is EPGL's to set");
{
  check("we default to saying nothing", /process\.env\.EPGL_VIBAN_STATUS \?\? ""/.test(src));
  check("...but they can still turn it on with a setting", /EPGL_VIBAN_STATUS/.test(src) && /vibanStatus \? vibanStatus : undefined/.test(src));
  check("their progression is written down beside it", /Under document review -> Documents approved -> Virtual Iban Approved/.test(src));
}

console.log("\nEvery status on their path has a plain meaning");
{
  const tableStart = src.indexOf("const EPGL_STATUS_MEANING");
  const table = src.slice(tableStart, src.indexOf("\n};", tableStart) + 3);
  for (const k of ["under document review", "documents approved", "virtual iban approved", "payment verified", "license generated", "rejected"]) {
    check(`"${k}" is explained`, new RegExp(`(^|\\s)"?${k}"?:`, "m").test(table), k);
  }
  check("\"Documents approved\" is named as the payable moment", /THE DOCUMENTS ARE APPROVED AND THE FEE IS NOW DUE/.test(table));
  check("...and is explicitly NOT the licence being issued", /must not be described as the licence being issued/.test(table));
  check("a rejection is not speculated about", /Do not speculate about why/.test(table));
  // Thirty-nine picklist values; we only claim to know the ones they gave us.
  check("an unknown status is relayed, not interpreted", /this is not one of the statuses whose meaning they have given us/.test(src));
  check("the meaning is attached to the status tool's result", /getrequeststatus\$\/i\.test\(toolName\)\) \{[\s\S]{0,400}EPGL_STATUS_MEANING/.test(src));
  check("...and the LR number with it", /The customer's reference for this application is \$\{ref\}/.test(src));
}

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

  console.log("\nThe agent definition");
  for (const k of ["new_license", "renewal"]) {
    const g = J(k).guidance;
    check(`the status path is written down (${k})`, /Under document review → Documents approved/.test(g));
    check(`"Documents approved" is not the end (${k})`, /is NOT the licence being issued/.test(g));
    check(`the reference comes from requestIdentifier (${k})`, /requestIdentifier, which is the customer's LR- number/.test(g));
    check(`the Virtual IBAN progression is theirs (${k})`, /WE DO NOT STATE THE STATUS OURSELVES/.test(g));
    check(`their confirmations are on the submission notes (${k})`, /CONFIRMED BY EPGL 2026-09-13/.test(J(k).submission.apiFlow.notes));
  }
  // The renewal still sets the accountant designation: their handler CAN write
  // it, which the record proves and the describe did not.
  check("the renewal still sends the accountant designation", /EPG_Designation__c contains 'Accountant'/.test(J("renewal").submission.apiFlow.notes));
  await pool.end();
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
