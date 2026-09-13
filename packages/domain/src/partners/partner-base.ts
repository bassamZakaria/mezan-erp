import type { Money } from "../money/index.js";

/**
 * Fields shared by every business-partner master record — Customer
 * (docs/archive/catalog/01-sales.md "العملاء") and Supplier (docs/archive/catalog/02-purchases.md
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
  /**
   * The branch that owns this partner record, or null for one the whole tenant
   * shares.
   *
   * A customer carried no branch at all, so the list could not be narrowed and
   * every rep saw the whole company's customer book — the asset a departing rep
   * walks out with (D71). Null is deliberate and stays visible to everyone:
   * every record written before this existed has no branch, and hiding them
   * would empty the screen for a branch-scoped user rather than protect
   * anything.
   */
  readonly branchId: string | null;
  readonly active: boolean;
}

/**
 * The largest magnitude an opening balance can carry through the SQLite
 * column, which stores the scaled integer as a JS number (`Money.toScaledNumber`
 * throws a RangeError past this — that would otherwise surface as a 500 at the
 * writer instead of a 422 here).
 */
export const MAX_PARTNER_OPENING_BALANCE_SCALED = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * Common validation reasons shared by createCustomer/createCustomerFromPatch and their
 * supplier mirrors. Reasons are Arabic sentences (not English identifiers) because they
 * are surfaced as-is in the Arabic RTL UI (`InvalidCustomerError`/`InvalidSupplierError`
 * build their `.message` by joining this array) — see `packages/domain/src/customers/customer.ts`.
 */
export function validatePartnerBase(partner: PartnerBase): string[] {
  const reasons: string[] = [];
  if (partner.id.trim() === "") reasons.push("المعرف مطلوب");
  if (!/^[A-Za-z0-9_-]{1,30}$/.test(partner.code)) {
    reasons.push("الكود يجب أن يتكون من 1 إلى 30 حرفًا/رقمًا أو - أو _");
  }
  if (partner.nameAr.trim() === "") reasons.push("الاسم بالعربية مطلوب");
  if (!Number.isInteger(partner.paymentTermsDays) || partner.paymentTermsDays < 0) {
    reasons.push("مدة السداد يجب أن تكون رقمًا صحيحًا غير سالب");
  }
  if (partner.currency.trim() === "") reasons.push("العملة مطلوبة");
  if (
    partner.openingBalance.scaled > MAX_PARTNER_OPENING_BALANCE_SCALED ||
    partner.openingBalance.scaled < -MAX_PARTNER_OPENING_BALANCE_SCALED
  ) {
    reasons.push("الرصيد الافتتاحي أكبر من أن يُسجَّل — راجع الرقم المُدخل");
  }
  return reasons;
}
