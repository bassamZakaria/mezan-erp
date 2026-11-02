import type { BilingualReason } from "../collections/errors.js";
/**
 * Data-migration import — item opening balances (docs/archive/catalog/09 "نقل
 * البيانات"). There is no separate opening-balance entity: an opening
 * balance IS a `STOCK_ADJUSTMENT` document line with reason `INITIAL_STOCK`
 * (`../inventory/reasons.ts`) — this module only validates the raw CSV rows
 * (one item per row, one warehouse per import batch, chosen once in the
 * wizard rather than per row) before the caller turns them into
 * `StockAdjustmentDocLine`s and confirms them through the existing
 * stock-adjustment `DocumentService`. Pure — resolving an item CODE to its
 * id is I/O, so it's the API layer's job; this only checks the row shape.
 */
import { Money, Qty } from "../money/index.js";
import { importRowError, type ImportRowError } from "./row-errors.js";

export interface OpeningBalanceImportRowInput {
  readonly rowNumber: number;
  readonly itemCode: string;
  readonly qty: Qty;
  readonly unitCost: Money;
}

export interface OpeningBalanceImportPreview {
  readonly valid: readonly OpeningBalanceImportRowInput[];
  readonly errors: readonly ImportRowError[];
}

export function previewOpeningBalanceImport(
  rows: readonly OpeningBalanceImportRowInput[],
): OpeningBalanceImportPreview {
  const errors: ImportRowError[] = [];
  const valid: OpeningBalanceImportRowInput[] = [];
  const seenCodes = new Set<string>();

  for (const row of rows) {
    const reasons: BilingualReason[] = [];
    const itemCode = row.itemCode.trim();
    if (itemCode === "") reasons.push({ ar: "كود الصنف مطلوب", en: "The item code is required" });
    else if (seenCodes.has(itemCode)) reasons.push({ ar: `كود الصنف "${itemCode}" مكرر داخل الملف`, en: `Item code "${itemCode}" is duplicated in the file` });
    if (row.qty.isZero() || row.qty.isNegative()) reasons.push({ ar: "الكمية يجب أن تكون موجبة", en: "The quantity must be positive" });
    if (row.unitCost.scaled < 0n) reasons.push({ ar: "سعر التكلفة لا يمكن أن يكون سالبًا", en: "The cost price cannot be negative" });
    if (reasons.length > 0) {
      errors.push(importRowError(row.rowNumber, reasons));
      continue;
    }
    seenCodes.add(itemCode);
    valid.push({ ...row, itemCode });
  }

  return { valid, errors };
}
