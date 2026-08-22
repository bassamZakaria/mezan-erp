/**
 * The 8 stock-adjustment reasons (docs/catalog/03-inventory.md §"تسويات
 * المخزون" — the reason picker with 8 cards). Transcribed verbatim, in the
 * documented order. `INITIAL_STOCK` is the opening-balance mechanism (there is
 * no separate opening-balance screen — it is a specialised entry point into
 * Adjustments).
 *
 * `direction` encodes how the reason drives data entry:
 *   - "IN"     — always increases stock (opening balance).
 *   - "OUT"    — always decreases stock (damage, theft, expiry, shortage,
 *                supplier return).
 *   - "EITHER" — user picks the direction per line (physical-count correction,
 *                other). These can raise OR lower stock.
 */

export const ADJUSTMENT_REASONS = [
  "INITIAL_STOCK",
  "PHYSICAL_COUNT",
  "DAMAGE",
  "THEFT",
  "EXPIRY",
  "SHORTAGE",
  "SUPPLIER_RETURN",
  "OTHER",
] as const;

export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

export type AdjustmentDirection = "IN" | "OUT" | "EITHER";

export interface AdjustmentReasonDefinition {
  readonly code: AdjustmentReason;
  readonly labelAr: string;
  readonly descriptionAr: string;
  readonly direction: AdjustmentDirection;
}

export const ADJUSTMENT_REASON_DEFINITIONS: readonly AdjustmentReasonDefinition[] = [
  {
    code: "INITIAL_STOCK",
    labelAr: "رصيد افتتاحي",
    descriptionAr: "تسجيل رصيد المخزون الأولي",
    direction: "IN",
  },
  {
    code: "PHYSICAL_COUNT",
    labelAr: "تصحيح جرد",
    descriptionAr: "تعديل المخزون بناء على الجرد الفعلي",
    direction: "EITHER",
  },
  { code: "DAMAGE", labelAr: "تلف", descriptionAr: "خصم الأصناف التالفة", direction: "OUT" },
  { code: "THEFT", labelAr: "سرقة", descriptionAr: "خصم الأصناف المسروقة", direction: "OUT" },
  {
    code: "EXPIRY",
    labelAr: "انتهاء صلاحية",
    descriptionAr: "خصم الأصناف منتهية الصلاحية",
    direction: "OUT",
  },
  {
    code: "SHORTAGE",
    labelAr: "نقص / فقدان",
    descriptionAr: "خصم العجز غير المبرر",
    direction: "OUT",
  },
  {
    code: "SUPPLIER_RETURN",
    labelAr: "مرتجع للمورد",
    descriptionAr: "خصم الأصناف المرتجعة للمورد",
    direction: "OUT",
  },
  {
    code: "OTHER",
    labelAr: "أخرى",
    descriptionAr: "تسوية أخرى، حدد الاتجاه والكمية",
    direction: "EITHER",
  },
] as const satisfies readonly AdjustmentReasonDefinition[];

const BY_CODE: ReadonlyMap<string, AdjustmentReasonDefinition> = new Map(
  ADJUSTMENT_REASON_DEFINITIONS.map((r) => [r.code, r]),
);

export function isAdjustmentReason(code: string): code is AdjustmentReason {
  return BY_CODE.has(code);
}

export function getAdjustmentReasonDefinition(code: AdjustmentReason): AdjustmentReasonDefinition {
  return BY_CODE.get(code) as AdjustmentReasonDefinition;
}
