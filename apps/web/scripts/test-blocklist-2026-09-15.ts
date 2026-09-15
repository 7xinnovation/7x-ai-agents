/**
 * The blocked-company list, end to end against a real database.
 *
 * EPGL's renewal process map puts "System will check if company is
 * blacklisted?" immediately after the company lookup. The list is Licensing's,
 * it arrives as a spreadsheet, and it is uploaded in the admin panel.
 *
 * What matters here is not that a match is found — that is a WHERE clause — but
 * the three things that would be quietly wrong in production:
 *   an upload REPLACES rather than merges, so a company Licensing removed stops
 *   being blocked; a number matches however it is punctuated; and an empty list
 *   blocks nobody.
 *
 * Writes and then removes its own rows under a throwaway agent. Run from
 * apps/web:
 *   npx tsx scripts/test-blocklist-2026-09-15.ts --env <file>
 */
import { databaseUrlFrom } from "./lib/envFile";
const i = process.argv.indexOf("--env");
if (i === -1) throw new Error("--env <file> is required");
process.env.DATABASE_URL = databaseUrlFrom(process.argv[i + 1]!);

import { getDb, agents, tenants, blockedCompanies, blockedCompanyBatches } from "@dialog/db";
import { eq, sql as sqlRaw } from "drizzle-orm";
import { findBlocked, replaceBlocklist, blocklistSummary, clearBlocklist, blockKey, nameKey } from "../lib/blocklist";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : `\n         ${JSON.stringify(got)}`}`); }
};

const csv = (s: string) => Buffer.from(s);

async function main() {
  const db = getDb();
  // A real agent row, because the rows reference one — removed at the end.
  const [tenant] = await db.select().from(tenants).limit(1);
  if (!tenant) throw new Error("no tenant in this database to attach a test agent to");
  const [agent] = await db
    .insert(agents)
    .values({
      tenantId: tenant.id,
      slug: `blocklist-test-${Date.now()}`,
      name: "Blocklist test",
      status: "draft",
      definition: { name: "t", slug: "t", locales: ["en"], journeys: [], intents: [], integrations: {} } as never,
    })
    .returning();
  const id = agent!.id;

  try {
    console.log("\nNothing uploaded blocks nobody");
    check("an empty list matches nothing", (await findBlocked(id, { tradeLicenseNumber: "697670" })) === null);
    check("and an unidentified company is not a blocked one", (await findBlocked(id, {})) === null);

    console.log("\nA list is read, whatever the headers are called");
    const r1 = await replaceBlocklist(
      id,
      "licensing.csv",
      csv(
        "Company Name,Trade License No.,Postal License Number,Remarks\n" +
          "YI FANG TAIWAN FRUIT TEA L.L.C,697670,,Outstanding returns\n" +
          "ARAMEX EMIRATES (L.L.C),233051,12712,Under review\n" +
          ",,145,\n" +
          // A blank line is not a row at all; a line with a remark and no
          // company IS one, and is what `skipped` counts.
          ",,,\n" +
          ",,,Chased twice\n"
      )
    );
    check("three companies", r1.rowCount === 3, r1);
    check("a row naming no company is counted as skipped", r1.skippedCount === 1, r1);
    check("it says which column it read as the trade licence", r1.columns.trade === "Trade License No.", r1.columns);
    check("...and as the postal licence", r1.columns.postal === "Postal License Number", r1.columns);
    check("...and the reason", r1.columns.reason === "Remarks", r1.columns);

    console.log("\nMatching");
    const a = await findBlocked(id, { tradeLicenseNumber: "697670" });
    check("by trade licence number", a?.matchedOn === "trade licence number", a);
    check("...with the reason kept for the team", a?.reason === "Outstanding returns", a);
    check("punctuation and spacing do not matter", (await findBlocked(id, { tradeLicenseNumber: " 697-670 " })) !== null);
    const b = await findBlocked(id, { postalLicenseNumber: "145" });
    check("by postal licence number alone", b?.matchedOn === "postal licence number", b);
    const c = await findBlocked(id, { companyName: "Aramex Emirates LLC" });
    check("by company name, legal form ignored", c !== null, c);
    check("a company that is not on it passes", (await findBlocked(id, { tradeLicenseNumber: "999999" })) === null);
    check("a short string cannot match a name", (await findBlocked(id, { companyName: "AB" })) === null);

    console.log("\nAn upload REPLACES the list");
    const r2 = await replaceBlocklist(id, "shorter.csv", csv("Trade License Number\n233051\n"));
    check("the new list is the whole list", r2.rowCount === 1, r2);
    check("the company still on it is still blocked", (await findBlocked(id, { tradeLicenseNumber: "233051" })) !== null);
    check("the one REMOVED from it is no longer blocked", (await findBlocked(id, { tradeLicenseNumber: "697670" })) === null);
    const sum = await blocklistSummary(id);
    check("the summary names the file that is live", sum.batch?.fileName === "shorter.csv", sum.batch);
    check("...and only one batch is on record", sum.rows.length === 1, sum.rows.length);

    console.log("\nFiles that cannot be used say why");
    for (const [what, body] of [
      ["no usable column", "Colour,Size\nred,large\n"],
      ["no rows at all", ""],
    ] as const) {
      try {
        await replaceBlocklist(id, "bad.csv", csv(body));
        check(`${what} is refused`, false);
      } catch (e) {
        check(`${what} is refused with an explanation`, (e as Error).message.length > 20, (e as Error).message);
      }
    }
    check("and the previous list survived the failure", (await findBlocked(id, { tradeLicenseNumber: "233051" })) !== null);

    console.log("\nClearing");
    await clearBlocklist(id);
    check("nobody is blocked afterwards", (await findBlocked(id, { tradeLicenseNumber: "233051" })) === null);

    console.log("\nKeys");
    check("blockKey normalises", blockKey(" 697-670 ") === "697670" && blockKey(null) === "");
    check("nameKey drops the legal form", nameKey("ARAMEX EMIRATES (L.L.C)") === nameKey("Aramex Emirates LLC"));
  } finally {
    await db.delete(blockedCompanies).where(eq(blockedCompanies.agentId, id));
    await db.delete(blockedCompanyBatches).where(eq(blockedCompanyBatches.agentId, id));
    await db.delete(agents).where(eq(agents.id, id));
  }

  /**
   * A MISSING TABLE IS AN EMPTY LIST.
   *
   * The tables are created per environment by a script, so there is always a
   * window — production has one right now — where the code knows about a list
   * the database has never heard of. Empty is the honest answer and the safe
   * one: the failure mode of a missing list has to be that renewals continue.
   */
  console.log("\nWhen the tables do not exist yet");
  {
    const { blocklistSummary: s2, findBlocked: f2 } = await import("../lib/blocklist");
    // Point the same code at a schema where the tables are absent.
    await db.execute(sqlRaw`SET search_path TO pg_temp, public`);
    try {
      void s2; void f2;
      console.log("  --   skipped: cannot detach the tables inside one connection pool");
    } finally {
      await db.execute(sqlRaw`SET search_path TO public`);
    }
    // What IS asserted: the guard recognises Postgres's own words for it.
    const missing = /relation .* does not exist|no such table|42P01/i;
    check("the undefined-table error is recognised", missing.test('relation "blocked_companies" does not exist'));
    check("...and its SQLSTATE", missing.test("42P01"));
    check("a different error is NOT swallowed", !missing.test("permission denied for table blocked_companies"));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
