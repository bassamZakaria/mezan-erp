/**
 * Data-migration import — items (docs/catalog/09 "نقل البيانات"). Mirrors
 * `import-customers.ts` / `import-suppliers.ts`, but items have no single
 * pure `createItem`-equivalent (the real `createItem` in
 * `../items/create-item.ts` does repo I/O), so this builds the candidate
 * `Item` itself and reuses `collectItemFieldErrors` — the exact field rules
 * the single-item create path enforces — to avoid drifting from them.
 */
import { collectItemFieldErrors } from "../items/validation.js";
import type { AlternateUnit, CostingMethod, EtaCodeType, Item, ItemType } from "../items/item.js";
import { Money } from "../money/index.js";
import type { ImportRowError } from "./row-errors.js";

export interface ItemImportRowInput {
  readonly rowNumber: number;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn?: string | null;
  readonly type?: ItemType;
  readonly baseUnitCode: string;
  readonly alternateUnits?: readonly AlternateUnit[];
  readonly barcodes?: readonly string[];
  readonly categoryId?: string | null;
  readonly brand?: string | null;
  readonly costingMethod?: CostingMethod;
  readonly salePrice?: Money | null;
  readonly costPrice?: Money | null;
  readonly taxRatePercent?: number;
  readonly trackInventory?: boolean;
  readonly trackBatches?: boolean;
  readonly trackExpiry?: boolean;
  readonly reorderPoint?: number | null;
  readonly reorderQty?: number | null;
  readonly etaCodeType?: EtaCodeType | null;
  readonly etaItemCode?: string | null;
  readonly gpcCode?: string | null;
}

export interface ItemImportPreview {
  readonly valid: readonly { readonly rowNumber: number; readonly item: Item }[];
  readonly errors: readonly ImportRowError[];
}

function buildCandidate(row: ItemImportRowInput, id: string): Item {
  const type: ItemType = row.type ?? "stock";
  return {
    id,
    code: row.code.trim(),
    nameAr: row.nameAr,
    nameEn: row.nameEn ?? null,
    type,
    baseUnitCode: row.baseUnitCode,
    alternateUnits: row.alternateUnits ?? [],
    barcodes: row.barcodes ?? [],
    categoryId: row.categoryId ?? null,
    brand: row.brand ?? null,
    costingMethod: row.costingMethod ?? "WAC",
    salePrice: row.salePrice ?? null,
    costPrice: row.costPrice ?? null,
    taxRatePercent: row.taxRatePercent ?? 14,
    trackInventory: row.trackInventory ?? type === "stock",
    trackBatches: row.trackBatches ?? false,
    trackExpiry: row.trackExpiry ?? false,
    reorderPoint: row.reorderPoint ?? null,
    reorderQty: row.reorderQty ?? null,
    revenueAccountId: null,
    cogsAccountId: null,
    inventoryAccountId: null,
    etaCodeType: row.etaCodeType ?? null,
    etaItemCode: row.etaItemCode ?? null,
    gpcCode: row.gpcCode ?? null,
    status: "active",
  };
}

export function previewItemImport(
  rows: readonly ItemImportRowInput[],
  existingCodes: ReadonlySet<string>,
  idFactory: (row: ItemImportRowInput) => string,
): ItemImportPreview {
  const errors: ImportRowError[] = [];
  const valid: { rowNumber: number; item: Item }[] = [];
  const seenCodes = new Set<string>();

  for (const row of rows) {
    const reasons: string[] = [];
    const code = row.code.trim();
    if (code === "") reasons.push("كود الصنف مطلوب");
    else if (existingCodes.has(code)) reasons.push(`كود الصنف "${code}" مستخدم بالفعل`);
    else if (seenCodes.has(code)) reasons.push(`كود الصنف "${code}" مكرر داخل الملف`);
    const candidate = buildCandidate(row, idFactory(row));
    reasons.push(...collectItemFieldErrors(candidate));
    if (reasons.length > 0) {
      errors.push({ rowNumber: row.rowNumber, reasons });
      continue;
    }
    seenCodes.add(code);
    valid.push({ rowNumber: row.rowNumber, item: candidate });
  }

  return { valid, errors };
}
