/**
 * What the extractor actually reads off a real trade licence (30 October 2026).
 *
 * EPGL reported three fields wrong on LR-39149 — an Arabic company name with a
 * letter missing, no trade licence issuance date, and both trade names empty.
 * All three are claims about what comes back from ONE call, so this runs that
 * call against the licence they tested with and prints the answer beside what
 * the document says.
 *
 * It needs the file and a live model, so it is a probe rather than a test:
 *
 *   npx tsx scripts/probe-licence-extraction-2026-10-30.ts \
 *     --file "/Users/…/Trade License Main 697670 - 2025 - 2026.pdf"
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), "../../.env") });
import { readFileSync } from "node:fs";
import { extractFieldsFromDocument } from "@dialog/core";
import type { AgentDefinition, CaseState } from "@dialog/config";

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};

const file = arg("file", "/Users/emrekarayalcin/Documents/7x-proj-tech/agents/Trade License Main 697670 - 2025 - 2026.pdf")!;

/**
 * The company step of the EPGL issuance journey, with the issuance date beside
 * the expiry. Labels are the field descriptions the extractor is given, so they
 * are copied from the journey rather than invented here.
 */
const text = (key: string, en: string) => ({ key, label: { en }, type: "text" as const, validation: { required: false } });
const AGENT = {
  journeys: [
    {
      key: "new_license",
      steps: [
        {
          key: "company_details",
          fields: [
            text("company_name", "Company name (English)"),
            text("company_name_ar", "Company name (Arabic)"),
            text("trade_name_en", "Trade name (English)"),
            text("trade_name_ar", "Trade name (Arabic)"),
            text("trade_license_number", "Trade license number"),
            text("license_issue_date", "Trade license issuance date"),
            text("license_expiry_date", "Trade license expiry date"),
            text("regulator", "Licensing authority / regulator"),
            text("emirate", "Emirate"),
            text("region", "Region / area"),
            text("address_street", "Street address"),
            text("po_box", "PO Box"),
            text("activity_codes", "Postal activity code(s)"),
          ],
          documents: [],
        },
      ],
    },
  ],
} as unknown as AgentDefinition;

const STATE = { journeyKey: "new_license", data: {}, documents: [], readiness: { complete: false, missing: [] } } as unknown as CaseState;

/** What the licence PRINTS — read off the rendered page, not the text layer. */
const PRINTED: Record<string, string> = {
  company_name: "YI FANG TAIWAN FRUIT TEA L.L.C",
  company_name_ar: "اي فانغ تايوان فروتي للشاي ش.ذ.م.م",
  trade_name_en: "YI FANG TAIWAN FRUIT TEA L.L.C",
  trade_name_ar: "اي فانغ تايوان فروتي للشاي ش.ذ.م.م",
  trade_license_number: "697670",
  license_issue_date: "2013-11-05",
  license_expiry_date: "2026-11-04",
};

async function main() {
  const bytes = new Uint8Array(readFileSync(file));
  console.log(`\n${file}  (${(bytes.length / 1024).toFixed(0)} KB)\n`);
  const r = await extractFieldsFromDocument({
    agent: AGENT,
    state: STATE,
    locale: "en",
    fileName: file.split("/").pop()!,
    contentType: "application/pdf",
    bytes,
    expected: { key: "trade_license", label: "Trade license copy" },
  });
  if (r.note) {
    console.error(`the extraction did not run: ${r.note}`);
    process.exit(2);
  }
  console.log("classified as:", r.docType, "| document expiry:", r.docExpiryDate ?? "—", "\n");

  let wrong = 0;
  for (const [k, printed] of Object.entries(PRINTED)) {
    const got = r.values[k];
    const ok = got === printed;
    if (!ok) wrong++;
    console.log(`${ok ? "ok  " : "WRONG"} ${k}`);
    if (!ok) {
      console.log(`        printed: ${printed}`);
      console.log(`        got:     ${got ?? "(empty)"}`);
    }
  }
  const extra = Object.keys(r.values).filter((k) => !(k in PRINTED));
  if (extra.length) console.log("\nalso read:", Object.fromEntries(extra.map((k) => [k, r.values[k]])));
  console.log(`\n${Object.keys(PRINTED).length - wrong}/${Object.keys(PRINTED).length} match what the licence prints`);
  process.exit(wrong ? 1 : 0);
}
main();
