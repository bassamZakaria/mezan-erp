import type { BilingualReason } from "../collections/errors.js";
/**
 * Data-migration import — suppliers (docs/archive/catalog/09 "نقل البيانات"). Mirror
 * of `import-customers.ts` for `createSupplier`.
 */
import { createSupplier, InvalidSupplierError, type Supplier } from "../suppliers/supplier.js";
import { Money } from "../money/index.js";
import { importRowError, type ImportRowError } from "./row-errors.js";

export interface SupplierImportRowInput {
  readonly rowNumber: number;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn?: string | null;
  readonly phone?: string | null;
  readonly email?: string | null;
  readonly contactPerson?: string | null;
  readonly taxNumber?: string | null;
  readonly category?: string | null;
  readonly notes?: string | null;
  readonly paymentTermsDays?: number;
  readonly currency?: string;
  readonly openingBalance?: Money;
  readonly addressCity?: string | null;
  readonly addressDistrict?: string | null;
  readonly addressStreet?: string | null;
}

export interface SupplierImportPreview {
  readonly valid: readonly { readonly rowNumber: number; readonly supplier: Supplier }[];
  readonly errors: readonly ImportRowError[];
}

export function previewSupplierImport(
  rows: readonly SupplierImportRowInput[],
  existingCodes: ReadonlySet<string>,
  idFactory: (row: SupplierImportRowInput) => string,
): SupplierImportPreview {
  const errors: ImportRowError[] = [];
  const valid: { rowNumber: number; supplier: Supplier }[] = [];
  const seenCodes = new Set<string>();

  for (const row of rows) {
    const reasons: BilingualReason[] = [];
    const code = row.code.trim();
    if (code === "") reasons.push({ ar: "كود المورد مطلوب", en: "The supplier code is required" });
    else if (existingCodes.has(code)) reasons.push({ ar: `كود المورد "${code}" مستخدم بالفعل`, en: `Supplier code "${code}" is already in use` });
    else if (seenCodes.has(code)) reasons.push({ ar: `كود المورد "${code}" مكرر داخل الملف`, en: `Supplier code "${code}" is duplicated in the file` });
    if (row.nameAr.trim() === "") reasons.push({ ar: "اسم المورد مطلوب", en: "The supplier name is required" });
    if (reasons.length > 0) {
      errors.push(importRowError(row.rowNumber, reasons));
      continue;
    }
    seenCodes.add(code);
    try {
      const supplier = createSupplier({
        id: idFactory(row),
        code,
        nameAr: row.nameAr,
        nameEn: row.nameEn,
        phone: row.phone,
        email: row.email,
        contactPerson: row.contactPerson,
        taxNumber: row.taxNumber,
        category: row.category,
        notes: row.notes,
        paymentTermsDays: row.paymentTermsDays,
        currency: row.currency,
        openingBalance: row.openingBalance,
        addressCity: row.addressCity,
        addressDistrict: row.addressDistrict,
        addressStreet: row.addressStreet,
      });
      valid.push({ rowNumber: row.rowNumber, supplier });
    } catch (err) {
      if (err instanceof InvalidSupplierError) {
        errors.push(importRowError(row.rowNumber, err.reasons.map((ar, i) => ({ ar, en: err.reasonsEn[i] ?? ar }))));
      } else {
        throw err;
      }
    }
  }

  return { valid, errors };
}
