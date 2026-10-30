/**
 * The EPGL 2.0 test pack, in both languages (28 October 2026).
 *
 * Every document in the pack was English-only, including the lines that exist
 * precisely because the real document is bilingual: a Dubai trade licence
 * prints "Company Name (AR)" and ours answered it with the English string.
 * So nothing in the pack ever exercised company_name_ar, trade_name_ar or
 * owner_name_ar — four of the journey's fields and the half of every UAE
 * document a real applicant actually holds.
 *
 * Safe to do because identity is settled by number, not by spelling: every
 * document here carries the same trade licence number, and lib/docIdentity
 * ends the company question on an exact identifier. Person names are compared
 * and never blocked on, and the Arabic name fields are ones it already knows.
 *
 * Rendered through headless Chrome rather than written as raw PDF operators:
 * Arabic needs contextual shaping and right-to-left ordering, which a text
 * drawing primitive does not do — the previous generator could not have
 * produced a correct Arabic line at all. Chrome embeds a subset with a
 * ToUnicode map, so the text still extracts (verified with pdftotext).
 *
 * The English stays byte-identical, label for label and value for value. The
 * pack is a regression fixture as much as a demo, and a test document whose
 * English moved would quietly change what the extractor is being tested on.
 *
 * Run from apps/web:
 *   npx tsx scripts/epgl-test-pack-2026-10-28.ts --out <documents dir> [--keep-html]
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const outArg = process.argv.indexOf("--out");
const OUT = outArg !== -1 && process.argv[outArg + 1]
  ? resolve(process.argv[outArg + 1]!)
  : resolve(process.cwd(), "../../../EPGL-2.0-test-pack-2026-10-22/documents");

/** One company, one licence number, in both scripts. */
const CO_EN = "7X TEST - DO NOT PROCESS - 20261022A";
const CO_AR = "اختبار 7X - لا تقم بالمعالجة - 20261022A";
const TRADE_EN = "7X TEST COURIER SERVICES";
const TRADE_AR = "خدمات 7X للبريد السريع";
const TL = "CN-1234567";
const ADDR_EN = "Office 101, Test Tower, Business Bay, Dubai, UAE";
const ADDR_AR = "مكتب 101، برج تست، الخليج التجاري، دبي، الإمارات العربية المتحدة";
const P1_EN = "Ahmed Al Mansoori";
const P1_AR = "أحمد المنصوري";
const P2_EN = "Sara Al Hashimi";
const P2_AR = "سارة الهاشمي";
const UAE_EN = "United Arab Emirates";
const UAE_AR = "الإمارات العربية المتحدة";
const LLC_EN = "Limited Liability Company (LLC)";
const LLC_AR = "شركة ذات مسؤولية محدودة (ش.ذ.م.م)";
const BANNER_EN = "*** 7X TEST DOCUMENT - DO NOT PROCESS ***";
const BANNER_AR = "*** وثيقة اختبار من 7X — يُرجى عدم المعالجة ***";
const FOOT_EN = "Generated for integration testing of the EPGL assistant against the Salesforce NewLaw sandbox. Not a real document; must not be processed.";
const FOOT_AR = "أُنشئت لاختبار تكامل مساعد ترخيص مجموعة بريد الإمارات مع بيئة Salesforce التجريبية. ليست وثيقة حقيقية ولا يجوز معالجتها.";

type Row = { en: string; ar: string };
type Doc = { file: string; titleEn: string; titleAr: string; rows: Row[]; tail?: Row[]; foot?: boolean };

/** label + value in each language; the English half is unchanged from the 22 October pack. */
const r = (en: string, ar: string): Row => ({ en, ar });

const COMPANY_HEAD = [
  r(`Company: ${CO_EN}`, `الشركة: ${CO_AR}`),
  r(`Trade Licence: ${TL}`, `الرخصة التجارية: ${TL}`),
];

const PERSON = (nameEn: string, nameAr: string, eid: string, passport: string): Row[] => [
  r(`Full Name: ${nameEn}`, `الاسم الكامل: ${nameAr}`),
  r(`Emirates ID: ${eid}`, `رقم الهوية الإماراتية: ${eid}`),
  r(`Passport Number: ${passport}`, `رقم جواز السفر: ${passport}`),
  r(`Nationality: ${UAE_EN}`, `الجنسية: ${UAE_AR}`),
  r("Date of Birth: 01/01/1990", "تاريخ الميلاد: 01/01/1990"),
  r("Date of Issue: 01/01/2024", "تاريخ الإصدار: 01/01/2024"),
  r("Date of Expiry: 01/01/2034", "تاريخ الانتهاء: 01/01/2034"),
  r("Place of Issue: Dubai, UAE", "مكان الإصدار: دبي، الإمارات العربية المتحدة"),
];

const DOCS: Doc[] = [
  {
    file: "01-trade-licence.pdf",
    titleEn: "DEPARTMENT OF ECONOMIC DEVELOPMENT - DUBAI\nCOMMERCIAL TRADE LICENCE",
    titleAr: "دائرة التنمية الاقتصادية — دبي\nالرخصة التجارية",
    rows: [
      r(`Licence Number: ${TL}`, `رقم الرخصة: ${TL}`),
      r(`Company Name (EN): ${CO_EN}`, `اسم الشركة (إنجليزي): ${CO_EN}`),
      r(`Company Name (AR): ${CO_AR}`, `اسم الشركة (عربي): ${CO_AR}`),
      r(`Trade Name: ${TRADE_EN}`, `الاسم التجاري: ${TRADE_AR}`),
      r(`Legal Form: ${LLC_EN}`, `الشكل القانوني: ${LLC_AR}`),
      r("Issue Date: 01/01/2026", "تاريخ الإصدار: 01/01/2026"),
      r("Expiry Date: 31/12/2027", "تاريخ الانتهاء: 31/12/2027"),
      r("Emirate: Dubai", "الإمارة: دبي"),
      r(`Registered Address: ${ADDR_EN}`, `العنوان المسجل: ${ADDR_AR}`),
      r("P.O. Box: 50500", "صندوق البريد: 50500"),
      r("Telephone: 00971553708434", "الهاتف: 00971553708434"),
      r("Email: noreply@7x.ae", "البريد الإلكتروني: noreply@7x.ae"),
      r("Licensed Activities:", "الأنشطة المرخصة:"),
      r("  - Courier Services", "  - خدمات التوصيل السريع"),
      r("  - Mail and Parcel Delivery", "  - توصيل البريد والطرود"),
      r(`Owner / Manager: ${P1_EN}`, `المالك / المدير: ${P1_AR}`),
      r("Emirates ID: 784-1990-7654321-0", "رقم الهوية الإماراتية: 784-1990-7654321-0"),
      r(`Nationality: ${UAE_EN}`, `الجنسية: ${UAE_AR}`),
    ],
    tail: [r(
      "This document was generated for integration testing of the EPGL assistant against the Salesforce NewLaw sandbox. It is not a real licence and must not be processed.",
      "أُنشئت هذه الوثيقة لاختبار تكامل مساعد ترخيص مجموعة بريد الإمارات مع بيئة Salesforce التجريبية. وهي ليست رخصة حقيقية ولا يجوز معالجتها.")],
  },
  {
    file: "02-memorandum-of-association.pdf",
    titleEn: "MEMORANDUM OF ASSOCIATION",
    titleAr: "عقد التأسيس",
    rows: [
      ...COMPANY_HEAD,
      r(`Legal Form: ${LLC_EN}`, `الشكل القانوني: ${LLC_AR}`),
      r("Share Capital: AED 300,000", "رأس المال: 300,000 درهم إماراتي"),
      r("", ""),
      r("Partners:", "الشركاء:"),
      r(`  ${P1_EN} - 784-1990-7654321-0 - UAE - 51%`, `  ${P1_AR} - 784-1990-7654321-0 - الإمارات - 51%`),
      r(`  ${P2_EN}   - 784-1992-1234567-3 - UAE - 49%`, `  ${P2_AR} - 784-1992-1234567-3 - الإمارات - 49%`),
      r("", ""),
      r(`Manager: ${P1_EN}`, `المدير: ${P1_AR}`),
      r(`Registered Office: ${ADDR_EN}`, `المكتب المسجل: ${ADDR_AR}`),
      r("Date of Incorporation: 01/01/2026", "تاريخ التأسيس: 01/01/2026"),
    ],
    foot: true,
  },
  { file: "03-partner1-passport.pdf", titleEn: "PASSPORT", titleAr: "جواز سفر",
    rows: PERSON(P1_EN, P1_AR, "784-1990-7654321-0", "A1234567"), foot: true },
  { file: "04-partner1-emirates-id.pdf", titleEn: "EMIRATES ID CARD", titleAr: "بطاقة الهوية الإماراتية",
    rows: PERSON(P1_EN, P1_AR, "784-1990-7654321-0", "A1234567"), foot: true },
  { file: "05-partner2-passport.pdf", titleEn: "PASSPORT", titleAr: "جواز سفر",
    rows: PERSON(P2_EN, P2_AR, "784-1992-1234567-3", "B7654321"), foot: true },
  { file: "06-partner2-emirates-id.pdf", titleEn: "EMIRATES ID CARD", titleAr: "بطاقة الهوية الإماراتية",
    rows: PERSON(P2_EN, P2_AR, "784-1992-1234567-3", "B7654321"), foot: true },
  {
    file: "07-beneficial-ownership-declaration.pdf",
    titleEn: "BENEFICIAL OWNERSHIP DECLARATION",
    titleAr: "إقرار الملكية النفعية",
    rows: [
      ...COMPANY_HEAD,
      r("", ""),
      r("Beneficial Owners:", "المالكون المنتفعون:"),
      r(`  ${P1_EN} - 784-1990-7654321-0 - UAE - 51%`, `  ${P1_AR} - 784-1990-7654321-0 - الإمارات - 51%`),
      r("  Basis: Direct ownership (25% or more)", "  الأساس: ملكية مباشرة (25% أو أكثر)"),
      r(`  ${P2_EN} - 784-1992-1234567-3 - UAE - 49%`, `  ${P2_AR} - 784-1992-1234567-3 - الإمارات - 49%`),
      r("  Basis: Direct ownership (25% or more)", "  الأساس: ملكية مباشرة (25% أو أكثر)"),
      r("", ""),
      r("We declare the above to be accurate and complete.", "نقر بأن ما ورد أعلاه صحيح وكامل."),
      r(`Signed: ${P1_EN}, Authorised Signatory`, `التوقيع: ${P1_AR}، المفوض بالتوقيع`),
      r("Date: 22/10/2026", "التاريخ: 22/10/2026"),
    ],
    foot: true,
  },
  {
    file: "08-lease-contract-ejari.pdf",
    titleEn: "EJARI TENANCY CONTRACT",
    titleAr: "عقد إيجار — إيجاري",
    rows: [
      ...COMPANY_HEAD,
      r("", ""),
      r("Ejari Contract Number: EJ-2026-0012345", "رقم عقد إيجاري: EJ-2026-0012345"),
      r(`Premises: ${ADDR_EN}`, `العقار: ${ADDR_AR}`),
      r("Premises Type: Commercial Office", "نوع العقار: مكتب تجاري"),
      r("Area: 120 sq m", "المساحة: 120 متر مربع"),
      r("Landlord: Test Tower Properties LLC", "المالك: شركة برج تست العقارية ذ.م.م"),
      r(`Tenant: ${CO_EN}`, `المستأجر: ${CO_AR}`),
      r("Contract Period: 01/01/2026 to 31/12/2027", "مدة العقد: من 01/01/2026 إلى 31/12/2027"),
      r("Expiry Date: 31/12/2027", "تاريخ الانتهاء: 31/12/2027"),
      r("Annual Rent: AED 120,000", "الإيجار السنوي: 120,000 درهم إماراتي"),
    ],
  },
  {
    file: "09-insurance-certificate-goods-in-transit.pdf",
    titleEn: "CERTIFICATE OF INSURANCE - GOODS IN TRANSIT",
    titleAr: "شهادة تأمين — البضائع أثناء النقل",
    rows: [
      ...COMPANY_HEAD,
      r("", ""),
      r("Policy Number: GIT-7X-2026-0001", "رقم وثيقة التأمين: GIT-7X-2026-0001"),
      r(`Insured: ${CO_EN}`, `المؤمَّن له: ${CO_AR}`),
      r("Insurer: Test Insurance Company PJSC", "شركة التأمين: شركة التأمين التجريبية ش.م.ع"),
      r("Cover: Goods in Transit / Carrier's Liability", "التغطية: البضائع أثناء النقل / مسؤولية الناقل"),
      r("Sum Insured: AED 500,000 any one consignment", "مبلغ التأمين: 500,000 درهم إماراتي لكل شحنة"),
      r(`Territorial Limit: ${UAE_EN}`, `النطاق الجغرافي: ${UAE_AR}`),
      r("Period of Insurance: 01/01/2026 to 31/12/2027", "فترة التأمين: من 01/01/2026 إلى 31/12/2027"),
      r("Expiry Date: 31/12/2027", "تاريخ الانتهاء: 31/12/2027"),
    ],
  },
  {
    file: "10-operational-fleet-declaration.pdf",
    titleEn: "DECLARATION AND UNDERTAKING - OPERATIONAL FLEET",
    titleAr: "إقرار وتعهد — الأسطول التشغيلي",
    rows: [
      ...COMPANY_HEAD,
      r("", ""),
      r("I, the undersigned authorised signatory of the above company, hereby declare and undertake the following in respect of our operational fleet:",
        "أنا الموقّع أدناه، المفوض بالتوقيع عن الشركة المذكورة أعلاه، أقر وأتعهد بما يلي بشأن أسطولنا التشغيلي:"),
      r("", ""),
      r("1. We declare that the company operates a total of 5 vehicles for postal and courier activities, comprising:",
        "1. نقر بأن الشركة تُشغّل ما مجموعه 5 مركبات لأنشطة البريد والتوصيل السريع، وهي:"),
      r("   3 x Light Commercial Van (up to 1,500 kg payload)", "   3 مركبات نقل خفيفة (حمولة تصل إلى 1,500 كجم)"),
      r("   2 x Motorcycle (documents and small parcels)", "   2 دراجة نارية (وثائق وطرود صغيرة)"),
      r("2. We declare that all vehicles are registered in the United Arab Emirates and insured for commercial use.",
        "2. نقر بأن جميع المركبات مسجلة في الإمارات العربية المتحدة ومؤمّنة للاستخدام التجاري."),
      r("3. We declare that all drivers hold valid UAE driving licences.",
        "3. نقر بأن جميع السائقين يحملون رخص قيادة إماراتية سارية."),
      r("4. We undertake that the maximum single shipment weight handled will not exceed 30 kg.",
        "4. نتعهد بألا يتجاوز الوزن الأقصى للشحنة الواحدة 30 كجم."),
      r("5. We undertake to notify Emirates Post Group of any material change to the fleet declared above.",
        "5. نتعهد بإبلاغ مجموعة بريد الإمارات بأي تغيير جوهري على الأسطول المذكور أعلاه."),
      r("", ""),
      r("I declare that the information given in this declaration is true and complete to the best of my knowledge.",
        "أقر بأن المعلومات الواردة في هذا الإقرار صحيحة وكاملة على حد علمي."),
      r("Signed: Authorised Signatory", "التوقيع: المفوض بالتوقيع"),
      r(`Name: ${P1_EN}`, `الاسم: ${P1_AR}`),
      r("Date: 24/10/2026", "التاريخ: 24/10/2026"),
    ],
    foot: true,
  },
  {
    file: "11-operational-standards-self-declaration.pdf",
    titleEn: "OPERATIONAL STANDARDS SELF-DECLARATION",
    titleAr: "إقرار ذاتي بمعايير التشغيل",
    rows: [
      ...COMPANY_HEAD,
      r("", ""),
      r("We declare that our postal operations comply with the following:", "نقر بأن عملياتنا البريدية تلتزم بما يلي:"),
      r("  Electronic shipment tracking on all consignments: YES", "  تتبع إلكتروني لجميع الشحنات: نعم"),
      r("  Consignment notes issued for all shipments: YES", "  إصدار بوالص شحن لجميع الشحنات: نعم"),
      r("  Maximum single shipment weight: 30 kg", "  الوزن الأقصى للشحنة الواحدة: 30 كجم"),
      r("  Proof of delivery captured electronically: YES", "  إثبات التسليم إلكترونياً: نعم"),
      r("  Complaints procedure published and operated: YES", "  إجراءات الشكاوى منشورة ومُفعّلة: نعم"),
      r("  Customer data handled per UAE data protection law: YES", "  التعامل مع بيانات العملاء وفق قانون حماية البيانات الإماراتي: نعم"),
      r("  Prohibited and restricted items screening in place: YES", "  فحص المواد الممنوعة والمقيدة مطبّق: نعم"),
      r("", ""),
      r("Signed: Authorised Signatory", "التوقيع: المفوض بالتوقيع"),
      r("Date: 22/10/2026", "التاريخ: 22/10/2026"),
    ],
    foot: true,
  },
  {
    file: "12-sme-licence-federal-or-local-government.pdf",
    titleEn: "SME LICENCE",
    titleAr: "رخصة المنشآت الصغيرة والمتوسطة",
    rows: [
      r("Issuing Authority: Dubai SME (Mohammed Bin Rashid Establishment)", "الجهة المصدرة: مؤسسة محمد بن راشد لتنمية المشاريع الصغيرة والمتوسطة"),
      r("Government of Dubai", "حكومة دبي"),
      r("", ""),
      r("Licence Number: SME-2026-004567", "رقم الرخصة: SME-2026-004567"),
      r(`Company Name (EN): ${CO_EN}`, `اسم الشركة (عربي): ${CO_AR}`),
      r(`Trade Name: ${TRADE_EN}`, `الاسم التجاري: ${TRADE_AR}`),
      r(`Trade Licence: ${TL}`, `الرخصة التجارية: ${TL}`),
      r(`Legal Form: ${LLC_EN}`, `الشكل القانوني: ${LLC_AR}`),
      r("Issue Date: 01/01/2026", "تاريخ الإصدار: 01/01/2026"),
      r("Expiry Date: 31/12/2027", "تاريخ الانتهاء: 31/12/2027"),
      r("Emirate: Dubai", "الإمارة: دبي"),
      r(`Registered Address: ${ADDR_EN}`, `العنوان المسجل: ${ADDR_AR}`),
      r("Licence Category: Small and Medium Enterprise", "فئة الرخصة: منشأة صغيرة ومتوسطة"),
      r("Classification: Small Enterprise", "التصنيف: منشأة صغيرة"),
      r("Licensed Activities:", "الأنشطة المرخصة:"),
      r("  - Courier Services", "  - خدمات التوصيل السريع"),
      r("  - Transport and Logistics", "  - النقل والخدمات اللوجستية"),
      r(`Owner / Manager: ${P1_EN}`, `المالك / المدير: ${P1_AR}`),
      r("Emirates ID: 784-1990-7654321-0", "رقم الهوية الإماراتية: 784-1990-7654321-0"),
      r("Licence Status: Active", "حالة الرخصة: سارية"),
    ],
  },
  {
    file: "13-trade-licence-initial-name-approval.pdf",
    titleEn: "INITIAL APPROVAL AND TRADE NAME RESERVATION",
    titleAr: "الموافقة المبدئية وحجز الاسم التجاري",
    rows: [
      ...COMPANY_HEAD,
      r("", ""),
      r("Issuing Authority: Department of Economic Development - Dubai", "الجهة المصدرة: دائرة التنمية الاقتصادية — دبي"),
      r("Reference: INA-2026-0098765", "الرقم المرجعي: INA-2026-0098765"),
      r(`Reserved Trade Name (EN): ${TRADE_EN}`, `الاسم التجاري المحجوز (إنجليزي): ${TRADE_EN}`),
      r(`Reserved Trade Name (AR): ${TRADE_AR}`, `الاسم التجاري المحجوز (عربي): ${TRADE_AR}`),
      r("Activity: Courier Services, Mail and Parcel Delivery", "النشاط: خدمات التوصيل السريع، توصيل البريد والطرود"),
      r("Issue Date: 01/12/2025", "تاريخ الإصدار: 01/12/2025"),
      r("Valid Until: 31/12/2027", "صالح حتى: 31/12/2027"),
    ],
    foot: true,
  },
];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const lines = (s: string) => esc(s).replace(/\n/g, "<br>").replace(/^(\s+)/, (m) => "&nbsp;".repeat(m.length));

function html(d: Doc): string {
  const body = d.rows
    .map((row) => row.en === "" && row.ar === ""
      ? `<tr class="gap"><td></td><td></td></tr>`
      : `<tr><td class="en">${lines(row.en)}</td><td class="ar" dir="rtl" lang="ar">${lines(row.ar)}</td></tr>`)
    .join("\n");
  const tail = (d.tail ?? (d.foot ? [r(FOOT_EN, FOOT_AR)] : []))
    .map((t) => `<table class="note"><tr><td class="en">${lines(t.en)}</td><td class="ar" dir="rtl" lang="ar">${lines(t.ar)}</td></tr></table>`)
    .join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: A4; margin: 18mm 16mm; }
body { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; font-size: 10.5pt; color: #111; }
.ar, [lang="ar"] { font-family: "Geeza Pro", "Al Nile", "Baghdad", sans-serif; }
h1 { font-size: 13pt; margin: 0; text-align: center; line-height: 1.35; }
h1 .ar { display: block; font-size: 12.5pt; font-weight: 600; margin-top: 3mm; }
.banner { text-align: center; font-weight: 700; margin: 5mm 0 7mm; line-height: 1.5; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; }
td { vertical-align: top; padding: 1.1mm 0; line-height: 1.55; width: 50%; }
td.en { padding-inline-end: 6mm; }
td.ar { padding-inline-start: 6mm; text-align: right; }
tr.gap td { height: 3mm; }
hr { border: 0; border-top: 1px solid #bbb; margin: 6mm 0; }
.note { margin-top: 7mm; font-size: 9pt; color: #333; }
</style></head><body>
<h1>${lines(d.titleEn)}<span class="ar" dir="rtl" lang="ar">${lines(d.titleAr)}</span></h1>
<div class="banner">${esc(BANNER_EN)}<br><span class="ar" dir="rtl" lang="ar">${esc(BANNER_AR)}</span></div>
<hr>
<table>${body}</table>
${tail}
</body></html>`;
}

function main() {
  if (!existsSync(CHROME)) { console.error(`Chrome is not at ${CHROME} — it renders the Arabic, so this cannot run without it.`); process.exit(1); }
  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
  const work = mkdtempSync(join(tmpdir(), "epgl-pack-"));
  console.log(`out  : ${OUT}\nhtml : ${work}\n`);
  for (const d of DOCS) {
    const page = join(work, d.file.replace(/\.pdf$/, ".html"));
    writeFileSync(page, html(d), "utf8");
    /**
     * ITS OWN PROFILE, AND A CLOCK ON IT.
     *
     * Headless Chrome reaching for the signed-in profile contends with the
     * browser the person is using, and the seventh document in the run hung
     * there indefinitely with the first six already written. A throwaway
     * user-data-dir removes the contention; the timeout means a hang costs one
     * document and a clear message rather than the rest of the pack.
     */
    execFileSync(CHROME, [
      "--headless=new", "--disable-gpu", "--no-pdf-header-footer", "--no-first-run",
      `--user-data-dir=${join(work, "chrome", d.file)}`,
      "--virtual-time-budget=4000", `--print-to-pdf=${join(OUT, d.file)}`, `file://${page}`,
    ], { stdio: "ignore", timeout: 60_000 });
    console.log(`  ${d.file}`);
  }
  console.log(`\n${DOCS.length} documents written.`);
}

if (basename(process.argv[1] ?? "") === "epgl-test-pack-2026-10-28.ts") main();
export { DOCS, html, CO_AR, TRADE_AR, P1_AR, P2_AR };
