import type { Money } from "../money/index.js";

/**
 * Fields shared by every business-partner master record — Customer
 * (docs/catalog/01-sales.md "العملاء") and Supplier (docs/catalog/02-purchases.md
 * "الموردون"). Both entities are flat master data (no document-style workflow,
 * just نشط/غير نشط), so they share this base plus the field-level validation
 * below; each entity still declares its own full interface explicitly rather
 * than just re-exporting this type, so the entity-specific fields (customer's
 * credit limit/ETA buyer type, supplier's address) stay easy to find.
 */
export interface PartnerBase {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly contactPerson: string | null;
  readonly taxNumber: string | null;
  /** Free-text category label (catalog's "التصنيف" combo, incl. inline quick-add) — no separate category master table yet. */
  readonly category: string | null;
  readonly notes: string | null;
  readonly paymentTermsDays: number;
  readonly currency: string;
  /** Starting balance at onboarding, before any documents post against this partner. */
  readonly openingBalance: Money;
  readonly active: boolean;
}

/** Common validation reasons shared by createCustomer/createCustomerFromPatch and their supplier mirrors. */
export function validatePartnerBase(partner: PartnerBase): string[] {
  const reasons: string[] = [];
  if (partner.id.trim() === "") reasons.push("id is required");
  if (!/^[A-Za-z0-9_-]{1,30}$/.test(partner.code)) {
    reasons.push("code must be 1-30 alphanumeric/-/_ characters");
  }
  if (partner.nameAr.trim() === "") reasons.push("nameAr is required");
  if (!Number.isInteger(partner.paymentTermsDays) || partner.paymentTermsDays < 0) {
    reasons.push("paymentTermsDays must be a non-negative integer");
  }
  if (partner.currency.trim() === "") reasons.push("currency is required");
  return reasons;
}
