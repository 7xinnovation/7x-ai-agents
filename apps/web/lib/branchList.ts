/**
 * What the customer is shown when they pick a branch.
 *
 * Two rules live here, both from Emirates Post, and both were previously either
 * absent or handled inline where nothing could test them.
 *
 * BRANCHES WITH NO BOXES ARE NOT SHOWN. They used to be listed and greyed out,
 * which still put a dead end in front of the customer -- a card they can read,
 * ask about and be disappointed by. If there is nothing to rent there, it is not
 * an option.
 *
 * A PO BOX HALL IS NOT A BRANCH. Where `officeId` differs from `mainOfficeId`
 * the location is a box hall: boxes only, no counter, no parcels, no registered
 * mail, and the KEY is issued somewhere else -- at `mainOfficeName`. A customer
 * who rents there without being told turns up expecting a post office and finds
 * a room of boxes, with their key in another building. Emirates Post's own site
 * shows a notice before letting them proceed, so we do too.
 */
import { parseHours, openNow } from "./branchHours";

export interface BranchRow {
  officeId?: string;
  nameEn?: string;
  nameAr?: string;
  mainOfficeId?: string;
  mainOfficeNameEn?: string;
  mainOfficeNameAr?: string;
  workingDays?: string;
  workingTime?: string;
  [k: string]: unknown;
}

export interface AnnotatedBranch extends BranchRow {
  /** Free boxes at this branch right now. Undefined means it was not counted. */
  freeBoxCount?: number;
  openNow?: boolean;
  opensAt?: string;
  /** True when this location is a PO Box hall rather than a full branch. */
  isPoBoxHall?: boolean;
  /** Where the key is collected and counter services are had, when it is. */
  alternativeBranchEn?: string;
  alternativeBranchAr?: string;
}

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());

/**
 * Is this location a box hall rather than a branch?
 *
 * Emirates Post's rule: officeId not matching mainOfficeId. Both must be present
 * and readable -- a row missing either is treated as an ordinary branch, because
 * showing the notice on a real post office is its own kind of wrong.
 */
export function isPoBoxHall(row: BranchRow): boolean {
  const office = str(row.officeId);
  const main = str(row.mainOfficeId);
  return Boolean(office && main && office !== main);
}

/**
 * Annotate and filter the branch list.
 *
 * `counts` maps officeId (or the emirate, for pooled MyHome bundles) to the free
 * box count. A branch absent from it was not counted and is KEPT: "we do not
 * know" is not "there are none", and dropping those would hide real branches
 * whenever the availability lookup was slow.
 */
export function prepareBranches(
  rows: BranchRow[],
  counts: Map<string, number | null>,
  opts: { pooled?: boolean; emirate?: string } = {}
): { branches: AnnotatedBranch[]; hidden: number } {
  const out: AnnotatedBranch[] = [];
  let hidden = 0;

  for (const row of rows) {
    const key = opts.pooled ? str(opts.emirate) : str(row.officeId);
    const count = counts.get(key);
    const r: AnnotatedBranch = { ...row };

    if (count !== null && count !== undefined) {
      r.freeBoxCount = count;
      // Nothing to rent here, so it is not an option. Counted, not guessed.
      if (count <= 0) { hidden++; continue; }
    }

    const hours = parseHours(str(row.workingDays), str(row.workingTime));
    if (hours) {
      const state = openNow(hours);
      r.openNow = state.open;
      if (!state.open) r.opensAt = state.opensAt;
    }

    if (isPoBoxHall(row)) {
      r.isPoBoxHall = true;
      const en = str(row.mainOfficeNameEn);
      const ar = str(row.mainOfficeNameAr);
      if (en) r.alternativeBranchEn = en;
      if (ar) r.alternativeBranchAr = ar;
    }

    out.push(r);
  }

  return { branches: out, hidden };
}

/** The notice, in the words Emirates Post's own site uses. */
/**
 * The notice a customer must see before choosing a P.O. Box hall.
 *
 * In BOTH languages, because it is emitted from here rather than written by the
 * model — so an Arabic conversation was being handed a wall of English at the
 * one moment it matters, immediately before the customer accepts a limitation
 * on the service they are buying. Reported 9 September.
 */
export function poBoxHallNotice(alternativeBranch: string, locale?: string): string {
  if (locale === "ar") {
    return (
      "تنبيه مهم\n\n" +
      "هذا الموقع يعمل كمجمع صناديق بريد ويوفر الوصول إلى صندوق البريد فقط.\n" +
      "صندوق البريد مخصص للمراسلات العادية التي تتناسب مع الأبعاد المادية لحجم الصندوق المختار.\n" +
      "خدمات الكاونتر، واستلام الطرود الكبيرة، ومعالجة البريد المسجل، والخدمات الإضافية غير متوفرة في هذا الموقع.\n" +
      "يمكن استلام مفاتيح صندوق البريد من الفرع التشغيلي المخصص فقط، أو عبر خيار التوصيل المعتمد (إن وُجد). لا تُصرف المفاتيح في مجمع صناديق البريد هذا.\n" +
      `للحصول على خدمات تتجاوز الوصول إلى صندوق البريد، يُرجى زيارة الفرع التشغيلي البديل: ${alternativeBranch}.\n\n` +
      "بالمتابعة، فإنك تقر بهذه القيود على الخدمة وتوافق عليها."
    );
  }
  return (
    "Important Notice\n\n" +
    "This location operates as a P.O. Box Hall/complex and provides P.O. Box access only.\n" +
    "The P.O. Box is designated for normal mail items that fit within the physical dimensions of the selected box size.\n" +
    "Counter services, large parcel handling, registered mail processing, and additional services are not available at this location.\n" +
    "P.O. Box keys can only be collected from the respective operational branch, or through the approved delivery option (if available). Keys are not issued at this P.O. Box Hall location.\n" +
    `To obtain services beyond P.O. Box access, please visit the designated Alternative Operational Branch: ${alternativeBranch}.\n\n` +
    "By proceeding, you acknowledge and accept these service limitations."
  );
}
