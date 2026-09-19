/** Errors raised by the landed-cost allocation math (docs/archive/catalog/02 §"التكاليف الإضافية"). */

export class EmptyLandedCostTargetsError extends Error {
  readonly code = "EMPTY_LANDED_COST_TARGETS";
  readonly messageEn: string;
  constructor() {
    super("مستند التكلفة الإضافية يحتاج بند فاتورة هدف واحداً على الأقل لتوزيع التكلفة عليه.");
    this.messageEn = "A landed-cost document needs at least one target invoice line to distribute cost onto.";
    this.name = "EmptyLandedCostTargetsError";
  }
}

/** Raised when every target's weight is zero (e.g. BY_QUANTITY with all-zero qty) — nothing to allocate onto. */
export class ZeroLandedCostWeightError extends Error {
  readonly code = "ZERO_LANDED_COST_WEIGHT";
  readonly messageEn: string;
  constructor(readonly method: string) {
    super(`تعذّر توزيع التكلفة الإضافية بطريقة ${method}: كل بنود الهدف وزنها صفر.`);
    this.messageEn = `Cannot distribute landed cost ${method}: every target line has a zero weight.`;
    this.name = "ZeroLandedCostWeightError";
  }
}
