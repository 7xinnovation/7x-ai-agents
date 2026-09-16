/**
 * A document nobody read is not a document that passed.
 *
 * 16 September, a signed-in EPGL applicant: the company came off their UAE PASS
 * profile, the assistant offered the trade-licence upload straight away — before
 * calling set_journey — and an EXPIRED 2021 licence went in and was accepted
 * with a green tick. Both uploads in that conversation audit as `extracted: []`.
 *
 * The trap is here: the extractor takes its field list from the CASE's journey
 * and returns an empty list when the case has not chosen one, and an empty list
 * makes it return `{}` without ever sending the document to the model. Every
 * check downstream reads those values, so all of them quietly became no-ops —
 * the expiry, the company match, the partner identity. The only thing that
 * questioned an expired licence was the model noticing "old" in the filename.
 *
 * Run from apps/web:  npx tsx scripts/test-unread-document-2026-09-16.ts
 */
import { extractionFieldsFor } from "@dialog/core";
import { emptyCase, type AgentDefinition, type CaseState } from "@dialog/config";
import { expiredLicence } from "../lib/docIdentity";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : `\n         ${JSON.stringify(got)}`}`); }
};

const AGENT = {
  slug: "t", name: "t", locales: ["en"], greeting: { en: "hi" }, theme: {}, intents: [], guardrails: {},
  journeys: [
    {
      key: "new_license", title: { en: "New licence" },
      steps: [{
        key: "company", title: { en: "Company" },
        fields: [
          { key: "company_name", label: { en: "Company name" }, type: "text", validation: { required: true } },
          { key: "license_expiry_date", label: { en: "Trade license expiry date" }, type: "date", validation: { required: true } },
        ],
        documents: [{ key: "trade_license", label: { en: "Trade License" }, requirement: "required", acceptedFormats: ["pdf"], maxSizeMb: 10 }],
      }],
    },
  ],
} as unknown as AgentDefinition;

const withJourney = (k: string): CaseState => ({ ...emptyCase(), journeyKey: k });

console.log("\nThe field list an upload is read against");
{
  const chosen = extractionFieldsFor(AGENT, withJourney("new_license"), "en");
  check("a chosen journey offers its fields", chosen.length === 2, chosen.map((f) => f.key));
  check("...including the licence expiry", chosen.some((f) => f.key === "license_expiry_date"));

  // The trap, kept on the record: with no journey there is nothing to read
  // FOR, and the extractor short-circuits before the document is ever sent.
  const none = extractionFieldsFor(AGENT, withJourney(""), "en");
  check("no journey offers nothing at all", none.length === 0, none);

  // Which is why the upload route must name the journey the SLOT belongs to
  // rather than the one the case happens to be on. The slot always knows.
  const ownerOf = (key: string) =>
    AGENT.journeys.find((j) => j.steps.some((s) => s.documents.some((d) => d.key === key)))?.key;
  check("the slot names its own journey", ownerOf("trade_license") === "new_license", ownerOf("trade_license"));
  check("...and that journey reads the document", extractionFieldsFor(AGENT, withJourney(ownerOf("trade_license")!), "en").length === 2);
}

console.log("\nThe expiry, from whichever source has it");
{
  const now = new Date("2026-09-16T12:00:00Z");
  check("the mapped field refuses a past licence", expiredLicence({ license_expiry_date: "2022-03-31" }, now) !== null);
  check("a current licence passes", expiredLicence({ license_expiry_date: "2026-11-04" }, now) === null);
  // The route merges the document's OWN printed expiry under the same key, so a
  // licence that printed a date the model did not map is still checked.
  const printedOnly = { license_expiry_date: "2021-12-31" };
  check("the printed expiry alone is enough", expiredLicence(printedOnly, now) !== null, expiredLicence(printedOnly, now));
  // ...and a mapped value wins over the merged one, which is the route's spread order.
  check("nothing to check is not a failure", expiredLicence({}, now) === null);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
