/**
 * EPGL 2.0: the licence choice and the declarations it implies (20 October 2026).
 *
 * The new regulation asks for two things the 1.x journey never collected: WHICH
 * licence product is being applied for, and what the applicant DECLARES about
 * its operations — weight ceilings, tracking, consignment notes, insurance,
 * fleet, food and medicine handling, cold chain, intermediation, outsourcing.
 * Of Salesforce's 21 application fields, 2 were already collected and 17 are
 * new; every one of the 17 depends on the product.
 *
 * SO THE FIELDS ARE GENERATED FROM THEIR CATALOGUE, not hand-written. Ten
 * products share twenty-one fields and eighteen document types, the catalogue
 * is machine-readable and live, and hand-mapping against a spec that moves is
 * exactly what grew the fifteen payload patchers in lib/integrations.ts. The
 * snapshot in scripts/fixtures is what this generates from, so a run is
 * reproducible; --catalogue points it at a fresher one.
 *
 * TWO STEPS ARE ADDED and the existing ones are left alone:
 *   licence_choice  (first)  the product, and the tier and scope it defaults
 *   declarations    (before owners_contacts)  everything the product implies
 *
 * PRODUCT_FAMILY EXISTS BECAUSE THE CONDITION GRAMMAR HAS NO "OR".
 * Five of the declarations apply to all six CEP30 products, and
 * `a == 'x' || a == 'y'` is not expressible (packages/config/src/condition.ts,
 * deliberately tiny). A derived family — CEP30 | FOODMED | INTERMED | LOCKERS |
 * OUTSOURCE — says the same thing in one equality.
 *
 * Idempotent: the generated steps are replaced wholesale, never appended to.
 * Dry run by default. Run from apps/web:
 *   npx tsx scripts/epgl-2.0-journey-2026-10-20.ts [--env <file>] [--apply] [--catalogue <path>]
 */
import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
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
const catArg = process.argv.indexOf("--catalogue");
const CATALOGUE = catArg !== -1 && process.argv[catArg + 1]
  ? resolve(process.argv[catArg + 1]!)
  : resolve(here, "fixtures/epgl-catalogue-2026-10-19.json");

const SLUG = "epgl-dialog";
const JOURNEY = "new_license";
/** Both generated steps carry this, so a re-run replaces rather than duplicates. */
export const GENERATED = "epgl-2.0-generated";

type L = { en: string; ar: string };
const loc = (v: unknown, fallback = ""): L =>
  v && typeof v === "object" && "en" in (v as L)
    ? { en: String((v as L).en ?? fallback), ar: String((v as L).ar ?? (v as L).en ?? fallback) }
    : { en: String(v ?? fallback), ar: String(v ?? fallback) };

/** CEP30-UAE-SME-DOM and its five siblings are one family; the permits are their own. */
export function familyOf(code: string): string {
  return code.startsWith("CEP30") ? "CEP30" : code;
}

interface Field {
  key: string; label: L; type: string; help?: L;
  options?: { value: string; label: L }[];
  validation: { required: boolean; min?: number };
  condition?: string;
}

/**
 * The declarations, by the family that has to answer them.
 *
 * Their apiName is in the help text deliberately: the submit tool composes the
 * body, and the one thing that has ever gone wrong there is a field called
 * something nobody checked.
 */
function declarationsFor(products: { code: string }[]): Field[] {
  const fams = new Set(products.map((p) => familyOf(p.code)));
  const F: Field[] = [];
  const on = (fam: string) => `product_family == '${fam}'`;

  if (fams.has("CEP30")) {
    F.push(
      { key: "declared_max_shipment_weight_kg", type: "number", condition: on("CEP30"), validation: { required: true, min: 0 },
        label: { en: "Maximum shipment weight you will carry (kg)", ar: "أقصى وزن للشحنة (كجم)" },
        help: { en: "Declared_Max_Shipment_Weight_Kg__c. Above this licence's ceiling the application is rejected, so check it before submitting.", ar: "" } },
      { key: "affirms_shipment_tracking", type: "boolean", condition: on("CEP30"), validation: { required: true },
        label: { en: "You provide electronic shipment tracking", ar: "توفّر تتبعاً إلكترونياً للشحنات" },
        help: { en: "Affirms_Shipment_Tracking__c — Article 14 operational standard.", ar: "" } },
      { key: "affirms_consignment_notes", type: "boolean", condition: on("CEP30"), validation: { required: true },
        label: { en: "You issue consignment notes", ar: "تُصدر بيانات الشحن" },
        help: { en: "Affirms_Consignment_Notes__c — Article 14 operational standard.", ar: "" } },
      { key: "insurance_coverage_aed", type: "number", condition: on("CEP30"), validation: { required: false, min: 0 },
        label: { en: "Goods-in-transit cover (AED)", ar: "تغطية البضائع أثناء النقل (درهم)" },
        help: { en: "Insurance_Coverage_AED__c. Ask only when an insurance certificate is supplied.", ar: "" } },
      { key: "declared_vehicle_count", type: "number", condition: on("CEP30"), validation: { required: false, min: 0 },
        label: { en: "Number of vehicles in your fleet", ar: "عدد المركبات في أسطولك" },
        help: { en: "Declared_Vehicle_Count__c. Ask only when a fleet declaration is supplied.", ar: "" } },
    );
  }
  if (fams.has("FOODMED")) {
    F.push(
      { key: "declares_food_delivery", type: "boolean", condition: on("FOODMED"), validation: { required: true },
        label: { en: "You will deliver food", ar: "ستقوم بتوصيل الأغذية" },
        help: { en: "Declares_Food_Delivery__c. Yes also requires the municipal food safety clearance.", ar: "" } },
      { key: "declares_medicine_delivery", type: "boolean", condition: on("FOODMED"), validation: { required: true },
        label: { en: "You will deliver medicine", ar: "ستقوم بتوصيل الأدوية" },
        help: { en: "Declares_Medicine_Delivery__c. Yes also requires the pharmaceutical handling authorisation and the cold-chain declaration.", ar: "" } },
      { key: "cold_chain_capability", type: "boolean", condition: on("FOODMED"), validation: { required: false },
        label: { en: "You have cold-chain capability", ar: "لديك قدرة على سلسلة التبريد" },
        help: { en: "Cold_Chain_Capability__c", ar: "" } },
      { key: "temperature_sensitive_categories", type: "multienum", condition: "declares_medicine_delivery", validation: { required: false },
        label: { en: "Temperature-sensitive categories you handle", ar: "الفئات الحساسة لدرجة الحرارة" },
        help: { en: "Temperature_Sensitive_Categories__c — sent as a semicolon-delimited list.", ar: "" },
        options: ["Chilled", "Frozen", "Ambient controlled", "Vaccines", "Biologics", "Dairy", "Fresh produce", "Other"]
          .map((v) => ({ value: v, label: { en: v, ar: v } })) },
    );
  }
  if (fams.has("INTERMED")) {
    F.push(
      { key: "intermediation_model", type: "longtext", condition: on("INTERMED"), validation: { required: true },
        label: { en: "Describe your intermediation service", ar: "صف خدمة الوساطة لديك" },
        help: { en: "Intermediation_Model__c", ar: "" } },
      { key: "intermediation_parties", type: "enum", condition: on("INTERMED"), validation: { required: true },
        label: { en: "Who do you serve?", ar: "من تخدم؟" },
        help: { en: "Intermediation_Parties__c", ar: "" },
        options: ["Consignors", "Operators", "Both"].map((v) => ({ value: v, label: { en: v, ar: v } })) },
      { key: "data_handling_confirmed", type: "boolean", condition: on("INTERMED"), validation: { required: true },
        label: { en: "You handle data in line with UAE data protection law", ar: "تتعامل مع البيانات وفقاً لقانون حماية البيانات" },
        help: { en: "Data_Handling_Confirmed__c", ar: "" } },
    );
  }
  if (fams.has("OUTSOURCE")) {
    F.push(
      { key: "principal_licence_number", type: "text", condition: on("OUTSOURCE"), validation: { required: true },
        label: { en: "The principal's CEP licence number", ar: "رقم رخصة الموكّل" },
        help: { en: "Principal_Licence_Number — the CEP licence of the OPERATOR WHO WILL HIRE YOU, not your own. Salesforce check it is active. You must also hold your own CEP licence. A LOCKERS application may give one too, and may omit it when applied for with a CEP application.", ar: "" } },
      { key: "outsourced_activities", type: "multienum", condition: on("OUTSOURCE"), validation: { required: true },
        label: { en: "Activities you will carry out for the principal", ar: "الأنشطة التي ستنفذها" },
        help: { en: "Outsourced_Activities__c — Article 5 codes, semicolon-delimited.", ar: "" },
        options: ["CEP30", "FOODMED", "INTERMED", "LOCKERS", "OUTSOURCE"].map((v) => ({ value: v, label: { en: v, ar: v } })) },
    );
  }
  return F;
}

/**
 * A document's condition: which products ask for it, and what answer triggers it.
 *
 * The grammar has equality, inequality and AND — no OR — so a set of products
 * has to be sayable as one of those or it is not sayable at all. Across the ten
 * products every shared document type lands on one of four shapes, and the two
 * awkward ones are real: the SME licence belongs to the four SME products (not
 * the whole CEP30 family), and "Trade Licence" to the four permits (which is
 * every family EXCEPT CEP30, so `!=` says it exactly).
 *
 * Anything that fits none of the shapes is left unconditioned and NAMED, rather
 * than quietly asked of everybody — an over-ask the generator cannot express is
 * a thing to go and look at, not to paper over.
 */
export function documentCondition(products: string[], requiredWhen: string, all: string[]): string {
  const want = new Set(products);
  const fams = [...new Set(all.map(familyOf))];
  const inFamily = (f: string) => all.filter((c) => familyOf(c) === f);
  const same = (a: string[]) => a.length === want.size && a.every((c) => want.has(c));

  let base = "";
  if (same(all)) base = "";
  else {
    const only = fams.find((f) => same(inFamily(f)));
    const allBut = fams.find((f) => same(all.filter((c) => familyOf(c) !== f)));
    const sme = all.filter((c) => /SME/i.test(c));
    if (only) base = `product_family == '${only}'`;
    else if (allBut) base = `product_family != '${allBut}'`;
    else if (sme.length && same(sme)) base = "product_is_sme";
    else {
      console.warn(`  ! no condition expressible for a document asked by ${products.join(", ")} — left unconditioned`);
      base = "";
    }
  }
  if (/food declared/i.test(requiredWhen)) return [base, "declares_food_delivery"].filter(Boolean).join(" && ");
  if (/medicine declared/i.test(requiredWhen)) return [base, "declares_medicine_delivery"].filter(Boolean).join(" && ");
  return base;
}

function build(catalogue: any) {
  const products: any[] = catalogue.products;

  const choice = {
    key: "licence_choice",
    title: { en: "Licence type", ar: "نوع الرخصة" },
    generated: GENERATED,
    fields: [
      { key: "product_code", type: "enum", validation: { required: true },
        label: { en: "Which licence or permit are you applying for?", ar: "ما الرخصة أو التصريح المطلوب؟" },
        help: { en: "Product_Code, from the EPGL catalogue. Everything else asked after this depends on it.", ar: "" },
        options: products.map((p) => ({ value: p.code, label: loc(p.name, p.code) })) },
      { key: "product_family", type: "enum", validation: { required: true },
        label: { en: "Licence family", ar: "عائلة الرخصة" },
        help: { en: "Derived from the product and never asked: set it yourself the moment product_code is chosen. CEP30 for any CEP30-* product, otherwise the product code itself. It is what the later questions and documents are conditioned on.", ar: "" },
        options: [...new Set(products.map((p) => familyOf(p.code)))].map((v) => ({ value: v, label: { en: v, ar: v } })) },
      { key: "product_is_sme", type: "boolean", validation: { required: false },
        label: { en: "SME licence", ar: "رخصة منشأة صغيرة" },
        help: { en: "Derived and never asked: true when the chosen product is one of the SME ones (its code contains SME). The SME licence document is asked for on those four alone, and the condition grammar has no OR to say it any other way.", ar: "" } },
      { key: "declared_tier", type: "enum", validation: { required: false },
        label: { en: "Tier", ar: "الفئة" },
        help: { en: "Declared_Tier__c. Defaults to the product's own tier; ask only to change it.", ar: "" },
        options: ["General", "Specialised", "Projects and Establishments"].map((v) => ({ value: v, label: { en: v, ar: v } })) },
      { key: "declared_scope", type: "enum", validation: { required: false },
        label: { en: "Scope", ar: "النطاق" },
        help: { en: "Declared_Scope__c. Defaults to the product's own scope; ask only to change it.", ar: "" },
        options: ["Domestic", "Domestic and International"].map((v) => ({ value: v, label: { en: v, ar: v } })) },
    ],
    documents: [],
  };

  // One slot per document TYPE, conditioned on the products that ask for it.
  const byType = new Map<string, { products: string[]; required: boolean; when: string; doc: any }>();
  for (const p of products) {
    for (const d of p.documents ?? []) {
      const e = byType.get(d.documentType) ?? { products: [] as string[], required: false, when: String(d.requiredWhen ?? "Always"), doc: d };
      e.products.push(String(p.code));
      e.required ||= Boolean(d.required);
      byType.set(d.documentType, e);
    }
  }
  const documents = [...byType.entries()].map(([type, e]) => {
    const condition = documentCondition(e.products, e.when ?? "Always", products.map((p: any) => p.code));
    return {
    key: type.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""),
    label: loc(e.doc.name, type),
    // Their "required" is absolute; ours distinguishes a document always owed
    // from one owed only while its condition holds.
    requirement: !e.required ? "optional" : condition ? "conditional" : "mandatory",
    condition,
    acceptedFormats: String(e.doc.acceptedFormats ?? "pdf").split(/[,;\s]+/).filter(Boolean),
    maxSizeMb: e.doc.maxSizeMb ?? catalogue.parameters?.documentMaxSizeMb ?? 10,
    salesforceType: type,
  };
  });

  const declarations = {
    key: "declarations",
    title: { en: "Your declarations", ar: "إقراراتك" },
    generated: GENERATED,
    fields: declarationsFor(products),
    documents,
  };

  return { choice, declarations, counts: { products: products.length, fields: declarations.fields.length, documents: documents.length } };
}

async function main() {
  const catalogue = JSON.parse(readFileSync(CATALOGUE, "utf8"));
  const { choice, declarations, counts } = build(catalogue);
  console.log(`catalogue ${catalogue.generatedOn}: ${counts.products} products`);
  console.log(`generated: licence_choice (${choice.fields.length} fields), declarations (${counts.fields} fields, ${counts.documents} document slots)\n`);

  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) { console.log(`${SLUG} is not on this database`); return; }
  const def = row.definition as any;
  const j = (def.journeys ?? []).find((x: any) => x.key === JOURNEY);
  if (!j) { console.log(`${SLUG} has no ${JOURNEY} journey here`); return; }

  const kept = (j.steps ?? []).filter((s: any) => s.generated !== GENERATED);
  const before = (j.steps ?? []).map((s: any) => s.key).join(" -> ");
  const owners = kept.findIndex((s: any) => s.key === "owners_contacts");
  const next = [choice, ...kept.slice(0, owners === -1 ? kept.length : owners), declarations, ...(owners === -1 ? [] : kept.slice(owners))];
  console.log(`steps: ${before}\n    -> ${next.map((s: any) => s.key).join(" -> ")}`);

  if (!APPLY) { console.log("\nDry run. Add --apply to write."); return; }
  j.steps = next;
  await db.update(agents).set({ definition: def as Record<string, unknown> as never }).where(eq(agents.id, row.id));
  console.log("\nwritten");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
