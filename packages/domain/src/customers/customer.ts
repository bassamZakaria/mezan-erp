import { Money } from "../money/index.js";
import { validatePartnerBase, type PartnerBase } from "../partners/partner-base.js";

/**
 * Customer — docs/catalog/01-sales.md "العملاء (Customers — Customer master)".
 * Central customer master: contact info, credit terms/limit, pricing category,
 * ETA (e-invoicing) buyer classification and tax-exemption flag. The rollup of
 * invoices/statement/installments/returns/loyalty is Phase-2 (document) work —
 * this entity only owns the master record itself.
 */

export type EtaBuyerType = "auto" | "business" | "individual";

export const ETA_BUYER_TYPES: readonly EtaBuyerType[] = ["auto", "business", "individual"];

export interface Customer extends PartnerBase {
  /** Reference to a price list — Phase-2 (Price Lists aren't modeled yet), so this is an opaque id/label for now. */
  readonly priceListId: string | null;
  /** Always in base (tenant) currency regardless of the customer's own `currency` (catalog note). */
  readonly creditLimit: Money;
  readonly taxExempt: boolean;
  readonly etaBuyerType: EtaBuyerType;
  /** Required for e-invoices over the individual-buyer legal threshold (catalog note) — not enforced here, that threshold is a Phase-2/ETA-integration concern. */
  readonly nationalId: string | null;
}

export class InvalidCustomerError extends Error {
  readonly code = "INVALID_CUSTOMER";
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join("، "));
    this.name = "InvalidCustomerError";
  }
}

export interface CreateCustomerInput {
  readonly id: string;
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
  readonly priceListId?: string | null;
  readonly creditLimit?: Money;
  readonly taxExempt?: boolean;
  readonly etaBuyerType?: EtaBuyerType;
  readonly nationalId?: string | null;
}

function validate(customer: Customer): string[] {
  const reasons = validatePartnerBase(customer);
  if (!ETA_BUYER_TYPES.includes(customer.etaBuyerType)) {
    reasons.push("نوع عميل الفاتورة الإلكترونية غير صالح");
  }
  if (customer.creditLimit.scaled < 0n) {
    reasons.push("حد الائتمان لا يمكن أن يكون سالبًا");
  }
  return reasons;
}

/** Constructs a `Customer`, applying the catalog's add-dialog defaults (30-day terms, EGP, no credit limit). */
export function createCustomer(input: CreateCustomerInput): Customer {
  const customer: Customer = {
    id: input.id,
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
    priceListId: input.priceListId ?? null,
    creditLimit: input.creditLimit ?? Money.zero(),
    taxExempt: input.taxExempt ?? false,
    etaBuyerType: input.etaBuyerType ?? "auto",
    nationalId: input.nationalId ?? null,
  };
  const reasons = validate(customer);
  if (reasons.length > 0) throw new InvalidCustomerError(reasons);
  return customer;
}

/** Applies a patch to an existing customer, re-validating the result (the catalog's "Add customer" dialog doubles as edit). */
export function updateCustomer(current: Customer, patch: Partial<Omit<Customer, "id">>): Customer {
  const next: Customer = { ...current, ...patch };
  const reasons = validate(next);
  if (reasons.length > 0) throw new InvalidCustomerError(reasons);
  return next;
}
