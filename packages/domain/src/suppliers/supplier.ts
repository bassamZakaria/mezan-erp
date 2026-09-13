import { Money } from "../money/index.js";
import { validatePartnerBase, type PartnerBase } from "../partners/partner-base.js";

/**
 * Supplier — docs/archive/catalog/02-purchases.md "الموردون (Suppliers)". Master list
 * of vendors: contact info, payment terms, category, and address — the mirror
 * of `Customer` (packages/domain/src/customers/customer.ts) minus the
 * customer-only credit-limit/ETA fields, plus a street address (catalog's
 * "خيارات متقدمة" city/district/street). Balance owed and the purchases
 * rollup (invoices/orders/returns/statement) are Phase-2 (document) work —
 * this entity only owns the master record itself.
 */

export interface Supplier extends PartnerBase {
  readonly addressCity: string | null;
  readonly addressDistrict: string | null;
  readonly addressStreet: string | null;
  /**
   * رقم الحساب البنكي / IBAN. A subcontractor cannot be certified for payment
   * without one (design §03 "THE MIRROR"), and every supplier paid by transfer
   * needs it somewhere other than a note field.
   */
  readonly bankAccount: string | null;
}

export class InvalidSupplierError extends Error {
  readonly code = "INVALID_SUPPLIER";
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join("، "));
    this.name = "InvalidSupplierError";
  }
}

export interface CreateSupplierInput {
  readonly id: string;
  /** The branch that owns this record; omitted, the record is tenant-wide (D71). */
  readonly branchId?: string | null;
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
  readonly active?: boolean;
  readonly addressCity?: string | null;
  readonly addressDistrict?: string | null;
  readonly addressStreet?: string | null;
  readonly bankAccount?: string | null;
}

function validate(supplier: Supplier): string[] {
  return validatePartnerBase(supplier);
}

/** Constructs a `Supplier`, applying the catalog's add-dialog defaults (30-day terms, EGP). */
export function createSupplier(input: CreateSupplierInput): Supplier {
  const supplier: Supplier = {
    id: input.id,
    branchId: input.branchId ?? null,
    code: input.code,
    nameAr: input.nameAr,
    nameEn: input.nameEn ?? null,
    phone: input.phone ?? null,
    email: input.email ?? null,
    contactPerson: input.contactPerson ?? null,
    taxNumber: input.taxNumber ?? null,
    category: input.category ?? null,
    notes: input.notes ?? null,
    paymentTermsDays: input.paymentTermsDays ?? 30,
    currency: input.currency ?? "EGP",
    openingBalance: input.openingBalance ?? Money.zero(),
    active: input.active ?? true,
    addressCity: input.addressCity ?? null,
    addressDistrict: input.addressDistrict ?? null,
    addressStreet: input.addressStreet ?? null,
    bankAccount: input.bankAccount ?? null,
  };
  const reasons = validate(supplier);
  if (reasons.length > 0) throw new InvalidSupplierError(reasons);
  return supplier;
}

/** Applies a patch to an existing supplier, re-validating the result (same modal serves create and edit per the catalog). */
export function updateSupplier(current: Supplier, patch: Partial<Omit<Supplier, "id">>): Supplier {
  const next: Supplier = { ...current, ...patch };
  const reasons = validate(next);
  if (reasons.length > 0) throw new InvalidSupplierError(reasons);
  return next;
}
