import { Money, Qty } from "../../money/index.js";
import { isCostCategory, type CostCategory } from "../cost-category.js";
import { parseBoqUnit, type BoqUnit } from "./boq-unit.js";

/**
 * استيراد جدول الكميات من Excel — the engineer's half of D-06. The client
 * parses the workbook (packages/ui/src/lib/data-migration-file.ts); this
 * REVIEWS the rows and persists nothing. A row with a problem is reported with
 * an Arabic reason beside it rather than dropped, because a BOQ silently short
 * of two items prices the whole job wrong.
 */

export interface BoqImportRow {
  readonly code?: string | null;
  readonly descriptionAr?: string | null;
  readonly descriptionEn?: string | null;
  readonly unit?: string | null;
  readonly qty?: string | null;
  readonly unitRate?: string | null;
  readonly estimatedUnitCost?: string | null;
  readonly section?: string | null;
  readonly costCategory?: string | null;
}

export interface BoqImportAcceptedRow {
  readonly code: string;
  readonly descriptionAr: string;
  readonly descriptionEn: string | null;
  readonly unit: BoqUnit;
  readonly qty: Qty;
  readonly unitRate: Money;
  readonly estimatedUnitCost: Money | null;
  readonly section: string | null;
  readonly costCategory: CostCategory | null;
}

export interface BoqImportReviewRow {
  /** 1-based position in the uploaded sheet, so the reviewer can find the row again. */
  readonly rowNumber: number;
  readonly accepted: boolean;
  readonly problems: readonly string[];
  readonly problemsEn: readonly string[];
  readonly value: BoqImportAcceptedRow | null;
  readonly raw: BoqImportRow;
}

export interface BoqImportReview {
  readonly rows: readonly BoqImportReviewRow[];
  readonly acceptedCount: number;
  readonly rejectedCount: number;
}

function decimalOrNull(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").toString().trim().replace(/,/g, "");
  if (trimmed.length === 0) return null;
  return /^-?\d+(\.\d+)?$/.test(trimmed) ? trimmed : null;
}

/**
 * Reviews parsed rows against the codes the contract already holds. Duplicate
 * codes WITHIN the sheet are caught too — a workbook repeating "3.1" twice is
 * the commonest real defect and neither row can be trusted.
 */
export function reviewBoqImport(
  rows: readonly BoqImportRow[],
  existingCodes: readonly string[],
): BoqImportReview {
  const taken = new Set(existingCodes.map((c) => c.trim()));
  const seen = new Set<string>();
  const reviewed: BoqImportReviewRow[] = rows.map((raw, index) => {
    const problems: string[] = [];
    const problemsEn: string[] = [];
    const flag = (ar: string, en: string) => {
      problems.push(ar);
      problemsEn.push(en);
    };
    const code = (raw.code ?? "").toString().trim();
    const descriptionAr = (raw.descriptionAr ?? "").toString().trim();

    if (code.length === 0) flag("كود البند مطلوب", "The item code is required");
    else if (taken.has(code) || seen.has(code)) flag(`كود البند "${code}" مكرر`, `The item code "${code}" is duplicated`);
    if (descriptionAr.length === 0) flag("وصف البند مطلوب", "The item description is required");

    const unit = parseBoqUnit((raw.unit ?? "").toString());
    if (!unit) flag(`وحدة غير معروفة: "${(raw.unit ?? "").toString().trim()}"`, `Unknown unit: "${(raw.unit ?? "").toString().trim()}"`);

    const qty = decimalOrNull(raw.qty);
    if (qty === null) flag("الكمية غير رقمية", "The quantity is not a number");
    else if (qty.startsWith("-")) flag("الكمية لا يمكن أن تكون سالبة", "The quantity cannot be negative");

    const unitRate = decimalOrNull(raw.unitRate);
    if (unitRate === null) flag("الفئة غير رقمية", "The unit rate is not a number");
    else if (unitRate.startsWith("-")) flag("الفئة لا يمكن أن تكون سالبة", "The unit rate cannot be negative");

    const estimatedRaw = (raw.estimatedUnitCost ?? "").toString().trim();
    const estimated = estimatedRaw.length === 0 ? null : decimalOrNull(estimatedRaw);
    if (estimatedRaw.length > 0 && estimated === null) flag("التكلفة التقديرية غير رقمية", "The estimated cost is not a number");

    const categoryRaw = (raw.costCategory ?? "").toString().trim();
    const costCategory = categoryRaw.length === 0 ? null : categoryRaw;
    if (costCategory !== null && !isCostCategory(costCategory)) flag(`فئة تكلفة غير معروفة: "${categoryRaw}"`, `Unknown cost category: "${categoryRaw}"`);

    const accepted = problems.length === 0;
    if (accepted && code.length > 0) seen.add(code);

    const section = (raw.section ?? "").toString().trim();
    return {
      rowNumber: index + 1,
      accepted,
      problems,
      problemsEn,
      raw,
      value:
        accepted && unit && qty !== null && unitRate !== null
          ? {
              code,
              descriptionAr,
              descriptionEn: (raw.descriptionEn ?? "").toString().trim() || null,
              unit,
              qty: Qty.fromMajor(qty),
              unitRate: Money.fromMajor(unitRate),
              estimatedUnitCost: estimated === null ? null : Money.fromMajor(estimated),
              section: section.length === 0 ? null : section,
              costCategory: costCategory !== null && isCostCategory(costCategory) ? costCategory : null,
            }
          : null,
    };
  });

  return {
    rows: reviewed,
    acceptedCount: reviewed.filter((r) => r.accepted).length,
    rejectedCount: reviewed.filter((r) => !r.accepted).length,
  };
}
