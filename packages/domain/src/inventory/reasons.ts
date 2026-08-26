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
  readonly labelEn: string;
  readonly descriptionAr: string;
  readonly descriptionEn: string;
  readonly direction: AdjustmentDirection;
  /**
   * The GL account the value moves to or from (R5.9). Every reason has one:
   * an adjustment that changes inventory value and posts nothing leaves the
   * stock sub-ledger and its control account permanently out of agreement,
   * which is what seven of these eight reasons did.
   */
  readonly counterpartAccountId: string;
}

export const ADJUSTMENT_REASON_DEFINITIONS: readonly AdjustmentReasonDefinition[] = [
  {
    code: "INITIAL_STOCK",
    labelAr: "رصيد افتتاحي",
    labelEn: "Opening balance",
    descriptionAr: "تسجيل رصيد المخزون الأولي",
    descriptionEn: "Record the starting stock balance",
    direction: "IN",
    // Opening stock is funded by owner's capital, not by an expense.
    counterpartAccountId: "3100",
  },
  {
    code: "PHYSICAL_COUNT",
    labelAr: "تصحيح جرد",
    labelEn: "Count correction",
    descriptionAr: "تعديل المخزون بناء على الجرد الفعلي",
    descriptionEn: "Correct stock against a physical count",
    direction: "EITHER",
    counterpartAccountId: "5074",
  },
  {
    code: "DAMAGE",
    labelAr: "تلف",
    labelEn: "Damage",
    descriptionAr: "خصم الأصناف التالفة",
    descriptionEn: "Write off damaged goods",
    direction: "OUT",
    counterpartAccountId: "5070",
  },
  {
    code: "THEFT",
    labelAr: "سرقة",
    labelEn: "Theft",
    descriptionAr: "خصم الأصناف المسروقة",
    descriptionEn: "Write off stolen goods",
    direction: "OUT",
    counterpartAccountId: "5071",
  },
  {
    code: "EXPIRY",
    labelAr: "انتهاء صلاحية",
    labelEn: "Expiry",
    descriptionAr: "خصم الأصناف منتهية الصلاحية",
    descriptionEn: "Write off expired goods",
    direction: "OUT",
    counterpartAccountId: "5072",
  },
  {
    code: "SHORTAGE",
    labelAr: "نقص / فقدان",
    labelEn: "Shortage or loss",
    descriptionAr: "خصم العجز غير المبرر",
    descriptionEn: "Write off an unexplained shortfall",
    direction: "OUT",
    counterpartAccountId: "5073",
  },
  {
    code: "SUPPLIER_RETURN",
    labelAr: "مرتجع للمورد",
    labelEn: "Return to supplier",
    descriptionAr: "خصم الأصناف المرتجعة للمورد",
    descriptionEn: "Send goods back to the supplier",
    direction: "OUT",
    // Goods going back reduce what is owed to the supplier — a payable, not
    // a loss. A purchase return document is the fuller path; this is the
    // stock-only shortcut.
    counterpartAccountId: "2100",
  },
  {
    code: "OTHER",
    labelAr: "أخرى",
    labelEn: "Other",
    descriptionAr: "تسوية أخرى، حدد الاتجاه والكمية",
    descriptionEn: "Another adjustment — pick the direction and quantity",
    direction: "EITHER",
    counterpartAccountId: "5075",
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
