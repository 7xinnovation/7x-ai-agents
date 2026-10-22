/**
 * EPGL 2.0: the values their composite actually accepts (22 October 2026).
 *
 * The first end-to-end run of the 2.0 journey reached the composite and was
 * rejected twice, and every rejection was ours:
 *
 *   Unknown RecordType "Business" for Account        -> then "Licensee", also unknown
 *   Unknown Product_Code "COURIER"                   -> then "POSTAL_COURIER", also unknown
 *   sObject type not found: EPG_Beneficial_Owner__c  -> the object is Beneficial_Owner__c
 *   Invalid value was provided for "Basis of Beneficial Ownership"
 *
 * NONE OF THAT IS A GAP IN THEIR API. Their own OpenAPI gives `RecordType`
 * example `Licensed_Customer` and `Ownership_Basis__c` example "Direct
 * ownership (25% or more)", and the catalogue carries the ten real product
 * codes. The model invented values instead of reading them, and when the first
 * guess was refused it guessed again rather than stopping.
 *
 * The composite is allOrNone, so one invented value rolls the whole application
 * back. A second guess is not a retry, it is a second rejection — and the
 * applicant watches both.
 *
 * Run from apps/web:
 *   npx tsx scripts/epgl-2.0-values-2026-10-22.ts --env <file> [--apply]
 */
import { config } from "dotenv";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
const envArg = process.argv.indexOf("--env");
config({
  path:
    envArg !== -1 && process.argv[envArg + 1]
      ? resolve(process.argv[envArg + 1]!)
      : resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env"),
});
import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";

const here = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes("--apply");
const SLUG = "epgl-dialog";
const JOURNEY = "new_license";
export const MARKER = "EPGL 2.0 — THE VALUES THEIR COMPOSITE ACCEPTS (2026-10-22)";

/** The product codes, read from the catalogue rather than typed out here. */
function productLines(): string {
  const cat = JSON.parse(readFileSync(join(here, "fixtures/epgl-catalogue-2026-10-22.json"), "utf8")) as {
    products?: Array<{ code?: string; name?: { en?: string } | string }>;
  };
  return (cat.products ?? [])
    .map((p) => {
      const name = typeof p.name === "string" ? p.name : p.name?.en ?? "";
      return `  ${p.code} — ${name}`;
    })
    .join("\n");
}

const GUIDANCE = `${MARKER}. These are exact values their API refused us on 22 October. They override anything below that conflicts.

THE APPLICANT CHOOSES THE LICENCE, AND THEY CHOOSE IT BEFORE ANYTHING IS CREATED. Product_Code is required on the application and it must be one of the codes below, copied exactly. Never compose one from the company's trade activity, never translate a product name into a code, and never send a code that is not on this list. Ask which licence they are applying for — with the weight ceiling, the ownership basis and whether they need international — and read the answer back before you create anything.

${productLines()}

The first six differ only by who owns the company and how far they ship, so ask, do not infer: SME and UAE-national-owned are things the applicant tells you, and DOM covers domestic only while INTL covers domestic and international. FOODMED, INTERMED, LOCKERS and OUTSOURCE are separate activities, not upgrades.

EXACT VALUES, from their own specification:
  Account RecordType is "Licensed_Customer". Not Business, not Licensee, not Account.
  The beneficial owner object is Beneficial_Owner__c. There is no EPG_Beneficial_Owner__c.
  Ownership_Basis__c is a picklist and "Direct ownership (25% or more)" is their documented value. If an applicant's situation is not that, ask them rather than inventing a phrase.

THE OBJECT NAMES ARE NOT GUESSABLE, AND THE EPG_ PREFIX IS NOT A PATTERN. Their composite accepts exactly these nine, and nothing else exists:
  Account                     the company
  Contact                     the authorised signatory
  Beneficial_Owner__c         an owner — NO EPG_ prefix
  EPG_License_Request__c      the application itself — WITH the EPG_ prefix
  Application_Item__c         a line on the application
  Application_Site__c         a premises
  Operator_Contract__c        an outsourcing or operator contract
  EPG_Document__c             a document slot
  ContentVersion              a file uploaded ahead of the composite
Beneficial_Owner__c has no prefix and EPG_License_Request__c has one. There is no rule to derive; copy them. "License_Request__c" does not exist.

THE DECLARATIONS ARE FIELDS ON THE LICENCE REQUEST, NOT AN OBJECT. There is no declarations object — "License_Request_Declarations__c" does not exist. What the applicant told you goes on EPG_License_Request__c as fields, spelled their way: Affirms_Shipment_Tracking__c, Affirms_Consignment_Notes__c, Cold_Chain_Capability__c, Insurance_Coverage_AED__c and Declarations_Accepted_On__c among them. Read the rest off the catalogue.

A REFUSED VALUE IS NOT AN INVITATION TO GUESS AGAIN. The composite runs allOrNone, so one unknown code rolls back the Account, the owners and the application together. If their response says a value is unknown, STOP: say which field was refused, ask the applicant for whatever you actually need, or raise it with the team. Do not send a second guess — it fails the same way and the applicant sees two failures instead of one question.

The fields they list under applicationFields are what the APPLICATION item carries, and Product_Code and Signatory_UAE_PASS_Id are both required there. Signatory_UAE_PASS_Id is the UAE PASS id of the signed-in authorised signatory, who must be a Contact of the company — not an Emirates ID, and not a name.`;

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) { console.log(`${SLUG} is not on this database`); return; }
  const def = row.definition as Record<string, unknown>;
  const journeys = (def.journeys ?? []) as Array<Record<string, unknown>>;
  const j = journeys.find((x) => x.key === JOURNEY);
  if (!j) { console.log(`no ${JOURNEY} journey here`); return; }

  const text = String(j.guidance ?? "");
  if (text.includes(MARKER)) {
    // Idempotent: replace this block rather than stacking another copy.
    const start = text.indexOf(MARKER);
    const rest = text.slice(start);
    const sep = rest.indexOf("\n\n---\n\n");
    j.guidance = sep === -1 ? GUIDANCE : GUIDANCE + rest.slice(sep);
    console.log(`guidance: replacing the existing ${MARKER} block`);
  } else {
    j.guidance = `${GUIDANCE}\n\n---\n\n${text}`;
    console.log(`guidance: +${GUIDANCE.length} chars prepended`);
  }
  console.log(`products listed from the catalogue: ${productLines().split("\n").length}`);

  if (!APPLY) { console.log("\nDry run. Add --apply to write."); return; }
  await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
  console.log("written");
}

main();
