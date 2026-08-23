/**
 * Data-migration import — customers (docs/catalog/09 "نقل البيانات"). A CSV
 * go-live upload of the customer master, one row per customer. Pure — no I/O:
 * the caller supplies `existingCodes` (a snapshot of codes already in the
 * repo) and an `idFactory`; reuses `createCustomer` for field validation so
 * the rules never drift from the single-customer create path.
 */
import { createCustomer, InvalidCustomerError, type Customer, type EtaBuyerType } from "../customers/customer.js";
import { Money } from "../money/index.js";
import type { ImportRowError } from "./row-errors.js";

export interface CustomerImportRowInput {
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
  readonly creditLimit?: Money;
  readonly taxExempt?: boolean;
  readonly etaBuyerType?: EtaBuyerType;
  readonly nationalId?: string | null;
}

export interface CustomerImportPreview {
  readonly valid: readonly { readonly rowNumber: number; readonly customer: Customer }[];
  readonly errors: readonly ImportRowError[];
}

export function previewCustomerImport(
  rows: readonly CustomerImportRowInput[],
  existingCodes: ReadonlySet<string>,
  idFactory: (row: CustomerImportRowInput) => string,
): CustomerImportPreview {
  const errors: ImportRowError[] = [];
  const valid: { rowNumber: number; customer: Customer }[] = [];
  const seenCodes = new Set<string>();

  for (const row of rows) {
    const reasons: string[] = [];
    const code = row.code.trim();
    if (code === "") reasons.push("كود العميل مطلوب");
    else if (existingCodes.has(code)) reasons.push(`كود العميل "${code}" مستخدم بالفعل`);
    else if (seenCodes.has(code)) reasons.push(`كود العميل "${code}" مكرر داخل الملف`);
    if (row.nameAr.trim() === "") reasons.push("اسم العميل مطلوب");
    if (reasons.length > 0) {
      errors.push({ rowNumber: row.rowNumber, reasons });
      continue;
    }
    seenCodes.add(code);
    try {
      const customer = createCustomer({
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
        creditLimit: row.creditLimit,
        taxExempt: row.taxExempt,
        etaBuyerType: row.etaBuyerType,
        nationalId: row.nationalId,
      });
      valid.push({ rowNumber: row.rowNumber, customer });
    } catch (err) {
      if (err instanceof InvalidCustomerError) {
        errors.push({ rowNumber: row.rowNumber, reasons: err.reasons });
      } else {
        throw err;
      }
    }
  }

  return { valid, errors };
}
