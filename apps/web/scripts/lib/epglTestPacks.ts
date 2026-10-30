/**
 * One test pack per kind of submission (30 October 2026).
 *
 * The 22 October pack is a single scenario — CEP30-UAE-SME-DOM, an LLC in
 * Dubai with two individual partners — and it is the only one anybody has ever
 * run end to end. Nine other products exist and four of them are not licences
 * at all but permits, with their own documents, their own fees and, for three
 * of them, an inspection after issuance. None of that has been exercised.
 *
 * THE CATALOGUE DECIDES WHAT IS IN A PACK, not this file. Each scenario names
 * a product code and the documents are read from EPGL's own catalogue for that
 * product, so a pack cannot quietly diverge from what the agent will ask for:
 * add a document to the catalogue and the pack is short of it, and the
 * generator says so by name rather than producing a pack that strands a
 * tester half way through.
 *
 * The documents themselves are rendered by the 28 October generator's `html`,
 * so every pack looks like the one testers have already seen and the Arabic
 * renders the same way.
 *
 * WHAT IS DELIBERATELY THE SAME IN EVERY PACK: the two partners, Ahmed Al
 * Mansoori and Sara Al Hashimi. One person may own several companies, so this
 * costs no realism, and it means a tester moving between packs is not learning
 * a new cast each time.
 *
 * WHAT IS DELIBERATELY DIFFERENT: the company and its trade licence number.
 * EPGL's duplicate check works on the company, so two packs sharing one would
 * have the second application refused as a duplicate of the first.
 */
export type Row = { en: string; ar: string };
export type Doc = { file: string; titleEn: string; titleAr: string; rows: Row[]; tail?: Row[]; foot?: boolean };
const r = (en: string, ar: string): Row => ({ en, ar });

/* ------------------------------------------------------------------------- *
 * The cast, which every pack shares.
 * ------------------------------------------------------------------------- */
const P1_EN = "Ahmed Al Mansoori";
const P1_AR = "أحمد المنصوري";
const P1_EID = "784-1990-7654321-0";
const P1_PASSPORT = "A1234567";
const P2_EN = "Sara Al Hashimi";
const P2_AR = "سارة الهاشمي";
const P2_EID = "784-1992-1234567-3";
const P2_PASSPORT = "B7654321";
const UAE_EN = "United Arab Emirates";
const UAE_AR = "الإمارات العربية المتحدة";
const LLC_EN = "Limited Liability Company (LLC)";
const LLC_AR = "شركة ذات مسؤولية محدودة (ش.ذ.م.م)";
const FOOT_EN =
  "Generated for integration testing of the EPGL assistant against the Salesforce NewLaw sandbox. Not a real document; must not be processed.";
const FOOT_AR =
  "أُنشئت لاختبار تكامل مساعد ترخيص مجموعة بريد الإمارات مع بيئة Salesforce التجريبية. ليست وثيقة حقيقية ولا يجوز معالجتها.";

/** The company a pack applies as. One per pack, so no two collide on duplicate-check. */
export interface Company {
  en: string;
  ar: string;
  tradeEn: string;
  tradeAr: string;
  tl: string;
  addrEn: string;
  addrAr: string;
  emirate: string;
  emirateAr: string;
  /** What the licence says the company does, which differs by product. */
  activityEn: string[];
  activityAr: string[];
}

/* ------------------------------------------------------------------------- *
 * The documents, keyed by EPGL's own `documentType`.
 *
 * Every builder takes the company, so one definition serves every pack. A type
 * with no builder here is a type no pack can contain -- the generator refuses
 * rather than shipping a pack that is short of a document.
 * ------------------------------------------------------------------------- */

const head = (c: Company): Row[] => [
  r(`Company: ${c.en}`, `الشركة: ${c.ar}`),
  r(`Trade Licence: ${c.tl}`, `الرخصة التجارية: ${c.tl}`),
];

const person = (nameEn: string, nameAr: string, eid: string, passport: string): Row[] => [
  r(`Full Name: ${nameEn}`, `الاسم الكامل: ${nameAr}`),
  r(`Emirates ID: ${eid}`, `رقم الهوية الإماراتية: ${eid}`),
  r(`Passport Number: ${passport}`, `رقم جواز السفر: ${passport}`),
  r(`Nationality: ${UAE_EN}`, `الجنسية: ${UAE_AR}`),
  r("Date of Birth: 01/01/1990", "تاريخ الميلاد: 01/01/1990"),
  r("Date of Issue: 01/01/2024", "تاريخ الإصدار: 01/01/2024"),
  r("Date of Expiry: 01/01/2034", "تاريخ الانتهاء: 01/01/2034"),
  r("Place of Issue: Dubai, UAE", "مكان الإصدار: دبي، الإمارات العربية المتحدة"),
];

const signoff = (date: string): Row[] => [
  r("", ""),
  r("Signed: Authorised Signatory", "التوقيع: المفوض بالتوقيع"),
  r(`Name: ${P1_EN}`, `الاسم: ${P1_AR}`),
  r(`Date: ${date}`, `التاريخ: ${date}`),
];

type Builder = (c: Company) => Omit<Doc, "file">;

/**
 * Keyed on EPGL's `documentType` exactly as their catalogue spells it, because
 * that string is also what their checklist matches on. A rename on their side
 * should break the generator loudly, not produce a pack quietly missing a file.
 */
export const BUILDERS: Record<string, Builder> = {
  "Trade Licence": (c) => ({
    titleEn: `DEPARTMENT OF ECONOMIC DEVELOPMENT - ${c.emirate.toUpperCase()}\nCOMMERCIAL TRADE LICENCE`,
    titleAr: `دائرة التنمية الاقتصادية — ${c.emirateAr}\nالرخصة التجارية`,
    rows: [
      r(`Licence Number: ${c.tl}`, `رقم الرخصة: ${c.tl}`),
      r(`Company Name (EN): ${c.en}`, `اسم الشركة (إنجليزي): ${c.en}`),
      r(`Company Name (AR): ${c.ar}`, `اسم الشركة (عربي): ${c.ar}`),
      r(`Trade Name: ${c.tradeEn}`, `الاسم التجاري: ${c.tradeAr}`),
      r(`Legal Form: ${LLC_EN}`, `الشكل القانوني: ${LLC_AR}`),
      r("Issue Date: 01/01/2026", "تاريخ الإصدار: 01/01/2026"),
      r("Expiry Date: 31/12/2027", "تاريخ الانتهاء: 31/12/2027"),
      r(`Emirate: ${c.emirate}`, `الإمارة: ${c.emirateAr}`),
      r(`Registered Address: ${c.addrEn}`, `العنوان المسجل: ${c.addrAr}`),
      r("P.O. Box: 50500", "صندوق البريد: 50500"),
      r("Telephone: 00971553708434", "الهاتف: 00971553708434"),
      r("Email: noreply@7x.ae", "البريد الإلكتروني: noreply@7x.ae"),
      r("Licensed Activities:", "الأنشطة المرخصة:"),
      ...c.activityEn.map((a, i) => r(`  - ${a}`, `  - ${c.activityAr[i] ?? a}`)),
      r(`Owner / Manager: ${P1_EN}`, `المالك / المدير: ${P1_AR}`),
      r(`Emirates ID: ${P1_EID}`, `رقم الهوية الإماراتية: ${P1_EID}`),
      r(`Nationality: ${UAE_EN}`, `الجنسية: ${UAE_AR}`),
    ],
    foot: true,
  }),

  "Trade Licence / Initial Name Approval": (c) => ({
    titleEn: "INITIAL APPROVAL AND TRADE NAME RESERVATION",
    titleAr: "الموافقة المبدئية وحجز الاسم التجاري",
    rows: [
      ...head(c),
      r("", ""),
      r(`Issuing Authority: Department of Economic Development - ${c.emirate}`, `الجهة المصدرة: دائرة التنمية الاقتصادية — ${c.emirateAr}`),
      r("Reference: INA-2026-0098765", "الرقم المرجعي: INA-2026-0098765"),
      r(`Reserved Trade Name (EN): ${c.tradeEn}`, `الاسم التجاري المحجوز (إنجليزي): ${c.tradeEn}`),
      r(`Reserved Trade Name (AR): ${c.tradeAr}`, `الاسم التجاري المحجوز (عربي): ${c.tradeAr}`),
      r(`Activity: ${c.activityEn.join(", ")}`, `النشاط: ${c.activityAr.join("، ")}`),
      r("Issue Date: 01/12/2025", "تاريخ الإصدار: 01/12/2025"),
      r("Valid Until: 31/12/2027", "صالح حتى: 31/12/2027"),
    ],
    foot: true,
  }),

  "Memorandum of Association": (c) => ({
    titleEn: "MEMORANDUM OF ASSOCIATION",
    titleAr: "عقد التأسيس",
    rows: [
      ...head(c),
      r(`Legal Form: ${LLC_EN}`, `الشكل القانوني: ${LLC_AR}`),
      r("Share Capital: AED 300,000", "رأس المال: 300,000 درهم إماراتي"),
      r("", ""),
      r("Partners:", "الشركاء:"),
      r(`  ${P1_EN} - ${P1_EID} - UAE - 51%`, `  ${P1_AR} - ${P1_EID} - الإمارات - 51%`),
      r(`  ${P2_EN}   - ${P2_EID} - UAE - 49%`, `  ${P2_AR} - ${P2_EID} - الإمارات - 49%`),
      r("", ""),
      r(`Manager: ${P1_EN}`, `المدير: ${P1_AR}`),
      r(`Registered Office: ${c.addrEn}`, `المكتب المسجل: ${c.addrAr}`),
      r("Date of Incorporation: 01/01/2026", "تاريخ التأسيس: 01/01/2026"),
    ],
    foot: true,
  }),

  "Copy of Passport": () => ({
    titleEn: "PASSPORT",
    titleAr: "جواز سفر",
    rows: person(P1_EN, P1_AR, P1_EID, P1_PASSPORT),
    foot: true,
  }),

  "Copy of Emirates ID": () => ({
    titleEn: "EMIRATES ID CARD",
    titleAr: "بطاقة الهوية الإماراتية",
    rows: person(P1_EN, P1_AR, P1_EID, P1_PASSPORT),
    foot: true,
  }),

  "Beneficial Ownership Declaration": (c) => ({
    titleEn: "BENEFICIAL OWNERSHIP DECLARATION",
    titleAr: "إقرار الملكية النفعية",
    rows: [
      ...head(c),
      r("", ""),
      r("Beneficial Owners:", "المالكون المنتفعون:"),
      r(`  ${P1_EN} - ${P1_EID} - UAE - 51%`, `  ${P1_AR} - ${P1_EID} - الإمارات - 51%`),
      r("  Basis: Direct ownership (25% or more)", "  الأساس: ملكية مباشرة (25% أو أكثر)"),
      r(`  ${P2_EN} - ${P2_EID} - UAE - 49%`, `  ${P2_AR} - ${P2_EID} - الإمارات - 49%`),
      r("  Basis: Direct ownership (25% or more)", "  الأساس: ملكية مباشرة (25% أو أكثر)"),
      r("", ""),
      r("We declare the above to be accurate and complete.", "نقر بأن ما ورد أعلاه صحيح وكامل."),
      ...signoff("30/10/2026"),
    ],
    foot: true,
  }),

  "Lease Contract": (c) => ({
    titleEn: "EJARI TENANCY CONTRACT",
    titleAr: "عقد إيجار — إيجاري",
    rows: [
      ...head(c),
      r("", ""),
      r("Ejari Contract Number: EJ-2026-0012345", "رقم عقد إيجاري: EJ-2026-0012345"),
      r(`Premises: ${c.addrEn}`, `العقار: ${c.addrAr}`),
      r("Premises Type: Commercial Office", "نوع العقار: مكتب تجاري"),
      r("Area: 120 sq m", "المساحة: 120 متر مربع"),
      r("Landlord: Test Tower Properties LLC", "المالك: شركة برج تست العقارية ذ.م.م"),
      r(`Tenant: ${c.en}`, `المستأجر: ${c.ar}`),
      r("Contract Period: 01/01/2026 to 31/12/2027", "مدة العقد: من 01/01/2026 إلى 31/12/2027"),
      r("Expiry Date: 31/12/2027", "تاريخ الانتهاء: 31/12/2027"),
      r("Annual Rent: AED 120,000", "الإيجار السنوي: 120,000 درهم إماراتي"),
    ],
  }),

  "Insurance Certificate (goods in transit)": (c) => ({
    titleEn: "CERTIFICATE OF INSURANCE - GOODS IN TRANSIT",
    titleAr: "شهادة تأمين — البضائع أثناء النقل",
    rows: [
      ...head(c),
      r("", ""),
      r("Policy Number: GIT-7X-2026-0001", "رقم وثيقة التأمين: GIT-7X-2026-0001"),
      r(`Insured: ${c.en}`, `المؤمَّن له: ${c.ar}`),
      r("Insurer: Test Insurance Company PJSC", "شركة التأمين: شركة التأمين التجريبية ش.م.ع"),
      r("Cover: Goods in Transit / Carrier's Liability", "التغطية: البضائع أثناء النقل / مسؤولية الناقل"),
      r("Sum Insured: AED 500,000 any one consignment", "مبلغ التأمين: 500,000 درهم إماراتي لكل شحنة"),
      r(`Territorial Limit: ${UAE_EN}`, `النطاق الجغرافي: ${UAE_AR}`),
      r("Period of Insurance: 01/01/2026 to 31/12/2027", "فترة التأمين: من 01/01/2026 إلى 31/12/2027"),
      r("Expiry Date: 31/12/2027", "تاريخ الانتهاء: 31/12/2027"),
    ],
  }),

  "Operational Fleet Declaration": (c) => ({
    titleEn: "DECLARATION AND UNDERTAKING - OPERATIONAL FLEET",
    titleAr: "إقرار وتعهد — الأسطول التشغيلي",
    rows: [
      ...head(c),
      r("", ""),
      r("1. We declare that the company operates a total of 5 vehicles for postal and courier activities, comprising:",
        "1. نقر بأن الشركة تُشغّل ما مجموعه 5 مركبات لأنشطة البريد والتوصيل السريع، وهي:"),
      r("   3 x Light Commercial Van (up to 1,500 kg payload)", "   3 مركبات نقل خفيفة (حمولة تصل إلى 1,500 كجم)"),
      r("   2 x Motorcycle (documents and small parcels)", "   2 دراجة نارية (وثائق وطرود صغيرة)"),
      r("2. All vehicles are registered in the United Arab Emirates and insured for commercial use.",
        "2. جميع المركبات مسجلة في الإمارات العربية المتحدة ومؤمّنة للاستخدام التجاري."),
      r("3. All drivers hold valid UAE driving licences.", "3. جميع السائقين يحملون رخص قيادة إماراتية سارية."),
      r("4. The maximum single shipment weight handled will not exceed 30 kg.",
        "4. لن يتجاوز الوزن الأقصى للشحنة الواحدة 30 كجم."),
      ...signoff("30/10/2026"),
    ],
    foot: true,
  }),

  "Operational Standards Self-declaration": (c) => ({
    titleEn: "OPERATIONAL STANDARDS SELF-DECLARATION",
    titleAr: "إقرار ذاتي بمعايير التشغيل",
    rows: [
      ...head(c),
      r("", ""),
      r("We declare that our postal operations comply with the following:", "نقر بأن عملياتنا البريدية تلتزم بما يلي:"),
      r("  Electronic shipment tracking on all consignments: YES", "  تتبع إلكتروني لجميع الشحنات: نعم"),
      r("  Consignment notes issued for all shipments: YES", "  إصدار بوالص شحن لجميع الشحنات: نعم"),
      r("  Maximum single shipment weight: 30 kg", "  الوزن الأقصى للشحنة الواحدة: 30 كجم"),
      r("  Proof of delivery captured electronically: YES", "  إثبات التسليم إلكترونياً: نعم"),
      r("  Complaints procedure published and operated: YES", "  إجراءات الشكاوى منشورة ومُفعّلة: نعم"),
      r("  Customer data handled per UAE data protection law: YES", "  التعامل مع بيانات العملاء وفق قانون حماية البيانات الإماراتي: نعم"),
      ...signoff("30/10/2026"),
    ],
    foot: true,
  }),

  "SME Licence (federal or local government)": (c) => ({
    titleEn: "SME LICENCE",
    titleAr: "رخصة المنشآت الصغيرة والمتوسطة",
    rows: [
      r("Issuing Authority: Dubai SME (Mohammed Bin Rashid Establishment)", "الجهة المصدرة: مؤسسة محمد بن راشد لتنمية المشاريع الصغيرة والمتوسطة"),
      r("Government of Dubai", "حكومة دبي"),
      r("", ""),
      r("Licence Number: SME-2026-004567", "رقم الرخصة: SME-2026-004567"),
      r(`Company Name (EN): ${c.en}`, `اسم الشركة (عربي): ${c.ar}`),
      r(`Trade Licence: ${c.tl}`, `الرخصة التجارية: ${c.tl}`),
      r("Issue Date: 01/01/2026", "تاريخ الإصدار: 01/01/2026"),
      r("Expiry Date: 31/12/2027", "تاريخ الانتهاء: 31/12/2027"),
      r("Licence Category: Small and Medium Enterprise", "فئة الرخصة: منشأة صغيرة ومتوسطة"),
      r("Classification: Small Enterprise", "التصنيف: منشأة صغيرة"),
      r("Licence Status: Active", "حالة الرخصة: سارية"),
    ],
  }),

  /* ---- FOODMED ---------------------------------------------------------- */

  "Municipal Food Safety Clearance": (c) => ({
    titleEn: "FOOD SAFETY CLEARANCE CERTIFICATE",
    titleAr: "شهادة تصريح سلامة الغذاء",
    rows: [
      r(`Issuing Authority: ${c.emirate} Municipality - Food Safety Department`, `الجهة المصدرة: بلدية ${c.emirateAr} — إدارة سلامة الغذاء`),
      r("", ""),
      r("Certificate Number: FSC-2026-0003344", "رقم الشهادة: FSC-2026-0003344"),
      r(`Establishment: ${c.en}`, `المنشأة: ${c.ar}`),
      r(`Trade Licence: ${c.tl}`, `الرخصة التجارية: ${c.tl}`),
      r(`Premises: ${c.addrEn}`, `العقار: ${c.addrAr}`),
      r("Activity Cleared: Transport and delivery of foodstuffs", "النشاط المصرّح به: نقل وتوصيل المواد الغذائية"),
      r("Inspection Date: 15/09/2026", "تاريخ التفتيش: 15/09/2026"),
      r("Inspection Result: Compliant - Grade A", "نتيجة التفتيش: مطابق — الدرجة أ"),
      r("Issue Date: 01/10/2026", "تاريخ الإصدار: 01/10/2026"),
      r("Expiry Date: 30/09/2027", "تاريخ الانتهاء: 30/09/2027"),
      r("Status: Valid", "الحالة: سارية"),
    ],
    foot: true,
  }),

  "Pharmaceutical Handling Authorisation": (c) => ({
    titleEn: "PHARMACEUTICAL HANDLING AUTHORISATION",
    titleAr: "تصريح التعامل مع المستحضرات الدوائية",
    rows: [
      r("Issuing Authority: Ministry of Health and Prevention (MOHAP)", "الجهة المصدرة: وزارة الصحة ووقاية المجتمع"),
      r("", ""),
      r("Authorisation Number: PHA-2026-0007788", "رقم التصريح: PHA-2026-0007788"),
      r(`Authorised Entity: ${c.en}`, `الجهة المصرّح لها: ${c.ar}`),
      r(`Trade Licence: ${c.tl}`, `الرخصة التجارية: ${c.tl}`),
      r("Scope: Transport and last-mile delivery of registered pharmaceutical products",
        "النطاق: نقل وتوصيل المستحضرات الدوائية المسجلة"),
      r("Temperature Range Authorised: +2°C to +8°C and +15°C to +25°C",
        "نطاق الحرارة المصرّح به: من +2 إلى +8 ومن +15 إلى +25 درجة مئوية"),
      r("Responsible Pharmacist: Dr. Layla Al Suwaidi", "الصيدلانية المسؤولة: د. ليلى السويدي"),
      r("Issue Date: 01/10/2026", "تاريخ الإصدار: 01/10/2026"),
      r("Expiry Date: 30/09/2027", "تاريخ الانتهاء: 30/09/2027"),
    ],
    foot: true,
  }),

  "Cold-chain Capability Declaration": (c) => ({
    titleEn: "COLD-CHAIN CAPABILITY DECLARATION",
    titleAr: "إقرار القدرة على سلسلة التبريد",
    rows: [
      ...head(c),
      r("", ""),
      r("We declare that the company maintains the following cold-chain capability:",
        "نقر بأن الشركة تحافظ على القدرات التالية لسلسلة التبريد:"),
      r("  Refrigerated vehicles in service: 2", "  مركبات مبرّدة في الخدمة: 2"),
      r("  Temperature range maintained: +2°C to +8°C", "  نطاق الحرارة المحافظ عليه: من +2 إلى +8 درجات مئوية"),
      r("  Continuous temperature logging on every consignment: YES", "  تسجيل مستمر لدرجة الحرارة لكل شحنة: نعم"),
      r("  Calibration of temperature probes: every 6 months", "  معايرة مجسات الحرارة: كل 6 أشهر"),
      r("  Excursion alarm and escalation procedure in place: YES", "  إنذار التجاوز وإجراءات التصعيد مطبّقة: نعم"),
      r("  Validated insulated packaging for pharmaceutical shipments: YES", "  تغليف معزول معتمد للشحنات الدوائية: نعم"),
      ...signoff("30/10/2026"),
    ],
    foot: true,
  }),

  "Storage Premises Declaration": (c) => ({
    titleEn: "STORAGE PREMISES DECLARATION",
    titleAr: "إقرار مواقع التخزين",
    rows: [
      ...head(c),
      r("", ""),
      r("We declare the following storage premises are used for the declared activity:",
        "نقر بأن مواقع التخزين التالية تُستخدم للنشاط المعلن:"),
      r(`  Site 1: ${c.addrEn}`, `  الموقع 1: ${c.addrAr}`),
      r("    Area: 240 sq m    Type: Ambient and chilled storage", "    المساحة: 240 متر مربع    النوع: تخزين عادي ومبرّد"),
      r("  Site 2: Warehouse 14, Al Quoz Industrial 3, Dubai, UAE", "  الموقع 2: مستودع 14، القوز الصناعية 3، دبي، الإمارات"),
      r("    Area: 600 sq m    Type: Ambient storage and sortation", "    المساحة: 600 متر مربع    النوع: تخزين عادي وفرز"),
      r("  Separation of foodstuffs from non-food consignments: YES", "  فصل المواد الغذائية عن الشحنات غير الغذائية: نعم"),
      r("  Pest control contract in place: YES", "  عقد مكافحة الآفات مبرم: نعم"),
      ...signoff("30/10/2026"),
    ],
    foot: true,
  }),

  /* ---- INTERMED --------------------------------------------------------- */

  "Intermediation Model Declaration": (c) => ({
    titleEn: "INTERMEDIATION MODEL DECLARATION",
    titleAr: "إقرار نموذج الوساطة",
    rows: [
      ...head(c),
      r("", ""),
      r("Platform Name: 7X TEST DELIVER", "اسم المنصة: 7X TEST DELIVER"),
      r("Model: Electronic platform matching senders with licensed postal operators",
        "النموذج: منصة إلكترونية تربط المرسلين بمشغّلي البريد المرخّصين"),
      r("  The company does not itself carry or deliver consignments: CONFIRMED",
        "  الشركة لا تنقل أو توصّل الشحنات بنفسها: مؤكد"),
      r("  All fulfilling operators hold a valid EPGL postal licence: CONFIRMED",
        "  جميع المشغّلين المنفّذين يحملون رخصة بريدية سارية: مؤكد"),
      r("  Operator licence numbers verified before onboarding: YES", "  التحقق من أرقام رخص المشغّلين قبل التعاقد: نعم"),
      r("  Commission model: percentage of shipment value", "  نموذج العمولة: نسبة من قيمة الشحنة"),
      r("  Consignments intermediated per month (estimate): 4,000", "  الشحنات الموسّطة شهرياً (تقديري): 4,000"),
      r("  Complaints routed to the fulfilling operator and tracked: YES", "  إحالة الشكاوى إلى المشغّل المنفّذ ومتابعتها: نعم"),
      ...signoff("30/10/2026"),
    ],
    foot: true,
  }),

  "Data Handling Declaration": (c) => ({
    titleEn: "DATA HANDLING DECLARATION",
    titleAr: "إقرار التعامل مع البيانات",
    rows: [
      ...head(c),
      r("", ""),
      r("We declare the following in respect of personal data processed by the platform:",
        "نقر بما يلي بشأن البيانات الشخصية التي تعالجها المنصة:"),
      r("  Processing is governed by UAE Federal Decree-Law No. 45 of 2021 (PDPL): CONFIRMED",
        "  المعالجة تخضع للمرسوم بقانون اتحادي رقم 45 لسنة 2021: مؤكد"),
      r("  Data residency: all personal data stored within the United Arab Emirates",
        "  مكان حفظ البيانات: جميع البيانات الشخصية محفوظة داخل الإمارات"),
      r("  Retention: sender and recipient details retained 5 years, then purged",
        "  مدة الاحتفاظ: بيانات المرسل والمستلم 5 سنوات ثم تُحذف"),
      r("  Encryption in transit (TLS 1.2 or above) and at rest: YES", "  التشفير أثناء النقل وعند التخزين: نعم"),
      r("  Sub-processors disclosed and contractually bound: YES", "  الإفصاح عن المعالجين الفرعيين والتزامهم تعاقدياً: نعم"),
      r("  Data Protection Officer appointed: Dr. Layla Al Suwaidi", "  مسؤول حماية البيانات: د. ليلى السويدي"),
      ...signoff("30/10/2026"),
    ],
    foot: true,
  }),

  "Operator Contracts (sample)": (c) => ({
    titleEn: "SAMPLE OPERATOR AGREEMENT",
    titleAr: "نموذج اتفاقية مشغّل",
    rows: [
      r(`Between: ${c.en} ("the Platform")`, `بين: ${c.ar} ("المنصة")`),
      r('And: TEST LAST MILE COURIER L.L.C ("the Operator")', 'و: شركة تست للتوصيل النهائي ذ.م.م ("المشغّل")'),
      r("", ""),
      r("Agreement Reference: OPA-2026-0021", "الرقم المرجعي للاتفاقية: OPA-2026-0021"),
      r("Operator EPGL Postal Licence: PL-2026-0456", "الرخصة البريدية للمشغّل: PL-2026-0456"),
      r("Term: 01/01/2026 to 31/12/2027", "المدة: من 01/01/2026 إلى 31/12/2027"),
      r("", ""),
      r("1. The Operator carries and delivers consignments allocated through the Platform.",
        "1. يقوم المشغّل بنقل وتوصيل الشحنات المخصصة عبر المنصة."),
      r("2. The Operator warrants it holds a valid EPGL postal licence throughout the term.",
        "2. يضمن المشغّل حمله رخصة بريدية سارية طوال المدة."),
      r("3. Liability for loss or damage in transit rests with the Operator.",
        "3. تقع مسؤولية الفقد أو التلف أثناء النقل على المشغّل."),
      r("4. The Platform remits the agreed share within 30 days of month end.",
        "4. تحوّل المنصة الحصة المتفق عليها خلال 30 يوماً من نهاية الشهر."),
      ...signoff("30/10/2026"),
    ],
    foot: true,
  }),

  /* ---- LOCKERS ---------------------------------------------------------- */

  "Locker / PUDO Site Locations and Contracts": (c) => ({
    titleEn: "LOCKER AND PUDO SITE SCHEDULE",
    titleAr: "جدول مواقع الخزائن ونقاط الاستلام والتسليم",
    rows: [
      ...head(c),
      r("", ""),
      r("Declared sites in operation: 4", "المواقع المعلنة قيد التشغيل: 4"),
      r("", ""),
      r("  Site 1: Test Tower lobby, Business Bay, Dubai", "  الموقع 1: بهو برج تست، الخليج التجاري، دبي"),
      r("    Type: Electronic locker bank (24 compartments)   Access: 24/7", "    النوع: خزائن إلكترونية (24 خانة)   الدخول: 24/7"),
      r("    Site agreement: SA-2026-001, 01/01/2026 to 31/12/2027", "    اتفاقية الموقع: SA-2026-001، من 01/01/2026 إلى 31/12/2027"),
      r("  Site 2: Al Quoz Mall, ground floor, Dubai", "  الموقع 2: مركز القوز التجاري، الطابق الأرضي، دبي"),
      r("    Type: Electronic locker bank (36 compartments)   Access: mall hours", "    النوع: خزائن إلكترونية (36 خانة)   الدخول: ساعات عمل المركز"),
      r("  Site 3: Test Grocery, Al Barsha, Dubai", "  الموقع 3: بقالة تست، البرشاء، دبي"),
      r("    Type: Staffed PUDO counter   Access: 08:00-22:00", "    النوع: نقطة استلام وتسليم بموظف   الدخول: 08:00–22:00"),
      r("  Site 4: Test Petrol Station, Sheikh Zayed Road, Dubai", "  الموقع 4: محطة وقود تست، شارع الشيخ زايد، دبي"),
      r("    Type: Staffed PUDO counter   Access: 24/7", "    النوع: نقطة استلام وتسليم بموظف   الدخول: 24/7"),
      r("", ""),
      r("  Consignment held at site for a maximum of 5 days before return: CONFIRMED",
        "  الاحتفاظ بالشحنة في الموقع 5 أيام كحد أقصى قبل الإرجاع: مؤكد"),
      r("  Recipient notified by SMS on deposit and on each reminder: YES", "  إشعار المستلم برسالة نصية عند الإيداع وعند كل تذكير: نعم"),
      ...signoff("30/10/2026"),
    ],
    foot: true,
  }),

  /* ---- OUTSOURCE -------------------------------------------------------- */

  "Principal Licensee Contract": (c) => ({
    titleEn: "PRINCIPAL LICENSEE CONTRACT",
    titleAr: "عقد الجهة المرخّصة الأصلية",
    rows: [
      r('Between: EMIRATES POST GROUP ("the Principal Licensee")', 'بين: مجموعة بريد الإمارات ("الجهة المرخّصة الأصلية")'),
      r(`And: ${c.en} ("the Service Provider")`, `و: ${c.ar} ("مزوّد الخدمة")`),
      r("", ""),
      r("Contract Reference: OSC-2026-0099", "الرقم المرجعي للعقد: OSC-2026-0099"),
      r(`Service Provider Trade Licence: ${c.tl}`, `الرخصة التجارية لمزوّد الخدمة: ${c.tl}`),
      r("Term: 01/01/2026 to 31/12/2027", "المدة: من 01/01/2026 إلى 31/12/2027"),
      r("", ""),
      r("1. The Service Provider performs outsourced postal operations on behalf of the Principal Licensee.",
        "1. يؤدي مزوّد الخدمة عمليات بريدية مُسندة نيابة عن الجهة المرخّصة الأصلية."),
      r("2. The Service Provider does not hold postal rights in its own name.",
        "2. لا يحمل مزوّد الخدمة حقوقاً بريدية باسمه."),
      r("3. Settlement is 10% of revenue from outsourced services, assessed every six months.",
        "3. التسوية 10% من إيرادات الخدمات المُسندة، تُحتسب كل ستة أشهر."),
      r("4. The Principal Licensee remains accountable to the regulator for service standards.",
        "4. تبقى الجهة المرخّصة الأصلية مسؤولة أمام الجهة التنظيمية عن معايير الخدمة."),
      ...signoff("30/10/2026"),
    ],
    foot: true,
  }),

  "Liability and Indemnity Declaration": (c) => ({
    titleEn: "LIABILITY AND INDEMNITY DECLARATION",
    titleAr: "إقرار المسؤولية والتعويض",
    rows: [
      ...head(c),
      r("", ""),
      r("In respect of outsourced postal operations, we declare and undertake:",
        "بشأن العمليات البريدية المُسندة، نقر ونتعهد بما يلي:"),
      r("  1. We accept liability for loss, damage or delay caused by our own acts or omissions.",
        "  1. نقبل المسؤولية عن الفقد أو التلف أو التأخير الناتج عن أفعالنا أو إغفالنا."),
      r("  2. We indemnify the Principal Licensee against third-party claims arising from our performance.",
        "  2. نعوّض الجهة المرخّصة الأصلية عن مطالبات الغير الناشئة عن أدائنا."),
      r("  3. Public liability cover in force: AED 1,000,000", "  3. تغطية المسؤولية العامة السارية: 1,000,000 درهم إماراتي"),
      r("  4. We will not sub-contract any part of the service without prior written consent.",
        "  4. لن نتعاقد من الباطن على أي جزء من الخدمة دون موافقة خطية مسبقة."),
      ...signoff("30/10/2026"),
    ],
    foot: true,
  }),
};

/* ------------------------------------------------------------------------- *
 * The journey's own partner slots.
 *
 * `partner_1_passport` and `partner_1_emirates_id` now carry EPGL's own
 * document types -- they absorbed the catalogue twins on 29 October -- so
 * partner 1 is covered by "Copy of Passport" and "Copy of Emirates ID" above.
 * Partner 2's two slots are ours alone, exist because the MOA names two
 * partners, and are in every pack for that reason.
 * ------------------------------------------------------------------------- */
export const PARTNER2_DOCS: Doc[] = [
  { file: "partner2-passport.pdf", titleEn: "PASSPORT", titleAr: "جواز سفر", rows: person(P2_EN, P2_AR, P2_EID, P2_PASSPORT), foot: true },
  { file: "partner2-emirates-id.pdf", titleEn: "EMIRATES ID CARD", titleAr: "بطاقة الهوية الإماراتية", rows: person(P2_EN, P2_AR, P2_EID, P2_PASSPORT), foot: true },
];

/* ------------------------------------------------------------------------- *
 * The scenarios.
 * ------------------------------------------------------------------------- */

export interface Scenario {
  /** The folder it is written into, which is also how a tester refers to it. */
  dir: string;
  /** EPGL's product code. The documents are read from the catalogue for THIS. */
  code: string;
  /** One line on what this pack is for, for the index. */
  purpose: string;
  company: Company;
  /** What the tester says to pick the product, in their own words. */
  describeSelf: string;
  /** The operating answers, which differ by product. */
  answers: string[];
  /** Product-specific things to watch, beyond the ones every pack shares. */
  watch: string[];
  /** Conditional documents only appear when these are declared. */
  declares?: string[];
}

const co = (
  suffix: string,
  tl: string,
  tradeEn: string,
  tradeAr: string,
  activityEn: string[],
  activityAr: string[]
): Company => ({
  en: `7X TEST - DO NOT PROCESS - ${suffix}`,
  ar: `اختبار 7X - لا تقم بالمعالجة - ${suffix}`,
  tradeEn,
  tradeAr,
  tl,
  addrEn: "Office 101, Test Tower, Business Bay, Dubai, UAE",
  addrAr: "مكتب 101، برج تست، الخليج التجاري، دبي، الإمارات العربية المتحدة",
  emirate: "Dubai",
  emirateAr: "دبي",
  activityEn,
  activityAr,
});

export const SCENARIOS: Scenario[] = [
  {
    dir: "02-cep30-general-international",
    code: "CEP30-GEN-INTL",
    purpose:
      "The most expensive product, and the only one whose fee is above the online payment limit. Run this to find out what the assistant does when it cannot take the money.",
    company: co("20261030B", "CN-2234567", "7X TEST GLOBAL EXPRESS", "7X تست جلوبال اكسبريس",
      ["Courier Services", "International Mail and Parcel Delivery"],
      ["خدمات التوصيل السريع", "توصيل البريد والطرود الدولية"]),
    describeSelf:
      "I run a courier company, not SME and not UAE-national-owned, shipping domestically and internationally, parcels up to 30 kg.",
    answers: [
      "Maximum shipment weight 30 kg. Yes to electronic tracking, yes to consignment notes.",
      "No food delivery, no medicine delivery, no cold chain. Fleet of 12 vehicles. Insurance AED 2,000,000.",
      "No intermediation, no outsourcing. Data handling confirmed.",
    ],
    watch: [
      "**There is no SME licence in this pack, and it should not ask for one.** The four SME products need one; the two General ones do not. If it asks, that is the thing to report.",
      "**The fee should be AED 40,000, and the card should NOT open.** EPGL's online limit is AED 20,000, so this one has to be arranged by Emirates Post instead. If a card opens for AED 40,000, stop and tell Emre — that is the single most important thing on this page.",
      "**Worth a second run on the other General product.** Say *domestic only* instead and you get CEP30-GEN-DOM at AED 20,000 — exactly the limit, not above it — which should pay by card normally. Same documents, so the same pack works. If one of those two behaves like the other, that is the bug.",
    ],
  },
  {
    dir: "03-foodmed-food-and-medicine",
    code: "FOODMED",
    purpose:
      "A permit, not a licence, with documents that only appear once you say you deliver food or medicine — and an inspection after it is issued.",
    company: co("20261030C", "CN-3234567", "7X TEST FRESH AND PHARMA", "7X تست فريش آند فارما",
      ["Transport of Foodstuffs", "Transport of Pharmaceutical Products"],
      ["نقل المواد الغذائية", "نقل المستحضرات الدوائية"]),
    describeSelf: "I deliver food and medicine, and I want the permit for that.",
    answers: [
      "Yes to food delivery, yes to medicine delivery, yes to cold chain.",
      "Two refrigerated vehicles, temperature range 2 to 8 degrees. Yes to electronic tracking.",
      "Data handling confirmed.",
    ],
    declares: ["food delivery", "medicine delivery"],
    watch: [
      "**Say yes to BOTH food and medicine.** Three of the documents in this pack only get asked for once you do: the food safety clearance appears when you declare food, and the pharmaceutical authorisation and the cold-chain declaration when you declare medicine. If you say no to one of them and it still asks, or you say yes and it does not, that is the thing to report.",
      "**It should tell you before you pay that this permit is issued conditionally** and that a physical inspection follows. If it describes approval as final, report that.",
      "**No lease contract, no insurance certificate, no fleet declaration, no SME licence.** None of those belong to this permit. If it asks for any of them, that is the bug.",
      "**The fee should be AED 500** — the cheapest of the ten.",
    ],
  },
  {
    dir: "04-intermed-platform",
    code: "INTERMED",
    purpose:
      "The platform permit, for a company that matches senders with licensed couriers and carries nothing itself. Conditional, with a desk verification rather than a site visit.",
    company: co("20261030D", "CN-4234567", "7X TEST DELIVER", "7X تست ديليفر",
      ["Electronic Platform Services", "Intermediation of Delivery Services"],
      ["خدمات المنصات الإلكترونية", "وساطة خدمات التوصيل"]),
    describeSelf:
      "I run an app that matches senders with licensed delivery companies. We do not carry anything ourselves.",
    answers: [
      "Yes to intermediation. We do not carry consignments ourselves.",
      "About 4,000 consignments a month. Yes to electronic tracking. Data handling confirmed.",
      "No food delivery, no medicine delivery, no cold chain. No outsourcing.",
    ],
    watch: [
      "**It should not ask about a fleet, a lease or insurance.** This company owns no vehicles and this permit asks for none of those. If it does, that is the bug.",
      "**It should say a desk verification follows** — not a physical inspection, which is what the food and locker permits get. Both are conditional issuance; the two are not the same check.",
      "**The fee should be AED 5,000.**",
    ],
  },
  {
    dir: "05-lockers-pudo",
    code: "LOCKERS",
    purpose:
      "The smallest submission there is. Good for a quick run, and for checking it does not ask for the things no permit needs.",
    company: co("20261030E", "CN-5234567", "7X TEST LOCKERS", "7X تست لوكرز",
      ["Electronic Locker Services", "Pick-up and Drop-off Points"],
      ["خدمات الخزائن الإلكترونية", "نقاط الاستلام والتسليم"]),
    describeSelf: "I operate parcel lockers and pick-up points. I want the permit for that.",
    answers: [
      "Four sites, two locker banks and two staffed counters.",
      "Parcels held five days before return. Yes to SMS notification. Yes to electronic tracking.",
      "No food delivery, no medicine delivery, no cold chain. No intermediation, no outsourcing.",
    ],
    watch: [
      "**This is the shortest pack — six documents.** If it asks for a seventh, write down which one.",
      "**It is a permit, not a licence.** It should not call the result a licence, and it should say an inspection follows before you pay.",
      "**The fee should be AED 1,000** — the same figure as the UAE-national SME licence in pack 01, for a completely different thing. Worth checking it quotes the right one.",
    ],
  },
  {
    dir: "06-outsource-no-fee",
    code: "OUTSOURCE",
    purpose:
      "The only product with no application fee at all. The whole point of this one is to find out what happens where the payment step should not exist.",
    company: co("20261030F", "CN-6234567", "7X TEST OUTSOURCED OPS", "7X تست للعمليات المُسندة",
      ["Outsourced Postal Operations"],
      ["العمليات البريدية المُسندة"]),
    describeSelf:
      "We perform outsourced postal operations for Emirates Post. We do not hold postal rights ourselves.",
    answers: [
      "Yes to outsourcing. We work under a principal licensee contract.",
      "No food delivery, no medicine delivery, no cold chain. No intermediation.",
      "Yes to electronic tracking. Data handling confirmed.",
    ],
    watch: [
      "**There should be no payment step and no card.** This permit has no application fee: it is settled as 10% of revenue every six months once the permit is held. If it quotes you any amount to pay now, or opens a card at all, that is the whole bug this pack is for.",
      "**It should be able to explain the 10% arrangement** if you ask what it costs. An answer of \"AED 0\" with nothing else is only half true.",
      "**It should not ask for a lease, insurance, a fleet or an SME licence.**",
    ],
  },
];
